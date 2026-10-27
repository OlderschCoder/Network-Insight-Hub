#!/usr/bin/env python3
"""Private root operator check: real Influx read-back and optional Grafana file.

Uses existing local credentials; never prints or sends them outside loopback.
Does not queue measurements, enroll devices, or modify network configuration.
"""
import argparse
import base64
import csv
import io
import json
import os
from pathlib import Path
import shutil
import shlex
import time
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import ProxyHandler, Request, build_opener

from pull_worker import NoRedirect, read_json


def environment(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, raw = line.split("=", 1)
        parts = shlex.split(raw, comments=False)
        if len(parts) == 1:
            values[key.strip()] = parts[0]
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provision-dashboard", action="store_true")
    parser.add_argument("--require-current-performance", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError("Use the private VM's normal privileged operator")
    config = environment("/etc/sccc-building-diagnostics/worker.env")
    opener = build_opener(ProxyHandler({}), NoRedirect())
    base = config["INFLUX_URL"].rstrip("/")
    if base != "http://127.0.0.1:8086":
        raise ValueError("This operator check accepts only the existing local Influx service")

    def query(flux):
        request = Request(base + "/api/v2/query?" + urlencode({"org": config["INFLUX_ORG"]}),
                          json.dumps({"query": flux, "type": "flux"}).encode(),
                          headers={"Authorization": "Token " + config["INFLUX_TOKEN"],
                                   "Content-Type": "application/json", "Accept": "application/csv"})
        with opener.open(request, timeout=30) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError("Query response exceeds bound")
        return list(csv.DictReader(io.StringIO("\n".join(line for line in raw.decode().splitlines() if not line.startswith("#")))))

    bucket_source = "from(bucket: " + json.dumps(config["INFLUX_BUCKET"]) + ")"
    performance_prefix = bucket_source + " |> range(start: -7d)"
    measurements = query(performance_prefix + ' |> filter(fn: (r) => r._measurement == "sccc_device_performance" and (r._field == "download_mbps" or r._field == "upload_mbps"))')
    values = [float(row["_value"]) for row in measurements if row.get("_value") not in (None, "", "_value")]
    if len(values) < 2:
        raise ValueError("Accepted pilot report samples are not visible in Influx")
    measurement_times = [datetime.fromisoformat(row["_time"].replace("Z", "+00:00")) for row in measurements if row.get("_time")]
    performance_age_minutes = ((datetime.now(timezone.utc) - max(measurement_times)).total_seconds() / 60
                               if measurement_times else float("inf"))
    performance_current = performance_age_minutes <= 15
    if args.require_current_performance and not performance_current:
        raise ValueError("Fred performance measurements are stale")
    current_prefix = bucket_source + " |> range(start: -15m)"
    presence = query(current_prefix + ' |> filter(fn: (r) => r._measurement == "sccc_device_presence" and r._field == "online") |> group(columns: ["ad_guid"]) |> last() |> group() |> count()')
    count = next((int(row["_value"]) for row in presence if row.get("_value", "").isdigit()), 0)
    if count == 0:
        raise ValueError("No current AD presence points returned")
    collector = query(current_prefix + ' |> filter(fn: (r) => r._measurement == "sccc_device_performance_collector" and r._field == "switches_observed") |> last()')
    collector_values = [int(float(row["_value"])) for row in collector if row.get("_value") not in (None, "", "_value")]
    if not collector_values:
        raise ValueError("No current private collector point returned")
    wireless = query(bucket_source + ' |> range(start: -10m) |> filter(fn: (r) => r._measurement == "aruba_wireless_summary" and r._field == "clients_total") |> last()')
    if not any(row.get("_value") not in (None, "", "_value") for row in wireless):
        raise ValueError("Current Aruba wireless summary is not visible in Influx")

    dashboard_dir = Path("/home/ITADMIN/sccc-ops/grafana-new/dashboards")
    dashboard_specs = ((Path("/var/lib/sccc-building-diagnostics/grafana-device-performance.json"),
                        dashboard_dir / "sccc-device-performance.json", "sccc-device-performance", 15),
                       (Path("/var/lib/sccc-building-diagnostics/grafana-wireless-operations.json"),
                        dashboard_dir / "sccc-wireless-operations.json", "sccc-wireless-overview", 26))
    models = {}

    def provision(source, destination, uid, panel_count):
        model = read_json(source)
        if model.get("uid") != uid or len(model.get("panels", [])) != panel_count:
            raise ValueError("Unexpected generated dashboard " + uid)
        models[uid] = model
        if not args.provision_dashboard:
            return
        if not destination.parent.is_dir() or destination.is_symlink():
            raise ValueError("Existing Grafana provisioning directory required")
        raw = json.dumps(model, separators=(",", ":")).encode()
        if destination.exists():
            if not destination.is_file() or destination.is_symlink():
                raise ValueError("Existing dashboard is not a regular file")
            if json.loads(destination.read_text()) == model:
                return
            backup = destination.with_name(destination.name + ".backup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
            if backup.exists():
                raise ValueError("Dashboard backup path already exists")
            shutil.copy2(destination, backup)
        temporary = destination.with_name("." + destination.name + ".new")
        if temporary.exists() or temporary.is_symlink():
            raise ValueError("Dashboard temporary path already exists")
        with temporary.open("xb") as handle:
            handle.write(raw)
        os.chown(temporary, destination.parent.stat().st_uid, destination.parent.stat().st_gid)
        temporary.chmod(0o644)
        os.replace(temporary, destination)

    for spec in dashboard_specs:
        provision(*spec)
    grafana = environment("/home/ITADMIN/sccc-ops/.env")
    credentials = base64.b64encode((grafana["GRAFANA_ADMIN_USER"] + ":" + grafana["GRAFANA_ADMIN_PASSWORD"]).encode()).decode()

    def grafana_request(path, payload=None):
        request = Request("http://127.0.0.1:3000" + path,
                          None if payload is None else json.dumps(payload).encode(),
                          headers={"Authorization": "Basic " + credentials, "Content-Type": "application/json"})
        with opener.open(request, timeout=30) as response:
            return json.load(response)

    loaded_dashboards = {}
    for uid, model in models.items():
        loaded = None
        for attempt in range(20):
            try:
                loaded = grafana_request("/api/dashboards/uid/" + uid)
                break
            except HTTPError as error:
                if error.code != 404 or not args.provision_dashboard:
                    raise
                time.sleep(2)
        if not loaded or loaded["dashboard"].get("uid") != model["uid"]:
            raise ValueError("Grafana has not loaded generated dashboard " + uid)
        loaded_dashboards[uid] = len(loaded["dashboard"].get("panels", []))
    payload = {"from": str(int((time.time() - 86400) * 1000)), "to": str(int(time.time() * 1000)),
               "queries": [{"refId": "A", "datasource": {"type": "influxdb", "uid": "bf0gpakqau6tcc"},
                            "query": performance_prefix + ' |> filter(fn: (r) => r._measurement == "sccc_device_performance" and r._field == "download_mbps")',
                            "maxDataPoints": 1000, "intervalMs": 60000}]}
    result = grafana_request("/api/ds/query", payload)["results"]["A"]
    frames = result.get("frames", [])
    if result.get("error") or not any(frame.get("data", {}).get("values") for frame in frames):
        raise ValueError("Grafana datasource did not return actual pilot measurements")
    print(json.dumps({"ok": True, "presenceComputers": count, "throughputValuesMbps": values,
                      "performanceCurrent": performance_current,
                      "performanceAgeMinutes": round(performance_age_minutes, 1),
                      "collectorSwitchesObserved": max(collector_values),
                      "wirelessCurrent": True, "grafanaDashboards": loaded_dashboards,
                      "grafanaDataFrames": len(frames)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Private reporting read-back failed (" + type(error).__name__ + "); no verification claimed.")
        raise SystemExit(1)
