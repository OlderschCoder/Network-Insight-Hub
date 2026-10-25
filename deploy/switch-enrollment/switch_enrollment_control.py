#!/usr/bin/env python3
"""Collector-local switch discovery and guarded SNMP/Telegraf enrollment."""

from __future__ import annotations

import argparse
import base64
import csv
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import tomllib
import urllib.parse
import urllib.request
import uuid

if os.name != "nt":
    import fcntl


APP_ROOT = Path(os.environ.get("FRED_ENROLLMENT_ROOT", Path.home() / "fred-network-enrollment"))
OPS_ROOT = Path(os.environ.get("FRED_OPS_ROOT", Path.home() / "sccc-ops"))
TELEGRAF_CONFIG = OPS_ROOT / "telegraf" / "telegraf.conf"
SECRETS_FILE = APP_ROOT / "secrets" / ".env"
INVENTORY_FILE = APP_ROOT / "all-switches.csv"
DEVICE_CATALOG = APP_ROOT / "devices.csv"
OUTPUT_ROOT = APP_ROOT / "out" / "switch-enrollment"
LOCK_FILE = APP_ROOT / ".switch-enrollment.lock"
VAULT_ROOT = Path.home() / "netbackup"
SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
SAFE_LABEL = re.compile(r"^[A-Za-z0-9 ._()/&'-]{1,80}$")


class EnrollmentError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def require_private_ipv4(value: object) -> str:
    try:
        address = ipaddress.ip_address(str(value or "").strip())
    except ValueError as exc:
        raise EnrollmentError("A valid switch management IP is required") from exc
    if address.version != 4 or not address.is_private or address.is_loopback or address.is_link_local:
        raise EnrollmentError("Switch enrollment is limited to private IPv4 management addresses")
    return str(address)


def parse_dotenv(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise EnrollmentError(f"Protected credential file is missing: {path}")
    values: dict[str, str] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise EnrollmentError(f"Credential file line {number} is malformed")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise EnrollmentError(f"Credential file line {number} has an invalid key")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'\"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def credential_environment(path: Path = SECRETS_FILE) -> tuple[dict[str, str], str]:
    values = parse_dotenv(path)
    environment = os.environ.copy()
    aliases = {
        "FRED_SWITCH_SSH_PASSWORD": ("FRED_SWITCH_SSH_PASSWORD", "SWITCH_PASS", "switch_password"),
        "FRED_SWITCH_SSH_FALLBACK_PASSWORD": ("FRED_SWITCH_SSH_FALLBACK_PASSWORD", "SWITCH_PASS_FALLBACK"),
        "FRED_SWITCH_ENABLE_SECRET": ("FRED_SWITCH_ENABLE_SECRET", "SWITCH_ENABLE_PASS"),
        "FRED_SNMP_AUTH_PASSWORD": ("FRED_SNMP_AUTH_PASSWORD", "AUTH_PW", "MonitorUser_Authentication"),
        "FRED_SNMP_PRIV_PASSWORD": ("FRED_SNMP_PRIV_PASSWORD", "PRIV_PW", "MonitorUser_Privacy"),
        "FRED_NETWORK_BACKUP_KEY_B64": ("FRED_NETWORK_BACKUP_KEY_B64", "NETWORK_BACKUP_KEY_B64"),
    }
    for canonical, candidates in aliases.items():
        value = next((values.get(name, "") for name in candidates if values.get(name, "")), "")
        if value:
            environment[canonical] = value
    for name in (
        "SWITCH_USER",
        "SWITCH_USER_FALLBACK",
        "SWITCH_PASS",
        "SWITCH_PASS_FALLBACK",
        "SWITCH_ENABLE_PASS",
        "NETWORK_BACKUP_KEY_B64",
    ):
        if values.get(name):
            environment[name] = values[name]
    snmp_user = values.get("FRED_SNMP_USER") or values.get("SMNP_User") or values.get("SNMP_USER") or "MonitorUser"
    required = (
        "FRED_SWITCH_SSH_PASSWORD",
        "FRED_SNMP_AUTH_PASSWORD",
        "FRED_SNMP_PRIV_PASSWORD",
        "FRED_NETWORK_BACKUP_KEY_B64",
    )
    missing = [name for name in required if not environment.get(name)]
    if missing:
        raise EnrollmentError("Collector credentials are incomplete: " + ", ".join(missing))
    return environment, snmp_user


def decode_request(encoded: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,8192}", encoded):
        raise EnrollmentError("Enrollment request encoding is invalid")
    padding = "=" * (-len(encoded) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded + padding).decode("utf-8"))
    except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
        raise EnrollmentError("Enrollment request could not be decoded") from exc
    if not isinstance(payload, dict):
        raise EnrollmentError("Enrollment request must be an object")
    return payload


