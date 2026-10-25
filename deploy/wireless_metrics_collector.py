#!/usr/bin/env python3
"""Collect read-only Aruba Mobility Master metrics and write to InfluxDB."""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import re
import statistics
import time
from typing import Any, Iterable
from urllib import parse, request

import paramiko


MAC_RE = re.compile(r"^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$", re.I)
IPV4_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")
SSID_RE = re.compile(
    r"(?P<ssid>SCCC Guest|SCCC Wireless|SCCC IoT|West Wireless)/"
    r"(?P<bssid>(?:[0-9a-f]{2}:){5}[0-9a-f]{2})/(?P<phy>\S+)",
    re.I,
)
DEFAULT_NODES = (
    ("controller1", "/md/SCCC/20:4c:03:b6:69:42"),
    ("controller2", "/md/SCCC/20:4c:03:b6:68:22"),
)


@dataclass(frozen=True)
class ArubaSnapshot:
    users: list[dict[str, Any]]
    bsses: dict[str, dict[str, Any]]
    aps: dict[str, dict[str, Any]]
    radius: dict[str, dict[str, int | float]]


def env_required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"required environment variable {name} is missing")
    return value


def parse_nodes(value: str | None) -> tuple[tuple[str, str], ...]:
    if not value:
        return DEFAULT_NODES
    nodes: list[tuple[str, str]] = []
    for item in value.split(","):
        label, separator, path = item.strip().partition(":")
        if not separator or not label or not path.startswith("/"):
            raise ValueError("MM_NODES must contain comma-separated label:/md/path entries")
        nodes.append((label, path))
    return tuple(nodes)


def read_quiet(channel: paramiko.Channel, timeout: int = 45, quiet: float = 1.0) -> str:
    chunks: list[str] = []
    deadline = time.time() + timeout
    quiet_until = time.time() + quiet
    while time.time() < deadline:
        if channel.recv_ready():
            chunks.append(channel.recv(65535).decode("utf-8", "replace"))
            quiet_until = time.time() + quiet
        elif time.time() >= quiet_until:
            break
        time.sleep(0.1)
    return "".join(chunks).replace("\r", "")


def run_command(channel: paramiko.Channel, command: str, timeout: int = 60) -> str:
    while channel.recv_ready():
        channel.recv(65535)
    channel.send(command + "\n")
    time.sleep(0.25)
    output = read_quiet(channel, timeout=timeout)
    if "Invalid input" in output or "Unknown command" in output:
        raise RuntimeError(f"Aruba rejected command: {command}")
    return output


def split_columns(line: str) -> list[str]:
    return [column.strip() for column in re.split(r"\s{2,}", line.strip()) if column.strip()]


def valid_ipv4(value: str) -> bool:
    if not IPV4_RE.fullmatch(value):
        return False
    octets = [int(part) for part in value.split(".")]
    return all(0 <= part <= 255 for part in octets) and value != "0.0.0.0" and not value.startswith("169.254.")


def parse_bss_table(text: str) -> dict[str, dict[str, Any]]:
    bsses: dict[str, dict[str, Any]] = {}
    for line in text.splitlines():
        columns = split_columns(line)
        if len(columns) < 9 or not MAC_RE.fullmatch(columns[0]):
            continue
        try:
            clients = int(columns[7])
        except ValueError:
            continue
        bssid = columns[0].lower()
        bsses[bssid] = {
            "bssid": bssid,
            "ssid": columns[1],
            "ip": columns[3],
            "band": columns[4].split("/", 1)[0],
            "clients": clients,
            "ap": columns[8],
        }
    return bsses


def parse_users(text: str, controller: str) -> list[dict[str, Any]]:
    users: list[dict[str, Any]] = []
    for line in text.splitlines():
        match = SSID_RE.search(line)
        if not match:
            continue
        leading = line[: match.start()].split()
        if len(leading) < 2 or not MAC_RE.fullmatch(leading[1]):
            continue
        users.append(
            {
                "ip": leading[0],
                "mac": leading[1].lower(),
                "ssid": match.group("ssid"),
                "bssid": match.group("bssid").lower(),
                "phy": match.group("phy"),
                "controller": controller,
            }
        )
    return users


