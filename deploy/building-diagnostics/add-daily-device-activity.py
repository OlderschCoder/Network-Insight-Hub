#!/usr/bin/env python3
"""Add the reviewed daily Ethernet/Wi-Fi activity panel to a live dashboard model."""
import argparse
import copy
import json
from pathlib import Path


PANEL_ID = 24
PANEL_TITLE = "Daily validated speed measurements by adapter"


def add_daily_activity(model):
    if model.get("uid") != "sccc-device-performance":
        raise ValueError("Expected the SCCC Device Performance dashboard")
    updated = copy.deepcopy(model)
    if any(panel.get("id") == PANEL_ID or panel.get("title") == PANEL_TITLE for panel in updated.get("panels", [])):
        raise ValueError("Daily activity panel already exists; reconcile instead of duplicating it")
    if len(updated.get("panels", [])) != 23:
        raise ValueError("Expected the reviewed 23-panel live dashboard baseline")
    source = next((panel for panel in updated["panels"] if panel.get("id") == 5), None)
    if not source or source.get("title") != "Endpoint download by building / computer (Mbps)":
        raise ValueError("Reviewed endpoint dashboard baseline was not found")
    target = (source.get("targets") or [{}])[0]
    query = target.get("query", "")
    if "from(bucket:" not in query:
        raise ValueError("Could not recover the reviewed Influx bucket")
    bucket = query.split("from(bucket:", 1)[1].split(")", 1)[0].strip()
    datasource = copy.deepcopy(source.get("datasource"))
    max_y = max(panel.get("gridPos", {}).get("y", 0) + panel.get("gridPos", {}).get("h", 0)
                for panel in updated["panels"])
    activity_query = (
        f'from(bucket: {bucket}) |> range(start: v.timeRangeStart, stop: v.timeRangeStop) '
        '|> filter(fn: (r) => r._measurement == "sccc_device_performance" and r.type == "librespeed-v2" '
        'and r.method == "MultiStreamV2" and r._field == "measurement_ok" and r._value == true) '
        '|> group(columns: ["report_id", "adapter"]) |> last() |> group(columns: ["adapter"]) '
        '|> aggregateWindow(every: 1d, fn: count, createEmpty: false)'
    )
    updated["panels"].append({
        "id": PANEL_ID,
        "title": PANEL_TITLE,
        "type": "timeseries",
        "description": ("Completed, validated MultiStreamV2 interface measurements per day, split by Ethernet and Wi-Fi. "
                        "A missing Wi-Fi series means no eligible Wi-Fi interface was active, associated, addressed and "
                        "routable during those tests; it is not a zero-speed result."),
        "datasource": datasource,
        "gridPos": {"x": 0, "y": max_y, "w": 24, "h": 8},
        "fieldConfig": {"defaults": {"unit": "short", "decimals": 0,
                                      "displayName": "${__field.labels.adapter}",
                                      "custom": {
                                          "drawStyle": "bars", "lineInterpolation": "linear", "barAlignment": 0,
                                          "lineWidth": 1, "fillOpacity": 75, "gradientMode": "none",
                                          "showPoints": "never", "pointSize": 5,
                                          "stacking": {"mode": "normal", "group": "daily-adapter"},
                                          "axisPlacement": "auto", "axisLabel": "Validated measurements",
                                          "axisColorMode": "text", "axisBorderShow": False,
                                          "scaleDistribution": {"type": "linear"}, "axisCenteredZero": False,
                                          "hideFrom": {"tooltip": False, "viz": False, "legend": False},
                                          "thresholdsStyle": {"mode": "off"}, "spanNulls": False,
                                          "insertNulls": False}}, "overrides": []},
        "options": {"legend": {"showLegend": True, "displayMode": "list", "placement": "bottom",
                                "calcs": ["sum"]},
                    "tooltip": {"mode": "multi", "sort": "desc"}},
        "targets": [{"refId": "A", "query": activity_query}],
    })
    updated["version"] = int(updated.get("version") or 0) + 1
    return updated


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("live_model", type=Path)
    parser.add_argument("output_model", type=Path)
    args = parser.parse_args()
    source = json.loads(args.live_model.read_text(encoding="utf-8"))
    args.output_model.write_text(json.dumps(add_daily_activity(source), indent=2) + "\n", encoding="utf-8")
