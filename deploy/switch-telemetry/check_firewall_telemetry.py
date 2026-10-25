#!/usr/bin/env python3
"""Verify Fred has fresh interface telemetry for the approved firewalls."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


SCHEMA = "sccc.network.firewall_telemetry.status.v1"
DEFAULT_ENDPOINT = (
    "https://app-server2.centralus.cloudapp.azure.com/"
    "api/network-map/telemetry/firewalls/status"
)
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify fresh telemetry for both approved FortiGates")
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--max-age-minutes", type=int, default=10)
    args = parser.parse_args()

    token = os.environ.get("SWITCH_TELEMETRY_TOKEN", "").strip()
    endpoint = os.environ.get("FIREWALL_TELEMETRY_STATUS_URL", DEFAULT_ENDPOINT).strip()
    parsed_endpoint = urllib.parse.urlparse(endpoint)
    if not token or parsed_endpoint.scheme.lower() != "https" or not parsed_endpoint.hostname:
        raise SystemExit("A service token and absolute HTTPS firewall status URL are required")

    request = urllib.request.Request(
        endpoint,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "SCCC-Switch-Telemetry/1.1",
        },
        method="GET",
    )
    now = datetime.now(timezone.utc)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.load(response)
    except (urllib.error.URLError, TimeoutError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        payload = {"error": exc.__class__.__name__}

    result = evaluate(payload, now=now, max_age_minutes=args.max_age_minutes)
    args.result.parent.mkdir(parents=True, exist_ok=True)
    args.result.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("expected", "ok", "failed")}))
    return 0 if result["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
