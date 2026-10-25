import base64
import csv
import json
from pathlib import Path
import tempfile
import unittest

import switch_enrollment_control as control


class RequestTests(unittest.TestCase):
    def test_accepts_private_ipv4(self):
        self.assertEqual(control.require_private_ipv4("10.20.30.40"), "10.20.30.40")

    def test_rejects_public_or_loopback_addresses(self):
        for value in ("8.8.8.8", "127.0.0.1", "169.254.1.1", "not-an-ip"):
            with self.subTest(value=value), self.assertRaises(control.EnrollmentError):
                control.require_private_ipv4(value)

    def test_decodes_base64url_request(self):
        payload = {"action": "preview", "ip": "192.168.2.50"}
        encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
        self.assertEqual(control.decode_request(encoded), payload)


class CredentialTests(unittest.TestCase):
    def test_maps_aruba_snmp_aliases_without_exposing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "\n".join(
                    (
                        "SWITCH_PASS=ssh-value",
                        "AUTH_PW=auth-value",
                        "PRIV_PW=priv-value",
                        "SMNP_User=MonitorUser",
                        "NETWORK_BACKUP_KEY_B64=backup-value",
                    )
                ),
                encoding="utf-8",
            )
            environment, user = control.credential_environment(path)
        self.assertEqual(environment["FRED_SNMP_AUTH_PASSWORD"], "auth-value")
        self.assertEqual(environment["FRED_SNMP_PRIV_PASSWORD"], "priv-value")
        self.assertEqual(environment["FRED_SWITCH_SSH_PASSWORD"], "ssh-value")
        self.assertEqual(user, "MonitorUser")


class InventoryTests(unittest.TestCase):
    def test_atomic_upsert_updates_existing_ip_without_duplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "switches.csv"
            path.write_text("ip,name,enabled\n192.168.2.10,old,true\n", encoding="utf-8")
            control.atomic_upsert(
                path,
                "ip",
                "192.168.2.10",
                {"ip": "192.168.2.10", "name": "new", "enabled": "true"},
            )
            with path.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
        self.assertEqual(rows, [{"ip": "192.168.2.10", "name": "new", "enabled": "true"}])

    def test_device_catalog_schema_accepts_enrollment_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "devices.csv"
            path.write_text(
                "name,ip,site,device_type,platform,status,monitoring_required,snmp_workflow,canonical_ip,notes,last_reviewed\n",
                encoding="utf-8",
            )
            control.atomic_upsert(path, "ip", "10.0.0.20", {
                "name": "switch-20", "ip": "10.0.0.20", "site": "Test", "device_type": "switch",
                "platform": "aruba_aoscx", "status": "Canonical", "monitoring_required": "true",
                "snmp_workflow": "switch-enrollment", "canonical_ip": "10.0.0.20", "notes": "",
                "last_reviewed": "2026-10-25",
            })
            _, rows = control.read_csv_rows(path)
        self.assertEqual(rows[0]["site"], "Test")


if __name__ == "__main__":
    unittest.main()
