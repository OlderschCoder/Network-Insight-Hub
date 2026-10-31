#!/usr/bin/env python3
"""Preflight and publish normalized switch telemetry to Fred over HTTPS.

Only fields accepted by the import schema are sent. Raw CLI remains on the
collector host. Every record must pass a read-only importer preflight before
the first write request is allowed.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


SCHEMA = "sccc.network.switchport_telemetry.v1"
DEFAULT_ENDPOINT = (
    "https://app-server2.centralus.cloudapp.azure.com/"
    "api/network-map/import/telemetry/switch"
)
INTERFACE_KEYS = {
    "port",
    "description",
    "name",
    "admin_status",
    "oper_status",
    "status",
    "enabled",
    "mode",
    "native_vlan",
    "vlan",
    "speed_mbps",
    "speed",
    "duplex",
    "media_type",
    "type",
    "is_physical",
}
NEIGHBOR_KEYS = {
    "local_port",
    "system_name",
    "management_addresses",
    "port_id",
    "chassis_id",
}


def selected(source: dict, keys: set[str]) -> dict:
    return {key: source[key] for key in keys if key in source}


def compact_switch(source: dict) -> dict:
    """Return only normalized, importer-approved fields."""
    return {
        "switch_name": source.get("switch_name"),
        "switch_ip": source.get("switch_ip"),
        "building": source.get("building"),
        "device_type": source.get("device_type"),
        "device": source.get("device"),
        "polled_at": source.get("polled_at"),
        "interfaces": [
            selected(item, INTERFACE_KEYS)
            for item in source.get("interfaces", [])
            if isinstance(item, dict) and str(item.get("port", "")).strip()
        ],
        "lldp_neighbors": [
            selected(item, NEIGHBOR_KEYS)
            for item in source.get("lldp_neighbors", [])
            if isinstance(item, dict)
        ],
        "mac_counts": source.get("mac_counts", []),
    }


def empty_result() -> dict:
    return {
        "schema": "sccc.network.switchport_telemetry.publish.v1",
        "run_id": None,
        "preflight_attempted": 0,
        "preflight_succeeded": 0,
        "preflight_failed": 0,
        "preflight_results": [],
        "attempted": 0,
        "applied": 0,
        "failed": 0,
        "results": [],
    }


def write_result(path: Path, output: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, indent=2), encoding="utf-8")


def print_counts(output: dict) -> None:
    print(
        json.dumps(
            {
                key: output[key]
                for key in (
                    "run_id",
                    "preflight_attempted",
                    "preflight_succeeded",
                    "preflight_failed",
                    "attempted",
                    "applied",
                    "failed",
                )
            }
        )
    )


def validate_aggregate(aggregate: object) -> tuple[list[dict] | None, str | None]:
    """Reject incomplete input before a request can mutate Fred."""
    if not isinstance(aggregate, dict):
        return None, "Telemetry aggregate must be a JSON object"
    if aggregate.get("schema") != SCHEMA:
        return None, "Telemetry aggregate schema is not supported"
    if not isinstance(aggregate.get("run_id"), str) or not aggregate["run_id"].strip():
        return None, "Telemetry aggregate has no run ID"

    switches = aggregate.get("switches")
    if not isinstance(switches, list) or not switches:
        return None, "Telemetry aggregate contains no switch records"

    invalid = []
    addresses = []
    for index, source in enumerate(switches):
        if not isinstance(source, dict):
            invalid.append(index)
            continue
        interfaces = source.get("interfaces")
        address = str(source.get("switch_ip") or "").strip()
        if (
            source.get("ok") is not True
            or not isinstance(interfaces, list)
            or not interfaces
            or not address
        ):
            invalid.append(index)
            continue
        addresses.append(address)

    if invalid:
        return None, (
            "Telemetry aggregate contains failed or ineligible records at indexes: "
            + ", ".join(str(index) for index in invalid)
        )
    if len(addresses) != len(set(addresses)):
        return None, "Telemetry aggregate contains duplicate switch IP addresses"
    if aggregate.get("switch_count") not in (None, len(switches)):
        return None, "Telemetry aggregate declared count does not match its records"
    return switches, None


def send_switch(
    endpoint: str,
    token: str,
    aggregate: dict,
    source: dict,
    *,
    dry_run: bool,
) -> dict:
    """Send one prevalidated record without retaining response bodies."""
    name = str(source.get("switch_name") or source.get("switch_ip") or "unknown")
    try:
        payload = {
            "schema": aggregate.get("schema"),
            "runId": aggregate.get("run_id"),
            "generatedAt": aggregate.get("generated_at"),
            "dryRun": dry_run,
            "switch": compact_switch(source),
        }
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "SCCC-Switch-Telemetry/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=45) as response:
            # Consume the response to prove completion, but do not retain a
            # body that could echo operational data or authentication context.
            response.read()
            return {"switch_name": name, "ok": True, "status": response.status}
    except urllib.error.HTTPError as exc:
        return {
            "switch_name": name,
            "ok": False,
            "status": exc.code,
            "error": exc.__class__.__name__,
        }
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {
            "switch_name": name,
            "ok": False,
            "status": None,
            "error": exc.__class__.__name__,
        }
    except (TypeError, ValueError, UnicodeError) as exc:
        return {
            "switch_name": name,
            "ok": False,
            "status": None,
            "error": exc.__class__.__name__,
        }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Preflight and publish approved switch telemetry to SCCC IT Hub"
    )
    parser.add_argument("aggregate", type=Path)
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args()

    output = empty_result()
    token = os.environ.get("SWITCH_TELEMETRY_TOKEN", "").strip()
    if not token:
        output["error"] = "SWITCH_TELEMETRY_TOKEN is not configured"
        write_result(args.result, output)
        print_counts(output)
        return 1

    try:
        aggregate = json.loads(args.aggregate.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        output["error"] = f"Could not load telemetry aggregate ({exc.__class__.__name__})"
        write_result(args.result, output)
        print_counts(output)
        return 1

    if isinstance(aggregate, dict):
        output["run_id"] = aggregate.get("run_id")
    switches, validation_error = validate_aggregate(aggregate)
    if validation_error:
        output["error"] = validation_error
        write_result(args.result, output)
        print_counts(output)
        return 1

    endpoint = os.environ.get("SWITCH_TELEMETRY_IMPORT_URL", DEFAULT_ENDPOINT).strip()
    parsed_endpoint = urllib.parse.urlparse(endpoint)
    if parsed_endpoint.scheme.lower() != "https" or not parsed_endpoint.hostname:
        output["error"] = "SWITCH_TELEMETRY_IMPORT_URL must be an absolute HTTPS URL"
        write_result(args.result, output)
        print_counts(output)
        return 1

    preflight_results = [
        send_switch(endpoint, token, aggregate, source, dry_run=True)
        for source in switches
    ]
    output["preflight_results"] = preflight_results
    output["preflight_attempted"] = len(preflight_results)
    output["preflight_succeeded"] = sum(item["ok"] for item in preflight_results)
    output["preflight_failed"] = sum(not item["ok"] for item in preflight_results)
    if output["preflight_failed"]:
        output["error"] = "One or more dry-run checks failed; no write requests were sent"
        write_result(args.result, output)
        print_counts(output)
        return 1

    results = []
    for source in switches:
        result = send_switch(endpoint, token, aggregate, source, dry_run=False)
        results.append(result)
        if not result["ok"]:
            break

    output["results"] = results
    output["attempted"] = len(results)
    output["applied"] = sum(item["ok"] for item in results)
    output["failed"] = sum(not item["ok"] for item in results)
    write_result(args.result, output)
    print_counts(output)
    return 1 if output["attempted"] != len(switches) or output["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
