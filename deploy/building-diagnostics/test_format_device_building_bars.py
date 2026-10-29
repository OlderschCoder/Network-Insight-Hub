import importlib.util
import unittest
from pathlib import Path


MODULE = Path(__file__).with_name("format-device-building-bars.py")
SPEC = importlib.util.spec_from_file_location("format_device_building_bars", MODULE)
FORMATTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FORMATTER)


class DashboardFormatterTests(unittest.TestCase):
    def test_adds_named_speed_and_average_bars_without_legends(self):
        panels = []
        for panel_id, title in (
            (5, "Endpoint download by building / computer (Mbps)"),
            (6, "Endpoint upload by building / computer (Mbps)"),
            (19, "Current online computers by building"),
            (20, "Current enrolled computers by building"),
        ):
            panels.append({
                "id": panel_id, "title": title, "type": "timeseries",
                "datasource": {"type": "influxdb", "uid": "influx"},
                "fieldConfig": {"defaults": {}}, "options": {},
                "targets": [{"refId": "A", "query": 'from(bucket: "SCCC/telegraf") |> range(start: -1h)'}],
            })
        result = FORMATTER.format_building_bars({"uid": "sccc-device-performance", "version": 4, "panels": panels})
        by_id = {panel["id"]: panel for panel in result["panels"]}
        self.assertEqual(result["version"], 5)
        for panel_id in (5, 6, 19, 20, 22, 23):
            self.assertEqual(by_id[panel_id]["type"], "bargauge")
            self.assertFalse(by_id[panel_id]["options"]["legend"]["showLegend"])
        self.assertIn("labels.computer", by_id[5]["fieldConfig"]["defaults"]["displayName"])
        self.assertNotIn("_value", by_id[5]["fieldConfig"]["defaults"]["displayName"])
        self.assertEqual(by_id[22]["fieldConfig"]["defaults"]["displayName"], "${__field.labels.building}")
        self.assertIn("|> mean()", by_id[22]["targets"][0]["query"])


if __name__ == "__main__":
    unittest.main()
