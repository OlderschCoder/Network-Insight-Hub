#!/usr/bin/env python3
"""Root private collector: trusted AD + current SNMP, durable reports, Influx.

No listener, device control, measurement queueing, or alert authority is exposed.
Credentials arrive through protected systemd EnvironmentFiles, never arguments.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import signal
import stat
import sys
from uuid import UUID
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener

from build_inventory import normalize_mac
from private_snmp_collector import collect_targets, explicit_profiles, load_targets
from pull_worker import API, FredClient, NoRedirect, atomic_write, read_json, run_once, sequence, timestamp, utc_now, validate_inventory

DATASOURCE_UID = "bf0gpakqau6tcc"
MAX_SAFE = 9007199254740991
MAX_LINES_PER_WRITE = 500


def json_bytes(value) -> bytes:
    return json.dumps(value, separators=(",", ":"), allow_nan=False).encode()


def metric(value, maximum=1_000_000_000_000):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= maximum:
        raise ValueError("Metric must be finite and bounded")
    return value


def text(value, limit=255) -> str:
    if not isinstance(value, str) or not value or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError("Metric identity must be bounded text")
    return value


def time_ns(value: str) -> int:
    parsed = timestamp(value)
    delta = parsed - datetime(1970, 1, 1, tzinfo=timezone.utc)
    if delta.days < 0:
        raise ValueError("Metric timestamp must follow the epoch")
    # Preserve an ISO fractional timestamp exactly, including nanosecond inputs.
    fraction = re.search(r"\.(\d{1,9})(?:Z|[+-]\d\d:\d\d)$", value)
    nanos = int(fraction.group(1).ljust(9, "0")) if fraction else 0
    return (delta.days * 86400 + delta.seconds) * 1_000_000_000 + nanos


def point(measurement: str, tags: dict, fields: dict, observed_at: str) -> str:
    def tag(value):
        return text(str(value)).replace("\\", "\\\\").replace(" ", "\\ ").replace(",", "\\,").replace("=", "\\=")
    encoded = []
    for key, value in sorted(fields.items()):
        if isinstance(value, bool):
            encoded.append(f"{key}={'true' if value else 'false'}")
        else:
            # One stable numeric field type across integral/fractional samples.
            encoded.append(f"{key}={float(metric(value, MAX_SAFE)):.17g}")
    if not encoded:
        raise ValueError("No actual fields for metric")
    identity = ",".join(f"{key}={tag(value)}" for key, value in sorted(tags.items()))
    return measurement + ("," + identity if identity else "") + " " + ",".join(encoded) + " " + str(time_ns(observed_at))


def report_point(report: dict) -> str:
    identifier = str(sequence(report.get("seq")))
    if identifier == "0":
        raise ValueError("Report sequence must be positive")
    fields = {"measurement_ok": not bool(report.get("error"))}
    mapping = {"downloadMbps": "download_mbps", "uploadMbps": "upload_mbps", "latencyMs": "latency_ms", "requestLossPercent": "request_loss_percent", "downloadBytes": "download_bytes", "uploadBytes": "upload_bytes"}
    for source, destination in mapping.items():
        if report.get(source) is not None:
            fields[destination] = metric(report[source])
    external = report.get("external") or {}
    for source, destination in (("dnsMs", "dns_ms"), ("tcpConnectMs", "tcp_connect_ms"), ("tlsMs", "tls_ms"), ("ttfbMs", "ttfb_ms")):
        if external.get(source) is not None:
            fields[destination] = metric(external[source])
    if len(fields) == 1 and fields["measurement_ok"]:
        raise ValueError("Successful report has no actual measurement")
    return point("sccc_device_performance", {"report_id": identifier, "device_id": text(report.get("deviceId")), "job_id": text(report.get("jobId")), "computer": text(report.get("computerName") or report.get("deviceId")), "building": text(report.get("building") or "Unlocated"), "user": text(report.get("user") or "Unknown user"), "type": text(report.get("type") or "fred")}, fields, report.get("recordedAt"))


def collector_points(snapshot: dict) -> list[str]:
    result = []
    for port in snapshot.get("ports", []):
        telemetry = port["telemetry"]
        fields = {}
        for source, destination in (("linkMbps", "link_mbps"), ("inBitsPerSecond", "in_bps"), ("outBitsPerSecond", "out_bps"), ("inErrors", "in_errors"), ("outErrors", "out_errors"), ("inDiscards", "in_discards"), ("outDiscards", "out_discards")):
            if telemetry.get(source) is not None:
                fields[destination] = metric(telemetry[source], MAX_SAFE if "Errors" in source or "Discards" in source else 1_000_000_000_000)
        if fields:
            result.append(point("sccc_device_performance_port", {"switch": port["switchName"], "port": port["port"], "building": port["building"], "source": "snmp"}, fields, telemetry["observedAt"]))
    status = snapshot["collectorStatus"]
    result.append(point("sccc_device_performance_collector", {"collector": "noc-private"}, {"switches_observed": status["switchesObserved"], "targets_expected": snapshot["targetsExpected"], "port_observations": status["portObservations"], "wifi_observations": status["wifiObservations"], "degraded": status["status"] != "ok"}, status["observedAt"]))
    return result


def presence_points(snapshot: dict) -> list[str]:
    observed_at = snapshot.get("observedAt")
    time_ns(observed_at)
    devices = snapshot.get("devices")
    if not isinstance(devices, list) or len(devices) > 30000:
        raise ValueError("Invalid reporting snapshot size")
    rows, identities = [], set()
    for device in devices:
        identity = str(UUID(device["adObjectGuid"]))
        if identity in identities:
            raise ValueError("Duplicate reporting AD identity")
        identities.add(identity)
        fields = {}
        for source, destination in (("online", "online"), ("enrolled", "enrolled"), ("adVerified", "ad_verified")):
            if not isinstance(device.get(source), bool):
                raise ValueError("Presence state must be an actual boolean")
            fields[destination] = device[source]
        enabled = device.get("enabled")
        if enabled is not None and not isinstance(enabled, bool):
            raise ValueError("AD enabled state must be boolean or unknown")
        fields["ad_enabled_known"] = enabled is not None
        if enabled is not None:
            fields["ad_enabled"] = enabled
        location = device.get("location") or {}
        building = location.get("building") if location.get("kind") == "network-confirmed" else "Unlocated"
        rows.append(point("sccc_device_presence", {"ad_guid": identity, "computer": text(device.get("computerName")), "building": text(building or "Unlocated", 120), "user": text(device.get("loggedOnUser") or "Unknown user")}, fields, observed_at))
    return rows


class InfluxClient:
    def __init__(self, origin: str, token: str, org: str, bucket: str):
        parts = urlsplit(origin)
        local = parts.hostname in ("localhost", "127.0.0.1", "::1")
        try:
            local = local or ipaddress.ip_address(parts.hostname).is_private
        except ValueError:
            pass
        if parts.scheme not in ("https", "http") or (parts.scheme == "http" and not local) or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment or parts.path not in ("", "/"):
            raise ValueError("Influx must be an approved single origin")
        if not token or any(c.isspace() for c in token) or not org or not bucket:
            raise ValueError("Missing protected Influx configuration")
        self.url = origin.rstrip("/") + "/api/v2/write?" + urlencode({"org": org, "bucket": bucket, "precision": "ns"})
        self.token = token
        self.opener = build_opener(NoRedirect())

    def write_lines(self, lines: list[str]) -> None:
        for offset in range(0, len(lines), MAX_LINES_PER_WRITE):
            body = ("\n".join(lines[offset:offset + MAX_LINES_PER_WRITE]) + "\n").encode()
            if len(body) > 2 * 1024 * 1024:
                raise ValueError("Influx batch exceeds size bound")
            request = Request(self.url, data=body, method="POST", headers={"Authorization": "Token " + self.token, "Content-Type": "text/plain; charset=utf-8"})
            with self.opener.open(request, timeout=10) as response:
                if response.status != 204:
                    raise RuntimeError("Influx did not acknowledge the write")


def export_reports(influx, results_path: Path, checkpoint_path: Path) -> int:
    if not results_path.exists():
        return 0
    state = read_json(results_path, 32 * 1024 * 1024)
    checkpoint = read_json(checkpoint_path) if checkpoint_path.exists() else {"cursor": "0"}
    cursor = sequence(checkpoint.get("cursor"))
    rows = [row for row in state.get("reports", []) if sequence(row.get("seq")) > cursor]
    if len(rows) > 10000 or [sequence(row["seq"]) for row in rows] != sorted({sequence(row["seq"]) for row in rows}):
        raise ValueError("Invalid durable report ordering")
    count = 0
    for offset in range(0, len(rows), MAX_LINES_PER_WRITE):
        batch = rows[offset:offset + MAX_LINES_PER_WRITE]
        # Original immutable recordedAt + report identity makes an uncertain retry
        # overwrite the same Influx points. Advance only after acknowledged write.
        influx.write_lines([report_point(row) for row in batch])
        atomic_write(checkpoint_path, json_bytes({"cursor": str(sequence(batch[-1]["seq"]))}))
        count += len(batch)
    return count


def dashboard(bucket: str, datasource_uid=DATASOURCE_UID) -> dict:
    bucket_literal = json.dumps(text(bucket, 120))
    panels = []
    definitions = [("Endpoint download by building / computer (Mbps)", "sccc_device_performance", "download_mbps", "Mbits"),
                   ("Endpoint upload by building / computer (Mbps)", "sccc_device_performance", "upload_mbps", "Mbits"),
                   ("Endpoint latency by building / computer", "sccc_device_performance", "latency_ms", "ms"),
                   ("Endpoint request loss by building / computer", "sccc_device_performance", "request_loss_percent", "percent"),
                   ("External DNS time by building / computer", "sccc_device_performance", "dns_ms", "ms"),
                   ("External TCP connect time by building / computer", "sccc_device_performance", "tcp_connect_ms", "ms"),
                   ("External TLS time by building / computer", "sccc_device_performance", "tls_ms", "ms"),
                   ("External time to first byte by building / computer", "sccc_device_performance", "ttfb_ms", "ms"),
                   ("Access-port received traffic (bps)", "sccc_device_performance_port", "in_bps", "bps"),
                   ("Access-port transmitted traffic (bps)", "sccc_device_performance_port", "out_bps", "bps"),
                   ("Actual access-port error counters", "sccc_device_performance_port", "in_errors", "short"),
                   ("Collector switches observed", "sccc_device_performance_collector", "switches_observed", "short")]
    for index, (title, measurement, field, unit) in enumerate(definitions):
        query = f'from(bucket: {bucket_literal}) |> range(start: v.timeRangeStart, stop: v.timeRangeStop) |> filter(fn: (r) => r._measurement == "{measurement}" and r._field == "{field}")'
        defaults = {"unit": unit}
        if measurement == "sccc_device_performance":
            query += ' |> map(fn: (r) => ({r with user: if exists r.user and r.user != "" then r.user else "Unknown user"})) |> group(columns: ["building", "user", "computer", "_field"])'
            defaults["displayName"] = "${__field.labels.building} · ${__field.labels.user} · ${__field.labels.computer}"
        panels.append({"id": index + 1, "title": title, "type": "timeseries", "datasource": {"type": "influxdb", "uid": datasource_uid}, "gridPos": {"x": (index % 2) * 12, "y": (index // 2) * 8, "w": 12, "h": 8}, "fieldConfig": {"defaults": defaults}, "targets": [{"refId": "A", "query": query}]})
    for field, title in (("online", "Current online computers by building"), ("enrolled", "Current enrolled computers by building")):
        index = len(panels)
        query = f'from(bucket: {bucket_literal}) |> range(start: -15m) |> filter(fn: (r) => r._measurement == "sccc_device_presence" and r._field == "{field}") |> group(columns: ["ad_guid"]) |> last() |> map(fn: (r) => ({{r with _value: if r._value then 1 else 0}})) |> group(columns: ["building"]) |> sum()'
        panels.append({"id": index + 1, "title": title, "type": "stat", "description": "Latest authenticated Fred snapshot per AD GUID within fifteen minutes. Missing/stale snapshots remain No data; Unlocated does not claim a current building.", "datasource": {"type": "influxdb", "uid": datasource_uid}, "gridPos": {"x": (index % 2) * 12, "y": (index // 2) * 8, "w": 12, "h": 8}, "targets": [{"refId": "A", "query": query}]})
    query = f'from(bucket: {bucket_literal}) |> range(start: -15m) |> filter(fn: (r) => r._measurement == "sccc_device_presence") |> map(fn: (r) => ({{r with user: if exists r.user and r.user != "" then r.user else "Unknown user"}})) |> group(columns: ["ad_guid", "user", "_field"]) |> last() |> group() |> pivot(rowKey: ["ad_guid", "computer", "building", "user", "_time"], columnKey: ["_field"], valueColumn: "_value") |> keep(columns: ["_time", "ad_guid", "computer", "building", "user", "online", "enrolled", "ad_verified", "ad_enabled", "ad_enabled_known"])'
    table_y = math.ceil(len(panels) / 2) * 8
    panels.append({"id": len(panels) + 1, "title": "Current device state (missing data is not healthy)", "type": "table", "datasource": {"type": "influxdb", "uid": datasource_uid}, "gridPos": {"x": 0, "y": table_y, "w": 24, "h": 10}, "targets": [{"refId": "A", "query": query}]})
    return {"uid": "sccc-device-performance", "title": "SCCC Device Performance", "schemaVersion": 39, "version": 1, "editable": True, "refresh": "1m", "time": {"from": "now-24h", "to": "now"}, "tags": ["SCCC", "network"], "description": "Authenticated endpoint HTTPS measurements and private SNMP access-port evidence. These measurements do not certify campus uplink capacity. Missing data stays missing; current coverage and AD verification are shown in Fred.", "panels": panels}


def wireless_dashboard(bucket: str, datasource_uid=DATASOURCE_UID) -> dict:
    """Grafana model for the existing Aruba/ClearPass measurements in Influx.

    Wireless/controller metrics already arrive through their dedicated collector.
    This dashboard deliberately does not add Fred data to the SNMP input path.
    """
    bucket_literal = json.dumps(text(bucket, 120))
    datasource = {"type": "influxdb", "uid": datasource_uid}

    def query(measurement: str, fields: tuple[str, ...], start="v.timeRangeStart", extra="") -> str:
        field_filter = " or ".join(f'r._field == "{field}"' for field in fields)
        return (f'from(bucket: {bucket_literal}) |> range(start: {start}, stop: v.timeRangeStop) '
                f'|> filter(fn: (r) => r._measurement == "{measurement}" and ({field_filter})) {extra}')

    panels = []

    def add_panel(title, panel_type, flux, x, y, w, h, unit="short", description="", thresholds=None,
                  display_name=None, overrides=None, mappings=None, options=None):
        defaults = {"unit": unit}
        if thresholds:
            defaults["thresholds"] = {"mode": "absolute", "steps": thresholds}
        if display_name:
            defaults["displayName"] = display_name
        if mappings:
            defaults["mappings"] = mappings
        panel = {"id": len(panels) + 1, "title": title, "type": panel_type,
                 "datasource": datasource, "gridPos": {"x": x, "y": y, "w": w, "h": h},
                 "fieldConfig": {"defaults": defaults, "overrides": overrides or []},
                 "targets": [{"refId": "A", "query": flux}]}
        if options:
            panel["options"] = options
        if description:
            panel["description"] = description
        panels.append(panel)

    current = ' |> group(columns: ["_field"]) |> last()'
    add_panel("Current wireless clients", "stat",
              query("aruba_wireless_summary", ("clients_total",), "-10m", current),
              0, 0, 4, 4, description="Latest controller total within ten minutes. No data means the collector is stale or unavailable.")
    add_panel("Authenticated clients", "stat",
              query("aruba_wireless_summary", ("authenticated_clients",), "-10m", current),
              4, 0, 4, 4)
    add_panel("Guest clients", "stat",
              query("aruba_wireless_summary", ("guest_clients",), "-10m", current),
              8, 0, 4, 4)
    add_panel("SCCC + West Wireless", "stat",
              query("aruba_wireless_summary", ("sccc_wireless_clients", "west_wireless_clients"), "-10m", current),
              12, 0, 4, 4)
    add_panel("Clients missing IPv4", "stat",
              query("aruba_wireless_summary", ("clients_without_ipv4",), "-10m", current),
              16, 0, 4, 4, thresholds=[{"color": "green", "value": None}, {"color": "red", "value": 1}])
    add_panel("APs up / down", "stat",
              query("aruba_wireless_summary", ("aps_up", "aps_down"), "-10m", current),
              20, 0, 4, 4, description="Separate current values for APs up and down.")

    add_panel("Clients by SSID", "bargauge",
              query("aruba_wireless_ssid", ("clients",), "-10m", ' |> group(columns: ["ssid"]) |> last()'),
              0, 4, 8, 8, display_name="${__field.labels.ssid}")
    add_panel("Clients by building", "bargauge",
              query("aruba_wireless_building", ("clients",), "-10m", ' |> group(columns: ["building"]) |> last()'),
              8, 4, 8, 8, display_name="${__field.labels.building}")
    add_panel("Average clients per AP by building", "bargauge",
              query("aruba_wireless_building", ("avg_clients_per_ap",), "-10m", ' |> group(columns: ["building"]) |> last()'),
              16, 4, 8, 8, unit="none", display_name="${__field.labels.building}")

    add_panel("Clients without IPv4 by building", "bargauge",
              query("aruba_wireless_building", ("clients_without_ipv4",), "-10m", ' |> group(columns: ["building"]) |> last()'),
              0, 12, 8, 8, thresholds=[{"color": "green", "value": None}, {"color": "red", "value": 1}],
              description="Use this to localize DHCP/client-address failures. A zero is healthy; No data is unknown.",
              display_name="${__field.labels.building}")
    add_panel("AP availability by building", "bargauge",
              query("aruba_wireless_building", ("aps_up", "aps_down"), "-10m", ' |> group(columns: ["building", "_field"]) |> last()'),
              8, 12, 8, 8, display_name="${__field.labels.building} · ${__field.labels._field}")
    add_panel("RADIUS outcomes by server", "timeseries",
              query("aruba_radius_server", ("accept_delta", "reject_delta", "timeout_delta"), extra=' |> aggregateWindow(every: v.windowPeriod, fn: sum, createEmpty: false)'),
              16, 12, 8, 8, description="Accepted, rejected and timed-out authentication activity by on-prem, Azure and VIP target.")

    add_panel("RADIUS response time by server", "timeseries",
              query("aruba_radius_server", ("avg_response_ms",), extra=' |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)'),
              0, 20, 12, 8, unit="ms")
    add_panel("Wireless client trend", "timeseries",
              query("aruba_wireless_summary", ("clients_total", "guest_clients", "authenticated_clients", "clients_without_ipv4"),
                    extra=' |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)'),
              12, 20, 12, 8)

    ap_query = query("aruba_wireless_ap", ("clients", "up"), "-10m",
                     ' |> group(columns: ["ap", "building", "model", "_field"]) |> last() |> group() '
                     '|> pivot(rowKey: ["ap", "building", "model", "_time"], columnKey: ["_field"], valueColumn: "_value") '
                     '|> keep(columns: ["_time", "ap", "building", "model", "clients", "up"])')
    add_panel("Current AP state", "table", ap_query, 0, 28, 24, 10,
              description="Current AP state and client load. Missing APs remain missing rather than being reported healthy.")

    pc_description = ("Fred endpoint test results identify building, last known logged-on user and computer. "
                      "Throughput automatically displays in Mbps or Gbps; latency is milliseconds and loss is percent. "
                      "Missing user identity is shown as Unknown user. No recent point is not a healthy zero.")
    pc_series = (' |> map(fn: (r) => ({r with '
                 '_value: if r._field == "download_mbps" or r._field == "upload_mbps" then r._value * 1000000.0 else r._value, '
                 'user: if exists r.user and r.user != "" then r.user else "Unknown user"})) '
                 '|> group(columns: ["building", "user", "computer", "_field"])')
    pc_display = "${__field.labels.building} · ${__field.labels.user} · ${__field.labels.computer}"
    add_panel("PC download by building / user / computer", "timeseries",
              query("sccc_device_performance", ("download_mbps",), extra=pc_series),
              0, 38, 12, 8, unit="bps", description=pc_description, display_name=pc_display)
    add_panel("PC upload by building / user / computer", "timeseries",
              query("sccc_device_performance", ("upload_mbps",), extra=pc_series),
              12, 38, 12, 8, unit="bps", description=pc_description, display_name=pc_display)
    add_panel("PC latency by building / user / computer", "timeseries",
              query("sccc_device_performance", ("latency_ms",), extra=pc_series),
              0, 46, 8, 8, unit="ms", description=pc_description, display_name=pc_display)
    add_panel("PC request loss by building / user / computer", "timeseries",
              query("sccc_device_performance", ("request_loss_percent",), extra=pc_series),
              8, 46, 8, 8, unit="percent", description=pc_description, display_name=pc_display)
    add_panel("PC external DNS / TCP / TLS / TTFB", "timeseries",
              query("sccc_device_performance", ("dns_ms", "tcp_connect_ms", "tls_ms", "ttfb_ms"), extra=pc_series),
              16, 46, 8, 8, unit="ms", description=pc_description,
              display_name=pc_display + " · ${__field.labels._field}")
    building_speed = query("sccc_device_performance", ("download_mbps", "upload_mbps", "latency_ms"),
                           extra=' |> map(fn: (r) => ({r with _value: if r._field == "download_mbps" or r._field == "upload_mbps" then r._value * 1000000.0 else r._value})) '
                                 '|> group(columns: ["building", "computer", "_field"]) |> last() '
                                 '|> group(columns: ["building", "_field"]) |> mean() |> group() '
                                 '|> pivot(rowKey: ["building"], columnKey: ["_field"], valueColumn: "_value") '
                                 '|> keep(columns: ["building", "download_mbps", "upload_mbps", "latency_ms"])')
    speed_table_overrides = [
        {"matcher": {"id": "byName", "options": "building"},
         "properties": [{"id": "displayName", "value": "Building"}]},
        {"matcher": {"id": "byName", "options": "download_mbps"},
         "properties": [{"id": "displayName", "value": "Download"}, {"id": "unit", "value": "bps"},
                        {"id": "decimals", "value": 1}]},
        {"matcher": {"id": "byName", "options": "upload_mbps"},
         "properties": [{"id": "displayName", "value": "Upload"}, {"id": "unit", "value": "bps"},
                        {"id": "decimals", "value": 1}]},
        {"matcher": {"id": "byName", "options": "latency_ms"},
         "properties": [{"id": "displayName", "value": "Latency"}, {"id": "unit", "value": "ms"},
                        {"id": "decimals", "value": 1}]},
    ]
    add_panel("Building PC speed summary", "table", building_speed, 0, 54, 24, 9,
              description="Average of each computer's latest result in the selected time range, grouped by building. Throughput automatically displays in Mbps or Gbps.",
              overrides=speed_table_overrides)
    pc_table = query("sccc_device_performance", ("download_mbps", "upload_mbps", "latency_ms",
                                                          "request_loss_percent", "dns_ms", "tcp_connect_ms", "tls_ms", "ttfb_ms"),
                     extra=' |> map(fn: (r) => ({r with '
                           '_value: if r._field == "download_mbps" or r._field == "upload_mbps" then r._value * 1000000.0 else r._value, '
                           'user: if exists r.user and r.user != "" then r.user else "Unknown user"})) '
                           '|> group(columns: ["report_id", "computer", "building", "user", "type", "_field"]) |> last() |> group() '
                           '|> pivot(rowKey: ["report_id", "computer", "building", "user", "type", "_time"], columnKey: ["_field"], valueColumn: "_value") '
                           '|> keep(columns: ["_time", "building", "user", "computer", "type", "download_mbps", "upload_mbps", "latency_ms", "request_loss_percent", "dns_ms", "tcp_connect_ms", "tls_ms", "ttfb_ms"])')
    add_panel("Latest PC performance results", "table", pc_table, 0, 63, 24, 10,
              description=pc_description, overrides=speed_table_overrides + [
                  {"matcher": {"id": "byName", "options": "request_loss_percent"},
                   "properties": [{"id": "displayName", "value": "Loss"}, {"id": "unit", "value": "percent"},
                                  {"id": "decimals", "value": 1}]},
              ])

    # Put current ClearPass health first. Every expected on-prem, Azure and VIP
    # target receives an explicit unhealthy fallback, so a missing node cannot
    # disappear and leave the cluster looking green. Recent response time and
    # timeout deltas then raise that fallback to warning or healthy.
    for panel in panels:
        panel["gridPos"]["y"] += 4
    health_query = f'''import "array"
expected = array.from(rows: [
  {{server: "SCCC_CPPM01", _value: 0}},
  {{server: "SCCC_CPPM02", _value: 0}},
  {{server: "SCCC_CPPM_AZ01", _value: 0}},
  {{server: "SCCC_CPPM_AZ02", _value: 0}},
  {{server: "SCCC_CPPM_VIP", _value: 0}}
])
observed = from(bucket: {bucket_literal})
  |> range(start: -10m)
  |> filter(fn: (r) => r._measurement == "aruba_radius_server" and (r._field == "avg_response_ms" or r._field == "timeout_delta"))
  |> map(fn: (r) => ({{r with _value: float(v: r._value)}}))
  |> group(columns: ["server", "_field"])
  |> last()
  |> group(columns: ["server"])
  |> pivot(rowKey: ["server"], columnKey: ["_field"], valueColumn: "_value")
  |> map(fn: (r) => ({{server: r.server, _value: if exists r.avg_response_ms and exists r.timeout_delta and r.avg_response_ms < 500.0 and r.timeout_delta == 0.0 then 2 else if exists r.avg_response_ms and exists r.timeout_delta and r.avg_response_ms < 1000.0 and r.timeout_delta <= 5.0 then 1 else 0}}))
health = union(tables: [expected, observed])
  |> group(columns: ["server"])
  |> max(column: "_value")'''
    health_mappings = [{"type": "value", "options": {
        "0": {"text": "UNHEALTHY", "color": "red"},
        "1": {"text": "WARNING", "color": "orange"},
        "2": {"text": "HEALTHY", "color": "green"},
    }}]
    health_thresholds = [{"color": "red", "value": None}, {"color": "orange", "value": 1},
                         {"color": "green", "value": 2}]
    health_options = {"reduceOptions": {"values": False, "calcs": ["lastNotNull"], "fields": ""},
                      "orientation": "horizontal", "textMode": "value_and_name",
                      "colorMode": "background", "graphMode": "none", "justifyMode": "auto",
                      "wideLayout": True}
    server_health_options = {**health_options, "orientation": "vertical"}
    add_panel("ClearPass Overall Health", "stat",
              health_query + '\nhealth |> group() |> min(column: "_value") |> map(fn: (r) => ({_value: r._value})) |> yield(name: "overall")',
              0, 0, 6, 4, unit="none",
              description="Worst current state across both on-prem nodes, both Azure nodes and the RADIUS VIP. Missing/stale data is unhealthy.",
              thresholds=health_thresholds, mappings=health_mappings,
              display_name="ClearPass cluster", options=health_options)
    add_panel("ClearPass Server Health", "stat", health_query + '\nhealth |> yield(name: "servers")',
              6, 0, 18, 4, unit="none",
              description="Healthy: fresh data, response under 500 ms and zero new timeouts. Warning: response under 1,000 ms and at most five new timeouts. Missing/stale or worse is unhealthy.",
              thresholds=health_thresholds, mappings=health_mappings,
              display_name="${__field.labels.server}", options=server_health_options)

    return {"uid": "sccc-wireless-overview", "title": "SCCC Wireless Operations", "schemaVersion": 39,
            "version": 1, "editable": True, "refresh": "30s", "time": {"from": "now-6h", "to": "now"},
            "tags": ["SCCC", "wireless", "ClearPass"],
            "description": "Current Aruba wireless, building, SSID and explicit ClearPass/RADIUS health plus Fred PC performance by building, last known user and computer from the existing private Influx data. Missing ClearPass telemetry is unhealthy rather than silently omitted. SNMP target collection is unchanged.",
            "panels": panels}


def wifi_observations(path: Path | None, now=None) -> tuple[list, bool]:
    if path is None or not path.exists():
        return [], True
    now = now or utc_now()
    data = read_json(path)
    rows = data.get("observations")
    if not isinstance(rows, list) or len(rows) > 60000:
        raise ValueError("Invalid protected Wi-Fi source")
    result = []
    for row in rows:
        age = (now - timestamp(row.get("observedAt"))).total_seconds()
        if row.get("source") != "wifi" or row.get("edge") is not True or not -30 <= age <= 600:
            continue
        observation = {"source": "wifi", "edge": True, "bssid": normalize_mac(row["bssid"]), "building": text(row["building"], 120), "observedAt": row["observedAt"]}
        if "mac" in row:
            if not isinstance(row["mac"], str):
                raise ValueError("Controller client MAC must be valid unicast text")
            observation["mac"] = normalize_mac(row["mac"])
        result.append(observation)
    return result, not bool(result) or len(result) != len(rows)


def cycle(client, influx, state_dir: Path, targets: list[dict], agent_path: Path, wifi_path: Path | None, bucket: str, collect=collect_targets) -> dict:
    ad = client.request(API + "/ad-inventory")
    inventory = validate_inventory({"snapshotComplete": ad.get("snapshotComplete"), "adObservedAt": ad.get("adObservedAt"), "adComputers": ad.get("adComputers"), "observations": [], "userBuildingAssignments": []})
    counters_path, results_path = state_dir / "counters.json", state_dir / "results.json"
    previous = read_json(counters_path) if counters_path.exists() else {}
    collected = collect(targets, agent_path, previous)
    try:
        wifi, wifi_degraded = wifi_observations(wifi_path)
    except (ValueError, OSError, TypeError, KeyError):
        # Optional controller evidence must fail closed without discarding the
        # successful private switch sample or refreshing invalid Wi-Fi rows.
        wifi, wifi_degraded = [], True
    observed_at = utc_now().isoformat()
    inventory["observations"] = (collected["observations"] + wifi)[:60000]
    inventory["collectorStatus"] = {"observedAt": observed_at, "status": "degraded" if collected["degraded"] or wifi_degraded else "ok", "switchesObserved": collected["switchesObserved"], "portObservations": len(collected["observations"]), "wifiObservations": len(wifi)}
    snapshot = {"ports": collected["ports"], "collectorStatus": inventory["collectorStatus"], "targetsExpected": collected["targetsExpected"]}
    inventory_path = state_dir / "inventory.json"
    atomic_write(counters_path, json_bytes(collected["counters"]))
    atomic_write(inventory_path, json_bytes(inventory))
    atomic_write(state_dir / "collector-snapshot.json", json_bytes(snapshot))
    atomic_write(state_dir / "grafana-device-performance.json", json_bytes(dashboard(bucket)))
    atomic_write(state_dir / "grafana-wireless-operations.json", json_bytes(wireless_dashboard(bucket)))
    # Keep actual presence/evidence current even if Influx subsequently fails.
    client.request(API + "/inventory", validate_inventory(inventory))
    presence = client.request(API + "/reporting-snapshot")
    presence_lines = presence_points(presence)
    atomic_write(state_dir / "presence.json", json_bytes(presence))
    influx.write_lines(collector_points(snapshot))
    influx.write_lines(presence_lines)
    checkpoint_path = state_dir / "influx-checkpoint.json"
    exported = export_reports(influx, results_path, checkpoint_path)
    # Drain previous unexported results before allowing bounded snapshot pruning.
    pulled = run_once(client, inventory_path, results_path)
    exported += export_reports(influx, results_path, checkpoint_path)
    return {"ok": True, "switchesObserved": collected["switchesObserved"], "targetsExpected": collected["targetsExpected"], "portObservations": len(collected["observations"]), "wifiObservations": len(wifi), "collectorStatus": inventory["collectorStatus"]["status"], "presenceRecords": len(presence_lines), "reportsPulled": pulled["fetched"], "reportsExported": exported}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--targets", type=Path, required=True)
    parser.add_argument("--profiles", type=Path, default=Path("/etc/sccc-noc-probe-snmp/profiles.json"))
    parser.add_argument("--snmp-agent", type=Path, default=Path("/opt/sccc-noc-probe/noc_probe_agent.py"))
    parser.add_argument("--wifi", type=Path)
    args = parser.parse_args()
    try:
        if os.name != "posix" or os.geteuid() != 0:
            raise ValueError("The private coordinator requires the approved root service")
        import fcntl
        info = args.state_dir.stat()
        if args.state_dir.is_symlink() or not args.state_dir.is_dir() or stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.getuid():
            raise ValueError("Create a protected root-owned state directory")
        descriptor = os.open(args.state_dir / "coordinator.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            def timed_out(_signal, _frame):
                raise TimeoutError("Coordinator exceeded bounded cycle")
            signal.signal(signal.SIGALRM, timed_out)
            signal.alarm(285)
            client = FredClient(os.environ.get("BUILDING_DIAGNOSTICS_FRED_ORIGIN", ""), os.environ.get("BUILDING_DIAGNOSTICS_WORKER_TOKEN", ""))
            influx = InfluxClient(os.environ.get("INFLUX_URL", ""), os.environ.get("INFLUX_TOKEN", ""), os.environ.get("INFLUX_ORG", ""), os.environ.get("INFLUX_BUCKET", ""))
            targets = load_targets(args.targets, explicit_profiles(args.profiles))
            print(json.dumps(cycle(client, influx, args.state_dir, targets, args.snmp_agent, args.wifi, os.environ["INFLUX_BUCKET"])))
            signal.alarm(0)
        return 0
    except Exception as error:
        print("Private diagnostics coordinator failed (" + type(error).__name__ + "). No complete-cycle success recorded.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
