import importlib.util
import unittest
from pathlib import Path


MODULE = Path(__file__).with_name("add-daily-device-activity.py")
SPEC = importlib.util.spec_from_file_location("add_daily_device_activity", MODULE)
FORMATTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FORMATTER)


class DailyActivityFormatterTests(unittest.TestCase):
    def test_adds_daily_adapter_activity_without_replacing_existing_panels(self):
        panels = []
        for panel_id in range(1, 24):
            panels.append({
                "id": panel_id,
                "title": "Endpoint download by building / computer (Mbps)" if panel_id == 5 else f"Panel {panel_id}",
                "datasource": {"type": "influxdb", "uid": "influx"},
                "gridPos": {"x": 0, "y": panel_id, "w": 24, "h": 1},
                "targets": [{"refId": "A", "query": 'from(bucket: "SCCC/telegraf") |> range(start: -1h)'}],
            })
        source = {"uid": "sccc-device-performance", "version": 8, "panels": panels}
        result = FORMATTER.add_daily_activity(source)
        self.assertEqual(result["version"], 9)
        self.assertEqual(len(result["panels"]), 24)
        panel = next(panel for panel in result["panels"] if panel["id"] == 24)
        self.assertEqual(panel["type"], "timeseries")
        self.assertEqual(panel["fieldConfig"]["defaults"]["custom"]["drawStyle"], "bars")
        self.assertEqual(panel["fieldConfig"]["defaults"]["custom"]["stacking"]["mode"], "normal")
        self.assertEqual(panel["fieldConfig"]["defaults"]["displayName"], "${__field.labels.adapter}")
        self.assertIn('group(columns: ["report_id", "adapter"])', panel["targets"][0]["query"])
        self.assertIn("aggregateWindow(every: 1d", panel["targets"][0]["query"])
        self.assertEqual(source["version"], 8)
        self.assertEqual(len(source["panels"]), 23)

    def test_refuses_duplicate_or_unknown_baseline(self):
        with self.assertRaises(ValueError):
            FORMATTER.add_daily_activity({"uid": "wrong", "panels": []})
        panels = [{"id": index, "title": f"Panel {index}"} for index in range(1, 24)]
        panels[-1]["id"] = 24
        with self.assertRaises(ValueError):
            FORMATTER.add_daily_activity({"uid": "sccc-device-performance", "panels": panels})


if __name__ == "__main__":
    unittest.main()
