import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import os
from cryptography.exceptions import InvalidTag
from broker import AccessError, Broker, SimulatedDevice, Vault, authorize, recover, seal, unseal

OWNER = {"id": 1, "name": "Owner", "email": "owner@example.invalid", "role": "cio", "entraObjectId": "owner-id", "isActive": True, "isBreakGlass": False}
BORROWER = {**OWNER, "id": 2, "name": "Technician", "email": "tech@example.invalid", "role": "network", "entraObjectId": "tech-id"}
TARGET = {"name": "test-device", "ip": "192.0.2.1", "platform": "simulated", "account": "admin"}
OLD = "OnlyForUnitTests-Old7!"
INITIAL = "OnlyForUnitTests-New8!"


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.vault = Vault(self.temp.name, os.urandom(32))
        self.device = SimulatedDevice(OLD)
        self.broker = Broker(self.vault, self.device)

    def tearDown(self):
        self.temp.cleanup()

    def enrolled(self):
        self.broker.stage(OWNER, TARGET, OLD, INITIAL)
        self.broker.apply_staged(OWNER, TARGET["ip"])

    def test_checkout_reset_recovery_and_notifications(self):
        self.vault.initialize_recovery()
        self.enrolled()
        issued = self.broker.checkout(BORROWER, TARGET["ip"])
        self.assertEqual(issued, INITIAL)
        self.broker.finish(BORROWER, TARGET["ip"])
        self.assertNotEqual(self.device.password, INITIAL)
        self.assertEqual(len(self.device.password), 32)
        self.assertEqual(self.vault.read()["targets"][TARGET["ip"]]["current"], self.device.password)
        self.assertTrue(self.vault.safe_test()["verified"])
        report = json.dumps(self.broker.report(OWNER))
        for password in (OLD, INITIAL, self.device.password):
            self.assertNotIn(password, report)
            for path in Path(self.temp.name).iterdir():
                self.assertNotIn(password.encode(), path.read_bytes())
        sent = []
        self.broker.deliver(sent.append)
        self.assertEqual([e["action"] for e in sent], ["initial-password-verified", "credential-issued", "reset-verified"])
        self.assertEqual(sent[1]["actor"]["id"], BORROWER["id"])
        self.assertTrue(all(e["status"] == "sent" for e in self.vault.read()["outbox"]))

    def test_identity_cannot_be_a_name_or_ordinary_staff(self):
        for actor in [None, {"name": "Owner"}, {**OWNER, "isActive": False},
                      {**OWNER, "role": "helpdesk"}, {**OWNER, "isBreakGlass": True},
                      {**OWNER, "entraObjectId": None}]:
            with self.assertRaises(AccessError):
                authorize(actor)

    def test_only_owner_enrolls_and_only_borrower_or_owner_returns(self):
        with self.assertRaises(AccessError):
            self.broker.stage(BORROWER, TARGET, OLD, INITIAL)
        self.enrolled()
        self.broker.checkout(BORROWER, TARGET["ip"])
        other = {**BORROWER, "id": 3}
        with self.assertRaises(AccessError):
            self.broker.finish(other, TARGET["ip"])

    def test_duplicate_checkout_is_denied(self):
        self.enrolled()
        self.broker.checkout(BORROWER, TARGET["ip"])
        with self.assertRaises(AccessError):
            self.broker.checkout(OWNER, TARGET["ip"])

    def test_failed_write_prevents_device_change(self):
        self.broker.stage(OWNER, TARGET, OLD, INITIAL)
        with patch.object(self.vault, "save", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                self.broker.apply_staged(OWNER, TARGET["ip"])
        self.assertEqual(self.device.password, OLD)

    def test_loss_after_change_preserves_both_passwords_and_blocks_checkout(self):
        self.broker.stage(OWNER, TARGET, OLD, INITIAL)
        self.device.fail_after_change = True
        with self.assertRaises(AccessError):
            self.broker.apply_staged(OWNER, TARGET["ip"])
        record = self.vault.read()["targets"][TARGET["ip"]]
        self.assertEqual((record["current"], record["pending"]), (OLD, INITIAL))
        self.assertEqual(record["state"], "review-required")
        with self.assertRaises(AccessError):
            self.broker.checkout(OWNER, TARGET["ip"])

    def test_notification_failure_survives_restart_and_retries(self):
        self.enrolled()
        self.broker.checkout(BORROWER, TARGET["ip"])
        def fail(_):
            raise RuntimeError("mail unavailable")
        self.broker.deliver(fail)
        restarted = Broker(Vault(self.temp.name, self.vault.key), self.device)
        self.assertTrue(all(item["status"] == "pending" for item in restarted.vault.read()["outbox"]))
        sent = []
        restarted.deliver(sent.append)
        restarted.deliver(sent.append)
        self.assertEqual(len(sent), 2)

    def test_authenticated_encryption_rejects_tamper_and_wrong_key(self):
        value = seal({"password": INITIAL}, self.vault.key)
        with self.assertRaises(InvalidTag):
            unseal(value, os.urandom(32))
        document = json.loads(value)
        document["ciphertext"] = document["ciphertext"][:-4] + "AAAA"
        with self.assertRaises(InvalidTag):
            unseal(json.dumps(document).encode(), self.vault.key)

    def test_reenrollment_cannot_overwrite_current_state(self):
        self.enrolled()
        before = copy.deepcopy(self.vault.read())
        with self.assertRaises(AccessError):
            self.broker.stage(OWNER, TARGET, OLD, INITIAL)
        self.assertEqual(before, self.vault.read())

    def test_pending_credential_durable_before_device_mutation(self):
        observed = []
        original = self.device.change
        def check(target, old, new):
            row = self.vault.read()["targets"][target["ip"]]
            observed.append(row["state"] == "applying" and row["pending"] == new)
            return original(target, old, new)
        self.device.change = check
        self.enrolled()
        self.assertEqual(observed, [True])


class SessionTests(unittest.TestCase):
    def test_missing_token_never_becomes_an_identity(self):
        from service import verify_session
        with self.assertRaises(AccessError):
            verify_session("")

    def test_hub_principal_checked_instead_of_request_claims(self):
        from service import verify_session
        import io
        response = io.BytesIO(json.dumps(BORROWER).encode())
        with patch("urllib.request.build_opener") as opener:
            opener.return_value.open.return_value.__enter__.return_value = response
            self.assertEqual(verify_session("test-session")["id"], BORROWER["id"])
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, "http://127.0.0.1:8080/api/auth/me")

    def test_server_rejects_forged_identity_body_without_a_session(self):
        from service import handler
        from http.server import HTTPServer
        import threading
        import urllib.request
        import urllib.error
        with tempfile.TemporaryDirectory() as directory:
            broker = Broker(Vault(directory, os.urandom(32)), SimulatedDevice(OLD))
            server = HTTPServer(("127.0.0.1", 0), handler(broker, {}))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/fred-credentials-poc/reveal",
                    data=json.dumps({"actor": OWNER, "target": "192.168.252.173"}).encode(),
                    headers={"Content-Type": "application/json"})
                with self.assertRaises(urllib.error.HTTPError) as context:
                    urllib.request.urlopen(request)
                self.assertEqual(context.exception.code, 403)
                context.exception.close()
                self.assertFalse(broker.vault.path.exists())
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_live_adapter_rejects_other_targets_before_connecting(self):
        from aruba_adapter import ArubaAdapter
        adapter = ArubaAdapter("example.invalid", "unused", "unused", "unused")
        with patch("paramiko.SSHClient") as client:
            with self.assertRaises(AccessError):
                adapter.connect(TARGET, INITIAL)
            client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
