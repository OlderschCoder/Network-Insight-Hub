#!/usr/bin/env python3
"""Surgically clean the live A - SCCC Network Overview Grafana dashboard.

The script reads the current dashboard through Grafana's API, creates a dated
backup, applies presentation-only corrections plus removal of proven broken or
duplicated panels, updates the dashboard in place, and verifies the result.
"""

from __future__ import annotations

import base64
import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


DASHBOARD_UID = "e7633483-9f63-4a1f-9d8e-84a5164954837"
DASHBOARD_TITLE = "A - SCCC Network Overview"
GRAFANA_URL = os.environ.get("GRAFANA_URL", "http://127.0.0.1:3000").rstrip("/")
BACKUP_DIR = Path(
    os.environ.get(
        "GRAFANA_DASHBOARD_BACKUP_DIR",
        "/home/ITADMIN/sccc-ops/grafana-new/backups",
    )
)


# Kept panels, ordered and placed on Grafana's 24-column grid.
LAYOUT = {
    43: (0, 0, 12, 8),   # Campus map
    30: (12, 0, 3, 4),  # Buildings online
    35: (15, 0, 3, 4),  # UPS devices online
    11: (18, 0, 3, 4),  # Packet loss
    37: (21, 0, 3, 4),  # Firewall throughput
    3: (12, 4, 6, 4),   # Campus backbone
    33: (18, 4, 6, 4),  # Nexus core throughput
    10: (0, 8, 12, 7),  # Latency trend
    42: (12, 8, 12, 7), # Packet-loss trend
    31: (0, 15, 12, 7), # Firewall ingress/egress
    25: (12, 15, 12, 7),# Top interfaces
    16: (0, 22, 6, 6),  # FortiGate CPU
    17: (6, 22, 18, 6), # FortiGate memory trend
    34: (0, 28, 12, 7), # Buildings not reporting
    23: (12, 28, 12, 7),# Inventory summary
    28: (0, 35, 12, 8), # Power by building
    29: (12, 35, 12, 8),# Monitored switches
    15: (0, 43, 24, 9), # Detailed monitored devices
}


PRESENTATION = {
    43: ("Live Campus Status Map", None, "Current building status and campus location context."),
    30: ("Buildings Online", "short", "Buildings currently represented by reporting infrastructure."),
    35: ("UPS Devices Online", "short", "UPS devices currently reporting telemetry."),
    11: ("Internet Packet Loss", "percent", "Current measured internet packet loss."),
    37: ("Current Firewall Throughput", "bps", "Combined current ingress and egress traffic through the FortiGate."),
    3: ("Current Campus Backbone Load", "bps", "Current aggregate load measured on the campus backbone."),
    33: ("Nexus Core Throughput", "bps", "Current aggregate throughput across monitored Nexus core interfaces."),
    10: ("Internet Latency Trend", "ms", "Internet round-trip latency over the selected time range."),
    42: ("Internet Packet Loss Trend", "percent", "Internet packet loss over the selected time range."),
    31: ("Firewall WAN Traffic", "bps", "Ingress and egress WAN traffic through the FortiGate."),
    25: ("Top Interface Throughput", "Mbits", "Highest-traffic monitored interfaces, shown in megabits per second."),
    16: ("FortiGate CPU Utilization", "percent", "Current FortiGate CPU utilization."),
    17: ("FortiGate Memory Utilization", "percent", "FortiGate memory utilization over the selected time range."),
    34: ("Buildings Not Reporting", None, "Buildings with expected infrastructure that is not currently reporting."),
    23: ("Infrastructure Inventory Summary", None, "Monitored device counts and current reporting status by device type."),
    28: ("Power Status by Building", None, "UPS and power-monitoring status grouped by building."),
    29: ("Monitored Switches", None, "Current monitored switch inventory and reporting state."),
    15: ("Monitored Devices", None, "Detailed expected-device inventory and current monitoring state."),
}


def docker_grafana_credentials() -> tuple[str, str]:
    raw = subprocess.check_output(
        [
            "docker",
            "inspect",
            "grafana",
            "--format",
            "{{range .Config.Env}}{{println .}}{{end}}",
        ],
        text=True,
    )
    values = {}
    for line in raw.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    user = values.get("GF_SECURITY_ADMIN_USER")
    password = values.get("GF_SECURITY_ADMIN_PASSWORD")
    if not user or not password:
        raise RuntimeError("Grafana container credentials are not configured")
    return user, password


