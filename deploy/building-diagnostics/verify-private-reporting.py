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
import shlex
import time
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

    prefix = "from(bucket: " + json.dumps(config["INFLUX_BUCKET"]) + ") |> range(start: -24h)"
    measurements = query(prefix + ' |> filter(fn: (r) => r._measurement == "sccc_device_performance" and (r._field == "download_mbps" or r._field == "upload_mbps"))')
    values = [float(row["_value"]) for row in measurements if row.get("_value") not in (None, "", "_value")]
    if len(values) < 3:
        raise ValueError("Both accepted pilot report samples are not visible in Influx")
    presence = query(prefix + ' |> filter(fn: (r) => r._measurement == "sccc_device_presence" and r._field == "online") |> group(columns: ["ad_guid"]) |> last() |> group() |> count()')
    count = next((int(row["_value"]) for row in presence if row.get("_value", "").isdigit()), 0)
    if count == 0:
        raise ValueError("No actual AD presence points returned")
    source = Path("/var/lib/sccc-building-diagnostics/grafana-device-performance.json")
    model = read_json(source)
    if model.get("uid") != "sccc-device-performance" or len(model.get("panels", [])) != 9:
        raise ValueError("Unexpected generated dashboard")
    destination = Path("/home/ITADMIN/sccc-ops/grafana-new/dashboards/sccc-device-performance.json")
    if args.provision_dashboard:
        if not destination.parent.is_dir() or destination.is_symlink():
            raise ValueError("Existing Grafana provisioning directory required")
        raw = json.dumps(model, separators=(",", ":")).encode()
        if destination.exists():
            if json.loads(destination.read_text()) != model:
                raise ValueError("Dashboard already differs; reconcile before overwrite")
        else:
            with destination.open("xb") as handle:
                handle.write(raw)
            os.chown(destination, destination.parent.stat().st_uid, destination.parent.stat().st_gid)
            destination.chmod(0o644)
    grafana = environment("/home/ITADMIN/sccc-ops/.env")
    credentials = base64.b64encode((grafana["GRAFANA_ADMIN_USER"] + ":" + grafana["GRAFANA_ADMIN_PASSWORD"]).encode()).decode()

    def grafana_request(path, payload=None):
        request = Request("http://127.0.0.1:3000" + path,
                          None if payload is None else json.dumps(payload).encode(),
                          headers={"Authorization": "Basic " + credentials, "Content-Type": "application/json"})
        with opener.open(request, timeout=30) as response:
            return json.load(response)

    loaded = None
    for attempt in range(20):
        try:
            loaded = grafana_request("/api/dashboards/uid/sccc-device-performance")
            break
        except HTTPError as error:
            if error.code != 404 or not args.provision_dashboard:
                raise
            time.sleep(2)
    if not loaded or loaded["dashboard"].get("uid") != model["uid"]:
        raise ValueError("Grafana has not loaded the generated dashboard")
    payload = {"from": str(int((time.time() - 86400) * 1000)), "to": str(int(time.time() * 1000)),
               "queries": [{"refId": "A", "datasource": {"type": "influxdb", "uid": "bf0gpakqau6tcc"},
                            "query": prefix + ' |> filter(fn: (r) => r._measurement == "sccc_device_performance" and r._field == "download_mbps")',
                            "maxDataPoints": 1000, "intervalMs": 60000}]}
    result = grafana_request("/api/ds/query", payload)["results"]["A"]
    frames = result.get("frames", [])
    if result.get("error") or not any(frame.get("data", {}).get("values") for frame in frames):
        raise ValueError("Grafana datasource did not return actual pilot measurements")
    print(json.dumps({"ok": True, "presenceComputers": count, "throughputValuesMbps": values,
                      "grafanaUid": model["uid"], "grafanaPanels": len(loaded["dashboard"]["panels"]),
                      "grafanaDataFrames": len(frames)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Private reporting read-back failed (" + type(error).__name__ + "); no verification claimed.")
        raise SystemExit(1)
