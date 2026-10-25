#!/usr/bin/env python3
"""Verify Fred has fresh interface telemetry for the approved firewalls."""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


SCHEMA = "sccc.network.firewall_telemetry.status.v1"
APPROVED_HOSTS = {"192.168.1.1", "172.25.0.1"}


def parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def evaluate(payload: object, *, now: datetime, max_age_minutes: int) -> dict:
    failures: list[dict] = []
    firewalls = payload.get("firewalls") if isinstance(payload, dict) else None
    if not isinstance(firewalls, list):
        return {
            "schema": SCHEMA,
            "checked_at": now.isoformat().replace("+00:00", "Z"),
            "expected": len(APPROVED_HOSTS),
            "ok": 0,
            "failed": len(APPROVED_HOSTS),
            "firewalls": [],
            "failures": [{"host": host, "reason": "invalid status response"} for host in sorted(APPROVED_HOSTS)],
        }

    by_host = {
        str(item.get("host") or "").strip(): item
        for item in firewalls
        if isinstance(item, dict)
    }
    for host in sorted(APPROVED_HOSTS):
        item = by_host.get(host)
        reason = None
        if item is None:
            reason = "missing from status response"
        elif item.get("configured") is not True or item.get("reachable") is not True:
            reason = "telemetry source is not configured or reachable"
        elif item.get("interfaceTelemetryAvailable") is not True or int(item.get("interfaceCount") or 0) < 1:
            reason = "no interface telemetry is available"
        else:
            observed = parse_timestamp(item.get("lastPolled"))
            if observed is None or now - observed > timedelta(minutes=max_age_minutes):
                reason = "telemetry is stale"
        if reason:
            failures.append({"host": host, "reason": reason})

    return {
        "schema": SCHEMA,
        "checked_at": now.isoformat().replace("+00:00", "Z"),
        "expected": len(APPROVED_HOSTS),
        "ok": len(APPROVED_HOSTS) - len(failures),
        "failed": len(failures),
        "firewalls": [by_host[host] for host in sorted(APPROVED_HOSTS) if host in by_host],
        "failures": failures,
    }


def query_influx(url: str, token: str, org: str, flux: str) -> list[dict]:
    request = urllib.request.Request(
        f"{url.rstrip('/')}/api/v2/query?org={urllib.parse.quote(org)}",
        data=flux.encode("utf-8"),
        headers={
            "Authorization": f"Token {token}",
            "Content-Type": "application/vnd.flux",
            "Accept": "application/csv",
            "User-Agent": "SCCC-Switch-Telemetry/1.1",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        lines = [line for line in response.read().decode("utf-8").splitlines() if line and not line.startswith("#")]
    return list(csv.DictReader(io.StringIO("\n".join(lines)))) if lines else []


def read_firewall_status(*, url: str, token: str, org: str, bucket: str) -> dict:
    host_filter = " or ".join(f'r.source == "{host}"' for host in sorted(APPROVED_HOSTS))
    base = (
        f'from(bucket: "{bucket}") |> range(start: -10m) '
        f'|> filter(fn: (r) => r._measurement == "interface" '
        f'and r._field == "ifHCInOctets" and ({host_filter})) '
        '|> group(columns: ["source"]) '
    )
    last_rows = query_influx(
        url,
        token,
        org,
        base + '|> last() |> keep(columns: ["source", "_time", "_value"])',
    )
    count_rows = query_influx(
        url,
        token,
        org,
        base + '|> distinct(column: "ifName") |> count()',
    )
    last_by_host = {str(row.get("source") or ""): row.get("_time") for row in last_rows}
    count_by_host = {
        str(row.get("source") or ""): int(row.get("_value") or 0)
        for row in count_rows
    }
    return {
        "firewalls": [
            {
                "host": host,
                "configured": True,
                "reachable": host in last_by_host,
                "lastPolled": last_by_host.get(host),
                "interfaceTelemetryAvailable": count_by_host.get(host, 0) > 0,
                "interfaceCount": count_by_host.get(host, 0),
            }
            for host in sorted(APPROVED_HOSTS)
        ]
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify fresh telemetry for both approved FortiGates")
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--max-age-minutes", type=int, default=10)
    args = parser.parse_args()

    url = os.environ.get("INFLUXDB_URL", "").strip()
    token = os.environ.get("INFLUXDB_TOKEN", "").strip()
    org = os.environ.get("INFLUXDB_ORG", "SCCC").strip()
    bucket = os.environ.get("INFLUXDB_BUCKET", "telegraf").strip()
    parsed_url = urllib.parse.urlparse(url)
    if not token or parsed_url.scheme.lower() not in {"http", "https"} or not parsed_url.hostname:
        raise SystemExit("A read-only InfluxDB URL and token are required")

    now = datetime.now(timezone.utc)
    try:
        payload = read_firewall_status(url=url, token=token, org=org, bucket=bucket)
    except (urllib.error.URLError, TimeoutError, OSError, UnicodeError, ValueError) as exc:
        payload = {"error": exc.__class__.__name__}

    result = evaluate(payload, now=now, max_age_minutes=args.max_age_minutes)
    args.result.parent.mkdir(parents=True, exist_ok=True)
    args.result.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("expected", "ok", "failed")}))
    return 0 if result["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
