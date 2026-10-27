#!/usr/bin/env python3
"""Synthetic, loopback-only --test validation; never writes to Influx or Fred."""
import argparse
import datetime as dt
import hashlib
import http.server
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading

TEMPLATE_SHA = "A56042A70F455FF56AA0D403AFCE630C4CCC5300778D9FF6A23D08420588A501"
LIVE_URL = "https://app-server2.centralus.cloudapp.azure.com/api/building-probes/results/export?recent=true&limit=1000"
LIVE_TOKEN_FILE = "/etc/telegraf/building-probe-export.token"
SYNTHETIC_TOKEN = "A" * 43
SENTINEL = "SYNTHETIC_UNREQUESTED_DO_NOT_EXPORT"
PERFORMANCE = "sccc_building_probe_performance"
CAPACITY = "sccc_building_probe_capacity_window"
HEALTH = "sccc_building_probe_health"
TYPES = {
    PERFORMANCE: {"sampleId": "string", "jobId": "string", "attemptId": "string", "capacityJobId": "string", "outcome": "string", "termination": "string", "successful": "bool", "bytes": "int", "elapsedMs": "float", "mbps": "float", "rangeCount": "int", "linkSpeedBps": "int"},
    CAPACITY: {"capacityJobId": "string", "bytesValidated": "int", "bytesReserved": "int", "remainingBytes": "int", "state": "string", "attemptCount": "int", "complete": "bool", "deadlineAtMs": "int"},
    HEALTH: {"deviceId": "string", "selected": "bool", "capable": "bool", "eligible": "bool", "online": "bool", "offline": "bool", "hasThroughputSample": "bool", "heartbeatAgeSeconds": "float", "throughputAgeSeconds": "float", "staleThroughput": "bool", "missedSlot": "bool", "consecutiveFailures": "int", "missedSlotReason": "string"},
}
PROJECTIONS = [("metrics", PERFORMANCE, "originalSampleAt", ("deviceId", "buildingId", "testType")), ("capacityMetrics", CAPACITY, "originalSampleAt", ("buildingId",)), ("healthMetrics", HEALTH, "observedAt", ("assignmentId", "buildingId"))]


def time_ns(value):
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})", value)
    if not match:
        raise ValueError("Fixture timestamp must have an explicit zone and at most nine decimals")
    offset = "+00:00" if match[3] == "Z" else match[3]
    date = dt.datetime.fromisoformat(match[1] + offset)
    seconds = (date.astimezone(dt.timezone.utc) - dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)).days * 86400
    seconds += (date.astimezone(dt.timezone.utc) - dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)).seconds
    return seconds * 1_000_000_000 + int((match[2] or "").ljust(9, "0"))


def split_quoted(value, separator):
    parts, current, quoted, escaped = [], [], False, False
    for char in value:
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\":
            current.append(char)
            escaped = True
        elif char == '"':
            current.append(char)
            quoted = not quoted
        elif char == separator and not quoted:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    if quoted or escaped:
        raise ValueError("Malformed synthetic line protocol")
    return parts + ["".join(current)]


def parse_metric(line):
    parts = split_quoted(line.removeprefix("> ").strip(), " ")
    if len(parts) != 3:
        raise ValueError("Metric must have measurement, fields and explicit timestamp")
    identity = split_quoted(parts[0], ",")
    tags = dict(item.split("=", 1) for item in identity[1:])
    fields = {}
    for item in split_quoted(parts[1], ","):
        key, raw = item.split("=", 1)
        if raw.startswith('"'):
            fields[key] = ("string", json.loads(raw))
        elif raw in ("true", "false"):
            fields[key] = ("bool", raw == "true")
        elif raw.endswith("i"):
            fields[key] = ("int", int(raw[:-1]))
        elif raw.endswith("u"):
            fields[key] = ("uint", int(raw[:-1]))
        else:
            fields[key] = ("float", float(raw))
    return identity[0], tags, fields, int(parts[2])