def parse_ap_database(text: str) -> dict[str, dict[str, Any]]:
    aps: dict[str, dict[str, Any]] = {}
    for line in text.splitlines():
        columns = split_columns(line)
        if len(columns) < 5 or not IPV4_RE.fullmatch(columns[3]):
            continue
        status = columns[4].lower()
        if not (status.startswith("up") or status == "down"):
            continue
        candidate = {
            "ap": columns[0], "group": columns[1], "type": columns[2],
            "ip": columns[3], "up": status.startswith("up"),
        }
        existing = aps.get(columns[0])
        if existing is None or (candidate["up"] and not existing["up"]):
            aps[columns[0]] = candidate
    return aps


def parse_radius_statistics(text: str) -> dict[str, dict[str, int | float]]:
    servers: dict[str, dict[str, int | float]] = {}
    for line in text.splitlines():
        columns = line.split()
        if len(columns) < 18 or not columns[0].startswith("SCCC_CPPM"):
            continue
        try:
            servers[columns[0]] = {
                "accept_total": int(columns[9]), "reject_total": int(columns[10]),
                "timeout_total": int(columns[14]), "avg_response_ms": float(columns[15]),
                "requests_total": int(columns[16]), "responses_total": int(columns[17]),
            }
        except ValueError:
            continue
    return servers


def merge_aps(current: dict[str, dict[str, Any]], incoming: dict[str, dict[str, Any]]) -> None:
    for name, candidate in incoming.items():
        existing = current.get(name)
        if existing is None or (candidate["up"] and not existing["up"]):
            current[name] = candidate


def collect_snapshot() -> ArubaSnapshot:
    client = paramiko.SSHClient()
    client.load_host_keys(env_required("MM_KNOWN_HOSTS"))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(
        env_required("MM_HOST"), port=int(os.environ.get("MM_PORT", "22")),
        username=env_required("MM_USER"), password=env_required("MM_PASSWORD"),
        look_for_keys=False, allow_agent=False, timeout=15, auth_timeout=20, banner_timeout=20,
    )
    channel = client.invoke_shell(width=420, height=180)
    time.sleep(1)
    read_quiet(channel, timeout=5)
    run_command(channel, "no paging")

    users_by_mac: dict[str, dict[str, Any]] = {}
    bsses: dict[str, dict[str, Any]] = {}
    aps: dict[str, dict[str, Any]] = {}
    radius: dict[str, dict[str, int | float]] = {}
    try:
        for label, node in parse_nodes(os.environ.get("MM_NODES")):
            run_command(channel, f"cd {node}")
            run_command(channel, "mdconnect", timeout=30)
            run_command(channel, "no paging")
            user_text = run_command(channel, "show user-table", timeout=75)
            bss_text = run_command(channel, "show ap bss-table", timeout=75)
            ap_text = run_command(channel, "show ap database", timeout=75)
            radius_text = run_command(channel, "show aaa authentication-server radius statistics", timeout=60)
            bsses.update(parse_bss_table(bss_text))
            merge_aps(aps, parse_ap_database(ap_text))
            radius.update(parse_radius_statistics(radius_text))
            for user in parse_users(user_text, label):
                existing = users_by_mac.get(user["mac"])
                if existing is None or (valid_ipv4(user["ip"]) and not valid_ipv4(existing["ip"])):
                    users_by_mac[user["mac"]] = user
            run_command(channel, "exit")
    finally:
        client.close()

    if not aps or not bsses or not radius:
        raise RuntimeError("Mobility Master returned an incomplete AP/BSS/RADIUS snapshot")
    return ArubaSnapshot(list(users_by_mac.values()), bsses, aps, radius)