def request(path: str, user: str, password: str, payload: dict | None = None) -> dict:
    headers = {
        "Authorization": "Basic "
        + base64.b64encode(f"{user}:{password}".encode()).decode(),
        "Accept": "application/json",
    }
    data = None
    method = "GET"
    if payload is not None:
        data = json.dumps(payload, separators=(",", ":")).encode()
        headers["Content-Type"] = "application/json"
        method = "POST"
    req = urllib.request.Request(GRAFANA_URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Grafana API returned HTTP {exc.code}: {detail}") from exc


def set_unit(panel: dict, unit: str | None) -> None:
    if not unit:
        return
    defaults = panel.setdefault("fieldConfig", {}).setdefault("defaults", {})
    defaults["unit"] = unit


def clean_dashboard(source: dict) -> dict:
    if source.get("uid") != DASHBOARD_UID or source.get("title") != DASHBOARD_TITLE:
        raise RuntimeError("Refusing to modify an unexpected dashboard")

    by_id = {panel.get("id"): panel for panel in source.get("panels", [])}
    missing = sorted(set(LAYOUT) - set(by_id))
    if missing:
        raise RuntimeError(f"Expected live panels are missing: {missing}")

    cleaned = []
    for panel_id, (x, y, w, h) in LAYOUT.items():
        panel = by_id[panel_id]
        title, unit, description = PRESENTATION[panel_id]
        panel["title"] = title
        panel["description"] = description
        panel["gridPos"] = {"x": x, "y": y, "w": w, "h": h}
        set_unit(panel, unit)

        # Suppress Flux implementation fields in executive-facing stat/gauge
        # labels while leaving time-series legends intact.
        if panel.get("type") in {"stat", "gauge", "bargauge", "barchart"}:
            defaults = panel.setdefault("fieldConfig", {}).setdefault("defaults", {})
            defaults["displayName"] = title
        cleaned.append(panel)

    source["panels"] = cleaned
    source["refresh"] = "1m"
    source["tags"] = sorted(set(source.get("tags", [])) | {"SCCC", "executive", "network"})
    source["description"] = (
        "Executive campus network overview. Values are live telemetry; missing "
        "data is left visible rather than converted into a healthy status."
    )
    source["editable"] = True
    return source


def file_mode(source_path: Path, output_path: Path) -> int:
    raw = json.loads(source_path.read_text(encoding="utf-8"))
    dashboard = raw.get("dashboard", raw)
    old_version = int(dashboard.get("version", 0))
    old_count = len(dashboard.get("panels", []))
    cleaned = clean_dashboard(dashboard)
    # Grafana's file provider owns revisioning after the import.
    cleaned["version"] = old_version
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(cleaned, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "mode": "file",
                "uid": cleaned["uid"],
                "title": cleaned["title"],
                "version": old_version,
                "panelsBefore": old_count,
                "panelsAfter": len(cleaned["panels"]),
                "refresh": cleaned["refresh"],
                "output": str(output_path),
            },
            indent=2,
        )
    )
    return 0


def api_mode() -> int:
    user, password = docker_grafana_credentials()
    live = request(f"/api/dashboards/uid/{DASHBOARD_UID}", user, password)
    dashboard = live["dashboard"]
    meta = live.get("meta", {})

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = BACKUP_DIR / f"sccc-network-overview-before-cleanup-{stamp}.json"
    backup.write_text(json.dumps(live, indent=2) + "\n", encoding="utf-8")

    old_version = int(dashboard.get("version", 0))
    old_count = len(dashboard.get("panels", []))
    cleaned = clean_dashboard(dashboard)
    payload = {
        "dashboard": cleaned,
        "folderUid": meta.get("folderUid", ""),
        "overwrite": True,
        "message": "Clean executive labels, units, layout, and remove broken duplicate panels",
    }
    result = request("/api/dashboards/db", user, password, payload)

    verified = request(f"/api/dashboards/uid/{DASHBOARD_UID}", user, password)["dashboard"]
    actual_ids = [panel.get("id") for panel in verified.get("panels", [])]
    if verified.get("uid") != DASHBOARD_UID or verified.get("title") != DASHBOARD_TITLE:
        raise RuntimeError("Dashboard identity changed during update")
    if actual_ids != list(LAYOUT):
        raise RuntimeError(f"Panel verification failed: {actual_ids}")
    if verified.get("refresh") != "1m":
        raise RuntimeError("Dashboard refresh verification failed")

    summary = {
        "status": result.get("status"),
        "uid": verified["uid"],
        "title": verified["title"],
        "versionBefore": old_version,
        "versionAfter": verified.get("version"),
        "panelsBefore": old_count,
        "panelsAfter": len(actual_ids),
        "refresh": verified.get("refresh"),
        "backup": str(backup),
        "url": result.get("url") or meta.get("url"),
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, help="Exported dashboard JSON")
    parser.add_argument("--output", type=Path, help="Cleaned dashboard JSON")
    args = parser.parse_args()
    if bool(args.source) != bool(args.output):
        parser.error("--source and --output must be supplied together")
    sys.exit(file_mode(args.source, args.output) if args.source else api_mode())
