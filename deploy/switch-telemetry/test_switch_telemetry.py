from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest

from audit_switch_telemetry import audit
from check_firewall_telemetry import evaluate
from publish_switch_telemetry import validate_aggregate


def aggregate() -> dict:
    return {
        "schema": "sccc.network.switchport_telemetry.v1",
        "run_id": "test-run",
        "switch_count": 2,
        "switch_count_ok": 1,
        "switch_count_failed": 1,
        "switches": [
            {
                "switch_name": "healthy",
                "switch_ip": "192.0.2.10",
                "building": "Test",
                "ok": True,
                "interfaces": [{"port": "1/1/1", "is_physical": True}],
                "lldp_neighbors": [],
            },
            {
                "switch_name": "offline",
                "switch_ip": "192.0.2.11",
                "building": "Test",
                "ok": False,
                "interfaces": [],
                "errors": ["TCP/22 unreachable"],
            },
        ],
    }


class PublisherValidationTests(unittest.TestCase):
    def test_returns_only_successful_records(self):
        records, error = validate_aggregate(aggregate())
        self.assertIsNone(error)
        self.assertEqual([record["switch_name"] for record in records or []], ["healthy"])

    def test_rejects_inconsistent_counts(self):
        payload = aggregate()
        payload["switch_count_failed"] = 0
        records, error = validate_aggregate(payload)
        self.assertIsNone(records)
        self.assertIn("failed count", error or "")


class AuditorTests(unittest.TestCase):
    def test_allow_failed_records_preserves_failure_and_passes_structure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "aggregate.json"
            path.write_text(json.dumps(aggregate()), encoding="utf-8")
            _, strict = audit(path)
            _, tolerant = audit(path, allow_failed_records=True)
        self.assertFalse(strict["passed"])
        self.assertTrue(tolerant["passed"])
        self.assertEqual(tolerant["records_failed"], 1)
        self.assertEqual(tolerant["failed_switches"][0]["switch_name"], "offline")


class FirewallStatusTests(unittest.TestCase):
    def test_accepts_both_fresh_firewalls(self):
        now = datetime(2026, 10, 25, 13, 10, tzinfo=timezone.utc)
        payload = {
            "firewalls": [
                {
                    "host": host,
                    "configured": True,
                    "reachable": True,
                    "lastPolled": (now - timedelta(minutes=2)).isoformat(),
                    "interfaceTelemetryAvailable": True,
                    "interfaceCount": count,
                }
                for host, count in (("192.168.1.1", 65), ("172.25.0.1", 17))
            ]
        }
        result = evaluate(payload, now=now, max_age_minutes=10)
        self.assertEqual((result["ok"], result["failed"]), (2, 0))

    def test_marks_stale_or_missing_firewalls_failed(self):
        now = datetime(2026, 10, 25, 13, 10, tzinfo=timezone.utc)
        payload = {
            "firewalls": [
                {
                    "host": "192.168.1.1",
                    "configured": True,
                    "reachable": True,
                    "lastPolled": (now - timedelta(minutes=30)).isoformat(),
                    "interfaceTelemetryAvailable": True,
                    "interfaceCount": 65,
                }
            ]
        }
        result = evaluate(payload, now=now, max_age_minutes=10)
        self.assertEqual((result["ok"], result["failed"]), (0, 2))


if __name__ == "__main__":
    unittest.main()