BUILDING_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"SLC|NorthMansion|SouthMansion", re.I), "Student Living Center"),
    (re.compile(r"COS", re.I), "Cosmetology"),
    (re.compile(r"CAH|HealthCenter|\bAH", re.I), "Colvin Adult Health"),
    (re.compile(r"(?:^|[- ])(?:SA|SW|SU|SCC)(?:[- ]|\d)", re.I), "Student Union / Activities"),
    (re.compile(r"(?:^|[- ])(?:TA|TB|TD|T)(?:[- ]|\d)", re.I), "Technical School"),
    (re.compile(r"(?:^|[- ])H(?:[- ]|\d)", re.I), "Humanities"),
    (re.compile(r"(?:^|[- ])(?:AA|A)(?:[- ]|\d)", re.I), "Main Campus"),
    (re.compile(r"West", re.I), "West Campus"),
    (re.compile(r"SoftBall|GYM|Baseball|Soccer|Stadium", re.I), "Athletics"),
)
GROUP_BUILDINGS = {
    "slc-apgrp": "Student Living Center", "cos-apgrp": "Cosmetology",
    "ah-apgrp": "Colvin Adult Health", "h-apgrp": "Humanities",
    "t-apgrp": "Technical School", "a-apgrp": "Main Campus",
    "s-apgrp": "Student Union / Activities",
}


def building_for(ap_name: str, ap_group: str = "") -> str:
    for pattern, building in BUILDING_RULES:
        if pattern.search(ap_name):
            return building
    return GROUP_BUILDINGS.get(ap_group.lower(), "Unknown")


