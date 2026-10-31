import argparse
import csv
import hashlib
import json
import re
from pathlib import Path


SCHEMA = "sccc.network.switchport_telemetry.v1"


def canonical_hostname(value):
    return re.sub(r"\.sccc\.edu$", "", str(value or "").strip().lower())


def chassis_fingerprint(switch):
    rows = [
        (
            interface.get("port"),
            interface.get("description"),
            interface.get("native_vlan"),
            interface.get("media_type"),
        )
        for interface in switch.get("interfaces", [])
        if interface.get("is_physical") is True
    ]
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode("utf-8")).hexdigest()


def observed_chassis_members(switch):
    """Count observed Aruba VSF members from member/slot/port interface names."""
    physical_ports = [
        str(interface.get("port") or "")
        for interface in switch.get("interfaces", [])
        if interface.get("is_physical") is True
    ]
    if switch.get("device_type") == "aruba_aoscx":
        members = {match.group(1) for port in physical_ports if (match := re.match(r"^(\d+)/\d+/\d+$", port))}
        if members:
            return len(members)
    return 1


def audit(path: Path):
    aggregate = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(aggregate, dict):
        raise SystemExit("Telemetry aggregate must be a JSON object")
    if aggregate.get("schema") != SCHEMA:
        raise SystemExit(f"Expected {SCHEMA}, found {aggregate.get('schema')!r}")

    switches = aggregate.get("switches", [])
    if not isinstance(switches, list):
        raise SystemExit("Telemetry aggregate switches must be an array")
    malformed_indexes = [
        index
        for index, switch in enumerate(switches)
        if not isinstance(switch, dict)
    ]
    valid_switches = [switch for switch in switches if isinstance(switch, dict)]
    issues = []
    if not switches:
        issues.append("aggregate contains no switch records")
    if malformed_indexes:
        issues.append(
            "aggregate contains non-object switch records at indexes: "
            + ", ".join(str(index) for index in malformed_indexes)
        )

    observed_ok = sum(switch.get("ok") is True for switch in valid_switches)
    expected_counts = {
        "switch_count": len(switches),
        "switch_count_ok": observed_ok,
        "switch_count_failed": len(switches) - observed_ok,
    }
    for field, expected in expected_counts.items():
        if field in aggregate and aggregate.get(field) != expected:
            issues.append(
                f"aggregate {field} is {aggregate.get(field)!r}; observed record count is {expected}"
            )

    ok_switches = [switch for switch in valid_switches if switch.get("ok") is True]
    failed_switches = [switch for switch in valid_switches if switch.get("ok") is not True]
    target_names = {canonical_hostname(switch.get("switch_name")) for switch in ok_switches}
    target_ips = {switch.get("switch_ip") for switch in ok_switches}

    groups = {}
    for switch in ok_switches:
        physical = [interface for interface in switch.get("interfaces", []) if interface.get("is_physical") is True]
        if not physical:
            issues.append(f"{switch.get('switch_name')}: no physical interfaces")
        if not switch.get("building"):
            issues.append(f"{switch.get('switch_name')}: building is missing")
        for neighbor in switch.get("lldp_neighbors", []):
            fields = (neighbor.get("system_name"), neighbor.get("port_description"), neighbor.get("vlan_id"))
            if any(str(value or "").startswith(("Neighbor ", "TTL")) for value in fields):
                issues.append(f"{switch.get('switch_name')}: LLDP field crossed a CLI line boundary")
                break
        groups.setdefault(chassis_fingerprint(switch), []).append(switch)

    infrastructure_links = set()
    endpoint_or_unmatched = 0
    for fingerprint, aliases in groups.items():
        source = aliases[0]
        for neighbor in source.get("lldp_neighbors", []):
            neighbor_name = canonical_hostname(neighbor.get("system_name"))
            neighbor_ips = set(neighbor.get("management_addresses") or [])
            if neighbor_name in target_names or neighbor_ips.intersection(target_ips):
                infrastructure_links.add(
                    (
                        fingerprint,
                        neighbor.get("local_port"),
                        neighbor_name or sorted(neighbor_ips.intersection(target_ips))[0],
                        neighbor.get("port_id"),
                    )
                )
            else:
                endpoint_or_unmatched += 1

    duplicate_chassis = [
        {
            "records": [
                {
                    "switch_name": switch.get("switch_name"),
                    "switch_ip": switch.get("switch_ip"),
                    "building": switch.get("building"),
                }
                for switch in aliases
            ]
        }
        for aliases in groups.values()
        if len(aliases) > 1
    ]
    unique_physical_interfaces = sum(
        sum(interface.get("is_physical") is True for interface in aliases[0].get("interfaces", []))
        for aliases in groups.values()
    )
    observed_physical_chassis = sum(observed_chassis_members(aliases[0]) for aliases in groups.values())

    report = {
        "schema": "sccc.network.switchport_telemetry.audit.v1",
        "source_file": str(path.resolve()),
        "run_id": aggregate.get("run_id"),
        "generated_at": aggregate.get("generated_at"),
        "normalized_at": aggregate.get("normalized_at"),
        "passed": len(issues) == 0 and len(failed_switches) == 0,
        "issues": issues,
        "collector_records": len(switches),
        "records_ok": len(ok_switches),
        "records_failed": len(switches) - len(ok_switches),
        "unique_management_devices": len(groups),
        "unique_physical_chassis": observed_physical_chassis,
        "unique_physical_interfaces": unique_physical_interfaces,
        "candidate_infrastructure_lldp_links": len(infrastructure_links),
        "endpoint_or_unmatched_lldp_ignored": endpoint_or_unmatched,
        "duplicate_management_records": duplicate_chassis,
        "failed_switches": [
            {
                "switch_name": switch.get("switch_name"),
                "switch_ip": switch.get("switch_ip"),
                "building": switch.get("building"),
                "errors": switch.get("errors", []),
            }
            for switch in failed_switches
        ],
    }
    return aggregate, report


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit an SCCC switch telemetry aggregate")
    parser.add_argument("json", nargs="?", type=Path, default=Path("out/sccc_all_switches_single.json"))
    parser.add_argument("--report", type=Path, default=Path("out/telemetry_audit.json"))
    parser.add_argument("--csv", type=Path, default=Path("out/telemetry_switch_summary.csv"))
    args = parser.parse_args()

    aggregate, report = audit(args.json)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.csv.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")

    with args.csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=(
                "switch_name",
                "switch_ip",
                "building",
                "ok",
                "device_type",
                "model",
                "physical_interfaces",
                "logical_interfaces",
                "lldp_neighbors",
                "mac_count_ports",
                "errors",
                "warnings",
            ),
        )
        writer.writeheader()
        for index, switch in enumerate(aggregate.get("switches", [])):
            if not isinstance(switch, dict):
                writer.writerow(
                    {
                        "switch_name": f"invalid-record-{index}",
                        "ok": False,
                        "errors": "switch record is not a JSON object",
                    }
                )
                continue
            interfaces = switch.get("interfaces", [])
            writer.writerow(
                {
                    "switch_name": switch.get("switch_name"),
                    "switch_ip": switch.get("switch_ip"),
                    "building": switch.get("building"),
                    "ok": switch.get("ok"),
                    "device_type": switch.get("device_type"),
                    "model": (switch.get("device") or {}).get("model"),
                    "physical_interfaces": sum(interface.get("is_physical") is True for interface in interfaces),
                    "logical_interfaces": sum(interface.get("is_physical") is not True for interface in interfaces),
                    "lldp_neighbors": len(switch.get("lldp_neighbors", [])),
                    "mac_count_ports": len(switch.get("mac_counts", [])),
                    "errors": "; ".join(switch.get("errors", [])),
                    "warnings": "; ".join(switch.get("warnings", [])),
                }
            )

    print(json.dumps(report, indent=2))
    print(f"Report: {args.report.resolve()}")
    print(f"CSV: {args.csv.resolve()}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
