#!/usr/bin/env python3
"""Join protected AD, existing switch telemetry and exact phone-owner mappings.

This adapter does not poll any device. It consumes collect_switch_ports.py's
existing aggregate, including raw_cli.mac (individual forwarding entries).
Ports must be positively identified as physical access ports or explicitly
approved edge ports, and cannot be excluded uplinks or known switch LLDP peers.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from pull_worker import atomic_write, read_json, timestamp, utc_now, validate_inventory

SCHEMA = "sccc.network.switchport_telemetry.v1"
MAC_RE = re.compile(r"^(?:(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|(?:[0-9a-f]{4}\.){2}[0-9a-f]{4}|[0-9a-f]{6}-[0-9a-f]{6})$", re.I)
PORT_RE = re.compile(r"^(?:(?:Ethernet|Eth|GigabitEthernet|Gi|FastEthernet|Fa|TenGigabitEthernet|Te|TwentyFiveGigE|Tw|FortyGigabitEthernet|Fo|HundredGigE|Hu)\d+(?:/\d+){0,3}|\d+(?:/\d+){0,3})$", re.I)


def normalize_mac(value: str) -> str:
    compact = re.sub(r"[:.\-]", "", value).lower()
    if not re.fullmatch(r"[0-9a-f]{12}", compact) or int(compact[:2], 16) & 1:
        raise ValueError("A unicast MAC address is required")
    if compact == "000000000000":
        raise ValueError("The unspecified MAC address is invalid")
    return ":".join(compact[index:index + 2] for index in range(0, 12, 2))


def normalize_port(value: object) -> str:
    value = str(value or "").strip().lower()
    for long_name, short_name in (("gigabitethernet", "gi"), ("fastethernet", "fa"),
                                  ("tengigabitethernet", "te"), ("ethernet", "eth")):
        if value.startswith(long_name):
            return short_name + value[len(long_name):]
    return value


def parse_forwarding_entries(raw: str) -> list[dict]:
    entries = []
    for line in raw.splitlines():
        tokens = line.split()
        index = next((position for position, token in enumerate(tokens) if MAC_RE.fullmatch(token)), None)
        if index is None:
            continue
        learned = next((position for position in range(index + 1, len(tokens))
                        if tokens[position].lower() in {"dynamic", "learned", "learn"}), None)
        if learned is None:
            continue
        # IOS/NX-OS/CX: VLAN MAC dynamic PORT. AOS-Switch also supports
        # MAC VLAN PORT dynamic. Reject logical bundles, CPU, and unknown syntax.
        port = tokens[learned - 1] if learned == len(tokens) - 1 else tokens[-1]
        if not PORT_RE.fullmatch(port):
            continue
        try:
            mac = normalize_mac(tokens[index])
        except ValueError:
            continue
        entries.append({"mac": mac, "port": port})
    return entries


def switch_observations(aggregate: dict, policy: dict, now: datetime | None = None) -> tuple[list[dict], list[str]]:
    now = now or utc_now()
    if aggregate.get("schema") != SCHEMA or not isinstance(aggregate.get("switches"), list):
        raise ValueError("Not a supported switch telemetry aggregate")
    switches = aggregate["switches"]
    names = {str(item.get("switch_name", "")).lower() for item in switches}
    ips = {str(item.get("switch_ip", "")) for item in switches}
    configured = {str(item.get("switchName", "")).lower(): item for item in policy.get("switches", [])}
    observations, warnings = [], []
    for switch in switches:
        name = str(switch.get("switch_name", ""))
        if switch.get("ok") is not True or not switch.get("building"):
            warnings.append(name + ": no successful building-tagged observation")
            continue
        age = (now - timestamp(switch.get("polled_at"))).total_seconds()
        if not -300 <= age <= 900:
            warnings.append(name + ": switch observation is stale or future-dated")
            continue
        port_policy = configured.get(name.lower(), {})
        approved = {normalize_port(port) for port in port_policy.get("approvedEdgePorts", [])}
        excluded = {normalize_port(port) for port in port_policy.get("excludedPorts", [])}
        for neighbor in switch.get("lldp_neighbors", []):
            if (str(neighbor.get("system_name", "")).lower() in names or
                    any(str(ip) in ips for ip in neighbor.get("management_addresses", []))):
                excluded.add(normalize_port(neighbor.get("local_port")))
        interfaces = {normalize_port(row.get("port")): row for row in switch.get("interfaces", [])}
        for entry in parse_forwarding_entries(str((switch.get("raw_cli") or {}).get("mac", ""))):
            port = normalize_port(entry["port"])
            interface = interfaces.get(port, {})
            access = (interface.get("mode") == "access" and interface.get("is_physical") is True)
            if port in excluded or (port not in approved and not access):
                continue
            if interface.get("mode") in {"trunk", "routed"} or interface.get("is_physical") is False:
                continue
            if interface.get("oper_status") not in (None, "up"):
                continue
            observations.append({"mac": entry["mac"], "building": switch["building"],
                                 "switchName": name, "port": entry["port"], "source": "switch",
                                 "observedAt": switch["polled_at"], "edge": True})
    return observations, warnings


def phone_assignments(owners: dict, mappings: dict) -> list[dict]:
    """Exact IDs only; user display-name matching would misattribute buildings."""
    by_id: dict[str, set[str]] = {}
    for row in owners.get("assignments", []):
        if row.get("webexPersonId") and row.get("building"):
            by_id.setdefault(row["webexPersonId"], set()).add(row["building"])
    result = []
    seen: dict[str, set[str]] = {}
    for row in mappings.get("users", []):
        username = str(row.get("username", "")).strip().lower()
        person_id = str(row.get("webexPersonId", "")).strip()
        qualified_identity = (re.fullmatch(r"[^@\s\\]+@[^@\s\\]+", username) or
                              re.fullmatch(r"[^@\s\\]+\\[^@\s\\]+", username))
        if not qualified_identity or not person_id or len(by_id.get(person_id, set())) != 1:
            continue
        seen.setdefault(username, set()).update(by_id[person_id])
    # Suppress duplicate/conflicting owner mappings. Timestamp comes from the
    # original phone assignment export, not the adapter execution time.
    for username, buildings in seen.items():
        if len(buildings) == 1:
            result.append({"username": username, "building": next(iter(buildings)),
                           "source": "desk-phone", "observedAt": owners["generatedAt"]})
    return result


def build_inventory(ad: dict, switch_data: dict | None = None, policy: dict | None = None,
                    wifi: dict | None = None, phone_owners: dict | None = None,
                    identities: dict | None = None, now: datetime | None = None) -> dict:
    now = now or utc_now()
    if ad.get("snapshotComplete") is not True or not isinstance(ad.get("adComputers"), list):
        raise ValueError("A complete trusted AD export is required")
    observations, warnings = (switch_observations(switch_data, policy or {}, now)
                              if switch_data else ([], ["Switch forwarding source is unavailable"]))
    # BSSID building must come from a trusted controller/AP inventory. A random
    # SSID string or the endpoint's own building claim is never accepted.
    if wifi:
        for row in wifi.get("observations", []):
            age = (now - timestamp(row.get("observedAt"))).total_seconds()
            if row.get("source") == "wifi" and row.get("edge") is True and -300 <= age <= 900:
                observations.append({"bssid": normalize_mac(row["bssid"]), "building": row["building"],
                                     "source": "wifi", "edge": True, "observedAt": row["observedAt"]})
    assignments = phone_assignments(phone_owners, identities) if phone_owners and identities else []
    ad_observed_at = ad.get("adObservedAt", ad.get("generatedAt"))
    value = {"generatedAt": ad_observed_at, "adObservedAt": ad_observed_at, "snapshotComplete": True,
             "adComputers": ad["adComputers"], "observations": observations,
             "userBuildingAssignments": assignments, "warnings": warnings}
    validate_inventory(value, now)
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ad", type=Path, required=True)
    parser.add_argument("--switches", type=Path)
    parser.add_argument("--edge-policy", type=Path)
    parser.add_argument("--wifi", type=Path)
    parser.add_argument("--phone-assignments", type=Path)
    parser.add_argument("--user-webex-map", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    load = lambda path: read_json(path) if path else None
    value = build_inventory(read_json(args.ad), load(args.switches), load(args.edge_policy),
                            load(args.wifi), load(args.phone_assignments), load(args.user_webex_map))
    atomic_write(args.output, json.dumps(value, separators=(",", ":")).encode())
    print(json.dumps({"ok": True, "adComputers": len(value["adComputers"]),
                      "observations": len(value["observations"]), "warnings": value["warnings"]}))


if __name__ == "__main__":
    main()