def run_logged(command: list[str], *, environment: dict[str, str], log: Path, timeout: int) -> None:
    with log.open("w", encoding="utf-8") as handle:
        completed = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=handle,
            stderr=subprocess.STDOUT,
            env=environment,
            timeout=timeout,
            check=False,
            text=True,
        )
    if completed.returncode != 0:
        raise EnrollmentError(f"{command[1] if len(command) > 1 else command[0]} failed; review collector job log")


def write_collection_manifest(path: Path, ip: str, building: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=("name", "ip", "building"))
        writer.writeheader()
        writer.writerow({"name": f"candidate-{ip.replace('.', '-')}", "ip": ip, "building": building})


def collect_facts(ip: str, work: Path, environment: dict[str, str]) -> dict:
    manifest = work / "collection.csv"
    aggregate_path = work / "telemetry.json"
    write_collection_manifest(manifest, ip, "Pending enrollment")
    child_environment = environment.copy()
    child_environment.update(
        FRED_INVENTORY_FILE=str(manifest),
        OUT_DIR=str(work),
        OUTPUT_JSON=str(aggregate_path),
        PYTHONUNBUFFERED="1",
    )
    run_logged(
        [
            sys.executable,
            str(APP_ROOT / "collect_switch_ports.py"),
            "--workers",
            "1",
            "--output-json",
            str(aggregate_path),
        ],
        environment=child_environment,
        log=work / "collection.log",
        timeout=150,
    )
    aggregate = json.loads(aggregate_path.read_text(encoding="utf-8"))
    records = aggregate.get("switches") if isinstance(aggregate, dict) else None
    if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
        raise EnrollmentError("Collector did not return exactly one switch record")
    record = records[0]
    if record.get("ok") is not True:
        errors = record.get("errors") if isinstance(record.get("errors"), list) else []
        raise EnrollmentError("Switch discovery failed: " + "; ".join(str(item) for item in errors[:3]))
    device = record.get("device") if isinstance(record.get("device"), dict) else {}
    hostname = str(device.get("hostname") or record.get("switch_name") or "").strip()
    if not SAFE_NAME.fullmatch(hostname):
        raise EnrollmentError("Discovered hostname is missing or unsafe")
    interfaces = record.get("interfaces") if isinstance(record.get("interfaces"), list) else []
    neighbors = record.get("lldp_neighbors") if isinstance(record.get("lldp_neighbors"), list) else []
    mac_counts = record.get("mac_counts") if isinstance(record.get("mac_counts"), list) else []
    platform = str(record.get("device_type") or "").strip()
    if platform not in {"aruba_aoscx", "aruba_osswitch", "cisco_ios", "cisco_nxos"}:
        raise EnrollmentError(f"Unsupported discovered platform: {platform or 'unknown'}")
    return {
        "ip": ip,
        "hostname": hostname,
        "platform": platform,
        "vendor": device.get("vendor"),
        "model": device.get("model"),
        "models": device.get("models") if isinstance(device.get("models"), list) else [],
        "serialNumbers": device.get("serial_numbers") if isinstance(device.get("serial_numbers"), list) else [],
        "osVersion": device.get("os_version"),
        "interfaceCount": len(interfaces),
        "physicalInterfaceCount": sum(item.get("is_physical") is True for item in interfaces if isinstance(item, dict)),
        "lldpNeighborCount": len(neighbors),
        "macTablePortCount": len(mac_counts),
        "warnings": record.get("warnings") if isinstance(record.get("warnings"), list) else [],
    }