def fixtures():
    building = "00000000-0000-4000-8000-000000000010"
    device = "00000000-0000-4000-8000-000000000011"
    job = "00000000-0000-4000-8000-000000000012"
    capacity_id = "00000000-0000-4000-8000-000000000013"
    sample_at = "2001-01-02T03:04:05.123Z"
    performance = {"sampleId": "a" * 64, "jobId": job, "deviceId": device, "buildingId": building, "testType": "quick", "originalSampleAt": sample_at, "outcome": "completed", "termination": "byte_budget", "successful": True, "bytes": 5_242_880, "elapsedMs": 1000.0, "mbps": 41.94304, "rangeCount": 1, "linkSpeedBps": 1_000_000_000}
    failure = dict(performance, sampleId="b" * 64, testType="hourly", originalSampleAt="2001-01-02T03:05:05.456Z", outcome="unavailable", termination="http_403", successful=False, bytes=0, elapsedMs=23.5)
    del failure["mbps"]
    capacity = dict(performance, sampleId="c" * 64, testType="capacity", originalSampleAt="2001-01-02T03:06:05.789Z", bytes=10_000_000_000, elapsedMs=800_000.0, mbps=100.0, rangeCount=10, capacityJobId=capacity_id, attemptId=job)
    window = {"capacityJobId": capacity_id, "buildingId": building, "originalSampleAt": "2001-01-02T03:00:00.000Z", "bytesValidated": 0, "bytesReserved": 10_000_000_000, "remainingBytes": 0, "state": "blocked_unknown", "attemptCount": 1, "complete": False, "deadlineAtMs": 978404400000}
    healthy = {"assignmentId": "00000000-0000-4000-8000-000000000014", "buildingId": building, "deviceId": device, "observedAt": "2001-01-02T04:00:00.250Z", "selected": True, "capable": True, "eligible": True, "online": True, "offline": False, "hasThroughputSample": True, "heartbeatAgeSeconds": 0.25, "throughputAgeSeconds": 10.5, "staleThroughput": False, "missedSlot": False, "consecutiveFailures": 0}
    missing = {"assignmentId": "00000000-0000-4000-8000-000000000015", "buildingId": building, "observedAt": "2001-01-02T04:00:00.250Z", "selected": True, "capable": True, "eligible": False, "online": False, "offline": True, "hasThroughputSample": False, "staleThroughput": True, "missedSlot": True, "consecutiveFailures": 2, "missedSlotReason": "no recent heartbeat"}
    mixed = {"results": [], "health": [{"assignmentId": missing["assignmentId"], "deviceId": None, "lastSeen": None, "lastThroughputAt": None}], "capacityWindows": [], "nextCursor": "3", "metrics": [performance, failure, capacity], "capacityMetrics": [window], "healthMetrics": [healthy, missing], "ignoredSyntheticValue": SENTINEL}
    # Current exporter omits absent/nullable values from healthMetrics; raw health may contain nulls.
    precision = json.loads(json.dumps(mixed))
    precision["metrics"] = [dict(performance, originalSampleAt=stamp, sampleId=char * 64) for char, stamp in [("d", "2001-01-02T03:04:05Z"), ("e", "2001-01-02T03:04:05.123456789Z"), ("f", "2001-01-01T22:04:05.123-05:00")]]
    precision["capacityMetrics"] = []
    precision["healthMetrics"] = []
    empty = {key: [] for key in ("results", "health", "capacityWindows", "metrics", "capacityMetrics", "healthMetrics")}
    empty["nextCursor"] = "0"
    return [("historical_success_failure_nullable_health", mixed), ("empty_arrays", empty), ("timestamp_precision_and_offset", precision)]


def expected_records(payload):
    records = []
    for path, measurement, stamp, tag_names in PROJECTIONS:
        for row in payload[path]:
            fields = {key: (TYPES[measurement][key], value) for key, value in row.items() if key in TYPES[measurement]}
            records.append((measurement, {key: row[key] for key in tag_names}, fields, time_ns(row[stamp])))
    return records