def percentile(values: list[int], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return float(ordered[max(0, math.ceil(len(ordered) * fraction) - 1)])


def load_state(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def counter_delta(current: int, previous: Any) -> int:
    try:
        old = int(previous)
    except (TypeError, ValueError):
        return 0
    return current - old if current >= old else current


def build_metrics(snapshot: ArubaSnapshot, previous_state: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    ap_clients: dict[str, int] = defaultdict(int)
    ap_ssids: dict[str, set[str]] = defaultdict(set)
    for bss in snapshot.bsses.values():
        ap_clients[bss["ap"]] += int(bss["clients"])
        ap_ssids[bss["ap"]].add(bss["ssid"])

    user_counts: dict[str, int] = defaultdict(int)
    no_ipv4_counts: dict[str, int] = defaultdict(int)
    building_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    band_counts: dict[str, int] = defaultdict(int)
    for user in snapshot.users:
        bss = snapshot.bsses.get(user["bssid"], {})
        ap_name = str(bss.get("ap", "Unknown"))
        ap = snapshot.aps.get(ap_name, {})
        building = building_for(ap_name, str(ap.get("group", "")))
        ssid = user["ssid"]
        user_counts[ssid] += 1
        building_counts[building]["clients"] += 1
        if ssid == "SCCC Guest":
            building_counts[building]["guest_clients"] += 1
        if ssid in {"SCCC Wireless", "West Wireless"}:
            building_counts[building]["authenticated_clients"] += 1
        if not valid_ipv4(user["ip"]):
            no_ipv4_counts[ssid] += 1
            building_counts[building]["clients_without_ipv4"] += 1
        band_counts[str(bss.get("band", "unknown")).lower()] += 1

    up_ap_counts: dict[str, int] = defaultdict(int)
    down_ap_counts: dict[str, int] = defaultdict(int)
    for ap in snapshot.aps.values():
        building = building_for(ap["ap"], ap["group"])
        (up_ap_counts if ap["up"] else down_ap_counts)[building] += 1

    current_radius_state: dict[str, dict[str, int]] = {}
    radius_metrics: list[dict[str, Any]] = []
    radius_delta_totals: dict[str, int] = defaultdict(int)
    previous_radius = previous_state.get("radius", {}) if isinstance(previous_state.get("radius"), dict) else {}
    for server, counters in sorted(snapshot.radius.items()):
        old = previous_radius.get(server, {}) if isinstance(previous_radius.get(server), dict) else {}
        fields = dict(counters)
        for field in ("accept_total", "reject_total", "timeout_total"):
            delta_name = field.replace("_total", "_delta")
            fields[delta_name] = counter_delta(int(counters[field]), old.get(field))
            radius_delta_totals[delta_name] += int(fields[delta_name])
        current_radius_state[server] = {field: int(counters[field]) for field in ("accept_total", "reject_total", "timeout_total")}
        radius_metrics.append({"measurement": "aruba_radius_server", "tags": {"server": server}, "fields": fields})

    clients_per_up_ap = [ap_clients.get(ap["ap"], 0) for ap in snapshot.aps.values() if ap["up"]]
    total_clients = len(snapshot.users)
    total_up_aps = sum(1 for ap in snapshot.aps.values() if ap["up"])
    summary_fields: dict[str, int | float] = {
        "clients_total": total_clients,
        "guest_clients": user_counts["SCCC Guest"],
        "sccc_wireless_clients": user_counts["SCCC Wireless"],
        "west_wireless_clients": user_counts["West Wireless"],
        "iot_clients": user_counts["SCCC IoT"],
        "authenticated_clients": user_counts["SCCC Wireless"] + user_counts["West Wireless"],
        "clients_without_ipv4": sum(no_ipv4_counts.values()),
        "aps_up": total_up_aps,
        "aps_down": sum(1 for ap in snapshot.aps.values() if not ap["up"]),
        "avg_clients_per_ap": (total_clients / total_up_aps) if total_up_aps else 0.0,
        "median_clients_per_ap": statistics.median(clients_per_up_ap) if clients_per_up_ap else 0.0,
        "p95_clients_per_ap": percentile(clients_per_up_ap, 0.95),
        "max_clients_per_ap": max(clients_per_up_ap, default=0),
        "clients_2_4ghz": sum(value for key, value in band_counts.items() if key.startswith("2.4")),
        "clients_5ghz": sum(value for key, value in band_counts.items() if key.startswith("5")),
        "clients_6ghz": sum(value for key, value in band_counts.items() if key.startswith("6")),
        **radius_delta_totals,
    }
    metrics: list[dict[str, Any]] = [
        {"measurement": "aruba_wireless_summary", "tags": {"campus": "SCCC"}, "fields": summary_fields},
        *radius_metrics,
    ]

    for ssid in ("SCCC Guest", "SCCC Wireless", "West Wireless", "SCCC IoT"):
        serving_aps = {bss["ap"] for bss in snapshot.bsses.values() if bss["ssid"] == ssid}
        metrics.append({
            "measurement": "aruba_wireless_ssid", "tags": {"ssid": ssid},
            "fields": {"clients": user_counts[ssid], "clients_without_ipv4": no_ipv4_counts[ssid], "aps_serving": len(serving_aps)},
        })

    all_buildings = set(building_counts) | set(up_ap_counts) | set(down_ap_counts)
    for building in sorted(all_buildings):
        fields = building_counts[building]
        aps_up = up_ap_counts[building]
        metrics.append({
            "measurement": "aruba_wireless_building", "tags": {"building": building},
            "fields": {
                "clients": fields["clients"], "guest_clients": fields["guest_clients"],
                "authenticated_clients": fields["authenticated_clients"],
                "clients_without_ipv4": fields["clients_without_ipv4"],
                "aps_up": aps_up, "aps_down": down_ap_counts[building],
                "avg_clients_per_ap": (fields["clients"] / aps_up) if aps_up else 0.0,
            },
        })

    for ap_name, ap in sorted(snapshot.aps.items()):
        metrics.append({
            "measurement": "aruba_wireless_ap",
            "tags": {"ap": ap_name, "building": building_for(ap_name, ap["group"]), "group": ap["group"], "model": ap["type"]},
            "fields": {"clients": ap_clients.get(ap_name, 0), "up": 1 if ap["up"] else 0, "ssids": len(ap_ssids.get(ap_name, set()))},
        })

    return metrics, {"radius": current_radius_state, "updated_at": int(time.time())}


def escape_tag(value: Any) -> str:
    return str(value).replace("\\", "\\\\").replace(" ", "\\ ").replace(",", "\\,").replace("=", "\\=")


def field_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return f"{value}i"
    if isinstance(value, float):
        return repr(value) if math.isfinite(value) else "0.0"
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def line_protocol(metrics: Iterable[dict[str, Any]], timestamp: int | None = None) -> str:
    stamp = int(time.time()) if timestamp is None else timestamp
    lines: list[str] = []
    for metric in metrics:
        tag_text = "".join(f",{escape_tag(key)}={escape_tag(value)}" for key, value in sorted(metric["tags"].items()))
        fields = ",".join(f"{escape_tag(key)}={field_value(value)}" for key, value in sorted(metric["fields"].items()))
        lines.append(f"{escape_tag(metric['measurement'])}{tag_text} {fields} {stamp}")
    return "\n".join(lines) + "\n"


def write_influx(payload: str) -> None:
    base = env_required("INFLUX_URL").rstrip("/")
    query = parse.urlencode({"org": env_required("INFLUX_ORG"), "bucket": env_required("INFLUX_BUCKET"), "precision": "s"})
    http_request = request.Request(
        f"{base}/api/v2/write?{query}", data=payload.encode("utf-8"), method="POST",
        headers={"Authorization": f"Token {env_required('INFLUX_TOKEN')}", "Content-Type": "text/plain; charset=utf-8"},
    )
    with request.urlopen(http_request, timeout=20) as response:
        if response.status not in (200, 204):
            raise RuntimeError(f"InfluxDB returned HTTP {response.status}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--state-file", default=os.environ.get("WIRELESS_STATE_FILE", "/var/lib/sccc-wireless-metrics/state.json"))
    args = parser.parse_args()
    state_path = Path(args.state_file)
    snapshot = collect_snapshot()
    observed_at = datetime_now_utc()
    metrics, next_state = build_metrics(snapshot, load_state(state_path))
    payload = line_protocol(metrics)
    if args.dry_run:
        print(payload, end="")
        return 0
    write_influx(payload)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = state_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(next_state, sort_keys=True), encoding="utf-8")
    os.replace(temporary, state_path)
    # Reuse this controller poll for diagnostics location; never poll again or
    # export client/user identities. Unknown and down APs cannot establish place.
    sidecar = state_path.with_name("diagnostics-observations.json")
    temporary_sidecar = sidecar.with_suffix(".tmp")
    with temporary_sidecar.open("w", encoding="utf-8") as handle:
        os.chmod(temporary_sidecar, 0o600)
        json.dump(diagnostics_observations(snapshot, observed_at), handle)
    os.replace(temporary_sidecar, sidecar)
    print(f"wrote {len(metrics)} wireless metric series")
    return 0


def datetime_now_utc() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def diagnostics_observations(snapshot: ArubaSnapshot, observed_at: str) -> dict[str, Any]:
    observations = []
    by_bssid = {}
    for bssid, bss in snapshot.bsses.items():
        ap_name = str(bss.get("ap", ""))
        ap = snapshot.aps.get(ap_name, {})
        building = building_for(ap_name, str(ap.get("group", "")))
        if not MAC_RE.fullmatch(bssid) or not ap.get("up") or building == "Unknown":
            continue
        observation = {"source": "wifi", "edge": True, "bssid": bssid.lower(),
                       "building": building, "observedAt": observed_at}
        observations.append(observation)
        by_bssid[bssid.lower()] = observation
    for client in snapshot.users:
        mac = str(client.get("mac", "")).lower()
        association = by_bssid.get(str(client.get("bssid", "")).lower())
        if not association or not MAC_RE.fullmatch(mac) or int(mac[:2], 16) & 1 or mac == "00:00:00:00:00:00":
            continue
        observations.append(dict(association, mac=mac))
    return {"schema": "sccc.network.wifi_location.v1", "observations": observations}


if __name__ == "__main__":
    raise SystemExit(main())