def read_csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise EnrollmentError(f"Inventory has no header: {path}")
        return list(reader.fieldnames), list(reader)


def find_inventory(ip: str) -> dict | None:
    for path in (INVENTORY_FILE, DEVICE_CATALOG):
        _, rows = read_csv_rows(path)
        match = next((row for row in rows if str(row.get("ip") or "").strip() == ip), None)
        if match:
            return {"source": str(path), **match}
    return None


def telegraf_targets(config: str) -> set[str]:
    return set(re.findall(r'udp://((?:\d{1,3}\.){3}\d{1,3}):161', "\n".join(
        line for line in config.splitlines() if not line.lstrip().startswith("#")
    )))


def preview(ip: str, work: Path, environment: dict[str, str]) -> dict:
    facts = collect_facts(ip, work, environment)
    config = TELEGRAF_CONFIG.read_text(encoding="utf-8")
    return {
        "schema": "sccc.network.switch_enrollment.preview.v1",
        "generatedAt": utc_now(),
        "facts": facts,
        "existingInventory": find_inventory(ip),
        "telegrafConfigured": ip in telegraf_targets(config),
        "configurationRequired": ip not in telegraf_targets(config),
    }


def write_target_file(path: Path, facts: dict, building: str, location: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        fields = ("enabled", "name", "ip", "platform", "location", "description", "notes")
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerow(
            {
                "enabled": "true",
                "name": facts["hostname"],
                "ip": facts["ip"],
                "platform": facts["platform"],
                "location": location,
                "description": f"{facts.get('vendor') or 'Network'} {facts.get('model') or 'switch'}",
                "notes": f"Enrolled from Fred; building {building}",
            }
        )


def write_disabled_firewall_file(path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=("enabled", "name", "ip", "credential_suffix"))
        writer.writeheader()
        writer.writerow({"enabled": "false", "name": "not-selected", "ip": "192.0.2.1", "credential_suffix": "NONE"})


def helper_values(output: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in output.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            if re.fullmatch(r"[A-Z_]+", key):
                values[key] = value
    return values


def guarded_telegraf_deploy(facts: dict, building: str, work: Path) -> dict:
    sys.path.insert(0, str(APP_ROOT))
    from configure_switch_snmp import Target, render_telegraf_targets  # type: ignore

    original = TELEGRAF_CONFIG.read_text(encoding="utf-8")
    target = Target(
        enabled=True,
        name=facts["hostname"],
        ip=facts["ip"],
        platform=facts["platform"],
        location=building,
        description=f"{facts.get('vendor') or 'Network'} {facts.get('model') or 'switch'}",
        notes="Enrolled from Fred",
    )
    candidate, additions, present = render_telegraf_targets(original, [target])
    if not additions:
        return {"changed": False, "alreadyPresent": present, "backup": None}

    token = uuid.uuid4().hex
    helper = APP_ROOT / "telegraf-deploy.sh"
    preflight = subprocess.run(
        [str(helper), "preflight", "sccc-ops", "telegraf/telegraf.conf", "grafana", "telegraf", "influxdb"],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    if helper_values(preflight.stdout).get("PREFLIGHT_STATUS") != "ready":
        raise EnrollmentError("Telegraf deployment preflight did not report ready")
    prepared = subprocess.run(
        [str(helper), "prepare", "sccc-ops", "telegraf/telegraf.conf", token],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    prepared_values = helper_values(prepared.stdout)
    candidate_path = Path(prepared_values["CANDIDATE_PATH"])
    expected_path = Path(prepared_values["EXPECTED_PATH"])
    try:
        candidate_path.write_text(candidate, encoding="utf-8")
        expected = sorted(telegraf_targets(candidate), key=ipaddress.ip_address)
        expected_path.write_text("".join(f"{item}\n" for item in expected), encoding="ascii")
        import hashlib
        digest = hashlib.sha256(candidate.encode("utf-8")).hexdigest()
        deployed = subprocess.run(
            [
                str(helper),
                "deploy",
                "sccc-ops",
                "telegraf/telegraf.conf",
                token,
                digest,
                str(len(expected)),
                "telegraf",
                "120",
                "telegraf",
                "grafana",
                "telegraf",
                "influxdb",
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=300,
        )
    except Exception:
        subprocess.run(
            [str(helper), "abort", "sccc-ops", "telegraf/telegraf.conf", token],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        raise
    values = helper_values(deployed.stdout)
    if values.get("DEPLOYMENT_STATUS") != "verified":
        raise EnrollmentError("Telegraf deployment did not report verified")
    return {"changed": True, "alreadyPresent": present, "backup": values.get("BACKUP_DIR")}


def verify_influx(ip: str, max_wait_seconds: int = 150) -> dict:
    with TELEGRAF_CONFIG.open("rb") as handle:
        output = tomllib.load(handle)["outputs"]["influxdb_v2"][0]
    flux = (
        f'from(bucket: "{output["bucket"]}") |> range(start: -5m) '
        f'|> filter(fn: (r) => r._measurement == "interface" and r._field == "ifHCInOctets" and r.source == "{ip}") '
        '|> group() |> last() |> keep(columns: ["_time", "_value", "source"])'
    )
    import time
    deadline = time.monotonic() + max_wait_seconds
    last_error = "no interface metric"
    while time.monotonic() < deadline:
        request = urllib.request.Request(
            f'http://127.0.0.1:8086/api/v2/query?org={urllib.parse.quote(output["organization"])}',
            data=flux.encode("utf-8"),
            headers={
                "Authorization": f'Token {output["token"]}',
                "Content-Type": "application/vnd.flux",
                "Accept": "application/csv",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                body = response.read().decode("utf-8")
            rows = [line for line in body.splitlines() if line and not line.startswith("#")]
            if len(rows) >= 2:
                parsed = list(csv.DictReader(rows))
                if parsed:
                    return {"verified": True, "lastPolled": parsed[0].get("_time")}
        except Exception as exc:
            last_error = exc.__class__.__name__
        time.sleep(10)
    raise EnrollmentError(f"Telegraf was updated, but fresh Influx telemetry was not verified ({last_error})")


def atomic_upsert(path: Path, key: str, value: str, row: dict[str, str]) -> None:
    fields, rows = read_csv_rows(path)
    if set(row) - set(fields):
        raise EnrollmentError(f"Inventory schema does not accept fields: {', '.join(sorted(set(row) - set(fields)))}")
    matches = [index for index, item in enumerate(rows) if str(item.get(key) or "").strip() == value]
    if len(matches) > 1:
        raise EnrollmentError(f"Inventory contains duplicate {key} values for {value}")
    complete = {field: row.get(field, "") for field in fields}
    if matches:
        rows[matches[0]] = complete
    else:
        rows.append(complete)
    temporary = path.with_name(path.name + ".new")
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    os.chmod(temporary, path.stat().st_mode)
    os.replace(temporary, path)


def update_inventory(facts: dict, building: str, location: str) -> None:
    atomic_upsert(
        INVENTORY_FILE,
        "ip",
        facts["ip"],
        {
            "enabled": "true",
            "name": facts["hostname"],
            "ip": facts["ip"],
            "platform": facts["platform"],
            "location": location,
            "description": f"{facts.get('vendor') or 'Network'} {facts.get('model') or 'switch'}",
            "notes": "Enrolled from Fred",
        },
    )
    atomic_upsert(
        DEVICE_CATALOG,
        "ip",
        facts["ip"],
        {
            "name": facts["hostname"],
            "ip": facts["ip"],
            "site": building,
            "device_type": "switch",
            "platform": facts["platform"],
            "status": "Canonical",
            "monitoring_required": "true",
            "snmp_workflow": "switch-enrollment",
            "canonical_ip": facts["ip"],
            "notes": "Enrolled from Fred",
            "last_reviewed": datetime.now(timezone.utc).date().isoformat(),
        },
    )


def apply_enrollment(request: dict, work: Path, environment: dict[str, str], snmp_user: str) -> dict:
    ip = require_private_ipv4(request.get("ip"))
    if request.get("confirm") != f"ENROLL {ip}":
        raise EnrollmentError(f"Apply requires exact confirmation: ENROLL {ip}")
    building = str(request.get("building") or "").strip()
    location = str(request.get("location") or building).strip()
    if not SAFE_LABEL.fullmatch(building) or not SAFE_LABEL.fullmatch(location):
        raise EnrollmentError("Building and location must be 1-80 safe display characters")
    facts = collect_facts(ip, work, environment)
    target_file = work / "target.csv"
    firewall_file = work / "disabled-firewalls.csv"
    write_target_file(target_file, facts, building, location)
    write_disabled_firewall_file(firewall_file)

    run_logged(
        [
            sys.executable,
            str(APP_ROOT / "backup_network_configs.py"),
            "--switches",
            str(target_file),
            "--firewalls",
            str(firewall_file),
            "--output-dir",
            str(VAULT_ROOT),
            "--workers",
            "1",
        ],
        environment=environment,
        log=work / "backup.log",
        timeout=180,
    )
    backup_runs = sorted((item for item in VAULT_ROOT.iterdir() if item.is_dir()), key=lambda item: item.name)
    backup_path = str(backup_runs[-1]) if backup_runs else None

    run_logged(
        [
            sys.executable,
            str(APP_ROOT / "configure_switch_snmp.py"),
            "--targets",
            str(target_file),
            "--mode",
            "apply",
            "--snmp-user",
            snmp_user,
            "--collector-address",
            "10.0.0.22",
            "--output-dir",
            str(work / "snmp"),
        ],
        environment=environment,
        log=work / "configure.log",
        timeout=180,
    )
    summary = json.loads((work / "snmp" / "latest-run.json").read_text(encoding="utf-8"))
    result = summary.get("results", [{}])[0]
    if result.get("error") or result.get("verified") is not True:
        raise EnrollmentError("Switch SNMP configuration did not pass read-back verification")

    telegraf = guarded_telegraf_deploy(facts, building, work)
    influx = verify_influx(ip)
    update_inventory(facts, building, location)
    return {
        "schema": "sccc.network.switch_enrollment.result.v1",
        "completedAt": utc_now(),
        "facts": facts,
        "building": building,
        "location": location,
        "switchConfiguration": {
            "verified": True,
            "applied": bool(result.get("applied")),
            "saved": bool(result.get("saved")),
            "alreadyConfigured": bool(result.get("skipped_existing_collector")),
        },
        "backup": backup_path,
        "telegraf": telegraf,
        "influx": influx,
        "inventoryUpdated": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request-b64", required=True)
    args = parser.parse_args()
    request = decode_request(args.request_b64)
    action = str(request.get("action") or "").strip().lower()
    ip = require_private_ipv4(request.get("ip"))
    environment, snmp_user = credential_environment()
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    work = OUTPUT_ROOT / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    work.mkdir(mode=0o700)
    with LOCK_FILE.open("a+", encoding="ascii") as lock:
        try:
            if os.name != "nt":
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            error = {
                "schema": "sccc.network.switch_enrollment.error.v1",
                "error": "Another switch enrollment job is already running",
                "jobPath": str(work),
            }
            (work / "error.json").write_text(json.dumps(error, indent=2), encoding="utf-8")
            print(json.dumps(error, separators=(",", ":")))
            return 1
        try:
            if action == "preview":
                result = preview(ip, work, environment)
            elif action == "apply":
                result = apply_enrollment(request, work, environment, snmp_user)
            else:
                raise EnrollmentError("Action must be preview or apply")
            (work / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(json.dumps(result, separators=(",", ":")))
            return 0
        except Exception as exc:
            error = {"schema": "sccc.network.switch_enrollment.error.v1", "error": str(exc), "jobPath": str(work)}
            (work / "error.json").write_text(json.dumps(error, indent=2), encoding="utf-8")
            print(json.dumps(error, separators=(",", ":")))
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