def validate(stdout, stderr, expected):
    if SENTINEL in stdout or re.search(r"(?:^|\s)E!(?:\s|$)", stderr):
        raise ValueError("Unexpected field leakage or native Telegraf error")
    lines = [line.strip().removeprefix("> ") for line in stdout.splitlines() if line.strip()]
    actual = [parse_metric(line) for line in lines]
    if any(record[0] not in TYPES for record in actual):
        raise ValueError("Unexpected native measurement")
    if len(actual) != len(expected):
        raise ValueError("Native metric cardinality does not match fixture")
    for record in expected:
        matches = [item for item in actual if item[0] == record[0] and item[1] == record[1] and item[3] == record[3]]
        if len(matches) != 1 or set(matches[0][2]) != set(record[2]):
            raise ValueError("Tags, timestamp, optional-field omission or field names differ")
        for key, (kind, value) in record[2].items():
            actual_kind, actual_value = matches[0][2][key]
            if actual_kind != kind or (not math.isclose(actual_value, value, rel_tol=1e-12, abs_tol=1e-12) if kind == "float" else actual_value != value):
                raise ValueError("Native field type/value differs: " + key)
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, default=Path(__file__).with_name("telegraf-building-probes.native1303.conf"))
    parser.add_argument("--telegraf", type=Path)
    parser.add_argument("--native-sha256")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--self-check", action="store_true", help="Checks fixture/oracle only; does NOT claim native Telegraf acceptance")
    args = parser.parse_args()
    template_bytes = args.template.read_bytes()
    if hashlib.sha256(template_bytes).hexdigest().upper() != TEMPLATE_SHA:
        raise ValueError("Exact reviewed input template hash required")
    template = template_bytes.decode("utf-8")
    if template.count(LIVE_URL) != 3 or template.count(LIVE_TOKEN_FILE) != 3 or "[[outputs." in template or template.count("[[inputs.http]]") != 3 or template.count('precision = "1ns"') != 3:
        raise ValueError("Expected exactly three independent input-only projections")
    cases = fixtures()
    if args.self_check:
        for _, payload in cases:
            for measurement, tags, fields, timestamp in expected_records(payload):
                encoded = []
                for key, (kind, value) in fields.items():
                    raw = json.dumps(value) if kind in ("string", "bool") else str(value) + ("i" if kind == "int" else "")
                    encoded.append(key + "=" + raw)
                line = measurement + "," + ",".join(k + "=" + v for k, v in tags.items()) + " " + ",".join(encoded) + " " + str(timestamp)
                validate(line, "", [(measurement, tags, fields, timestamp)])
        print(json.dumps({"status": "FixtureOracleSelfCheckPassed", "nativeParserExecuted": False, "cases": len(cases), "templateSha256": TEMPLATE_SHA}))
        return
    if not args.telegraf or not args.native_sha256 or not re.fullmatch(r"[A-Fa-f0-9]{64}", args.native_sha256):
        raise ValueError("Supply the reviewed actual native Telegraf binary and its pinned SHA-256")
    if args.report and args.report.exists():
        raise ValueError("Refusing to overwrite an existing native validation report")
    binary = args.telegraf.resolve(strict=True)
    binary_sha = hashlib.sha256(binary.read_bytes()).hexdigest().upper()
    if binary_sha != args.native_sha256.upper():
        raise ValueError("Native binary differs from actual collector binary pin")
    environment = {key: value for key, value in os.environ.items() if key.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"}}
    version = subprocess.run([str(binary), "--version"], capture_output=True, text=True, timeout=10, check=True, env=environment).stdout.strip()
    results, first_lines = [], None
    # Repeated historical sample proves polling does not replace original timestamps.
    for case, payload in cases + [("historical_repeat", cases[0][1])]:
        requests = []
        body = json.dumps(payload, separators=(",", ":")).encode()
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                valid = self.path == "/fixture" and self.headers.get("Authorization") == "Bearer " + SYNTHETIC_TOKEN
                requests.append(valid)
                self.send_response(200 if valid else 403)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body) if valid else 0))
                self.end_headers()
                if valid:
                    self.wfile.write(body)
            def log_message(self, *_args):
                pass
        with tempfile.TemporaryDirectory(prefix="sccc-telegraf-synthetic-") as temporary:
            temporary = Path(temporary)
            token_path = temporary / "synthetic-only.token"
            token_path.write_text(SYNTHETIC_TOKEN, encoding="ascii")
            os.chmod(token_path, 0o600)
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = "http://127.0.0.1:" + str(server.server_port) + "/fixture"
                # Only transport URL/token path change. Parser tables stay byte-for-byte as reviewed.
                config = template.replace(LIVE_URL, url).replace(LIVE_TOKEN_FILE, token_path.as_posix())
                config_path = temporary / "synthetic-input-only.conf"
                config_path.write_bytes(config.encode("utf-8"))
                process = subprocess.run([str(binary), "--config", str(config_path), "--test", "--input-filter", "http"], capture_output=True, text=True, timeout=25, check=True, env=environment)
                lines = validate(process.stdout, process.stderr, expected_records(payload))
                if requests != [True, True, True]:
                    raise ValueError("Expected exactly three authenticated loopback GETs")
                canonical = {json.dumps(parse_metric(line), sort_keys=True) for line in lines}
                if case == cases[0][0]:
                    first_lines = canonical
                if case == "historical_repeat" and canonical != first_lines:
                    raise ValueError("Repeated samples changed original timestamps or values")
                results.append({"case": case, "passed": True, "metricCount": len(lines), "authenticatedLoopbackRequests": len(requests), "syntheticLineProtocol": lines})
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
    report = {"status": "NativeSyntheticParserPassed", "nativeVersion": version, "nativeSha256": binary_sha, "templateSha256": TEMPLATE_SHA, "syntheticOnly": True, "liveFredContacted": False, "influxWrites": False, "backendOrScheduleChanges": False, "cases": results}
    if args.report:
        with args.report.open("x", encoding="utf-8") as stream:
            json.dump(report, stream, indent=2)
            stream.write("\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
