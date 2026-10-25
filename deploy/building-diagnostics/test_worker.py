import copy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest

from build_inventory import (build_inventory, normalize_mac, parse_forwarding_entries,
                             phone_assignments, switch_observations)
from pull_worker import (API, FredClient, NoRedirect, atomic_write, merge_page,
                         read_json, run_once, validate_inventory, validate_origin)

NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)
STAMP = NOW.isoformat()


def inventory(now=NOW):
    return {"generatedAt": now.isoformat(), "snapshotComplete": True,
            "adComputers": [{"adObjectGuid": "7393b75e-8173-4e96-b87a-5165fa12e6f1",
                             "computerName": "PILOT-1", "domain": "example.invalid", "enabled": True}],
            "observations": [], "userBuildingAssignments": []}


def report(seq):
    return {"id": str(seq), "seq": str(seq), "jobId": "job-one", "deviceId": "device-one",
            "recordedAt": STAMP, "building": "Building A", "downloadMbps": 123.4,
            "targetLabel": "Fred HTTPS path"}


class ValidationTests(unittest.TestCase):
    def test_origin_rejects_plaintext_redirect_credentials_path_and_nonstandard_ports(self):
        self.assertEqual(validate_origin("https://fred.example.invalid/"), "https://fred.example.invalid")
        for value in ("http://fred.example.invalid", "https://user:secret@fred.example.invalid",
                      "https://fred.example.invalid/path", "https://fred.example.invalid?q=1",
                      "https://fred.example.invalid:8443", "https://fred.example.invalid/#frag"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_origin(value)
        with self.assertRaises(ValueError):
            NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://elsewhere.invalid")

    def test_dedicated_token_and_fixed_api_are_required(self):
        with self.assertRaises(ValueError):
            FredClient("https://fred.example.invalid", "short")
        client = FredClient("https://fred.example.invalid", "x" * 40)
        with self.assertRaises(ValueError):
            client.request("https://elsewhere.invalid/path")

    def test_inventory_must_be_complete_fresh_and_nonempty(self):
        for mutation in ({"snapshotComplete": False}, {"adComputers": []},
                         {"generatedAt": (NOW - timedelta(days=2)).isoformat()},
                         {"adObservedAt": (NOW - timedelta(days=2)).isoformat()},
                         {"generatedAt": (NOW + timedelta(hours=1)).isoformat()}):
            value = inventory()
            value.update(mutation)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                validate_inventory(value, NOW)
        result = validate_inventory(inventory(), NOW)
        self.assertNotIn("generatedAt", result)
        self.assertEqual(result["adObservedAt"], STAMP)
        self.assertTrue(result["snapshotComplete"])

    def test_stale_and_uplink_evidence_not_refreshed(self):
        value = inventory()
        base = {"mac": "00:11:22:33:44:55", "building": "A", "source": "switch", "edge": True}
        value["observations"] = [dict(base, observedAt=STAMP),
                                 dict(base, observedAt=(NOW - timedelta(minutes=16)).isoformat()),
                                 dict(base, edge=False, observedAt=STAMP)]
        value["userBuildingAssignments"] = [{"username": "staff@example.invalid", "building": "B",
                                              "source": "desk-phone", "observedAt": (NOW - timedelta(days=31)).isoformat()}]
        result = validate_inventory(value, NOW)
        self.assertEqual(len(result["observations"]), 1)
        self.assertEqual(result["observations"][0]["observedAt"], STAMP)
        self.assertEqual(result["userBuildingAssignments"], [])


class CursorTests(unittest.TestCase):
    def test_replay_deduplicates_and_sequences_are_decimal_strings(self):
        state = {"cursor": "0", "reports": []}
        state = merge_page(state, {"reports": [report(1), report(4)], "nextCursor": "4"})
        replay = merge_page(state, {"reports": [report(4), report(8)], "nextCursor": "8"})
        self.assertEqual(replay["cursor"], "8")
        self.assertEqual([row["seq"] for row in replay["reports"]], ["1", "4", "8"])

    def test_conflicting_replay_cursor_skips_and_oversized_page_rejected(self):
        state = {"cursor": "4", "reports": [report(4)]}
        tampered = dict(report(4), building="Other building")
        for page in ({"reports": [tampered], "nextCursor": "4"},
                     {"reports": [report(5)], "nextCursor": "6"},
                     {"reports": [], "nextCursor": "8"},
                     {"reports": [], "nextCursor": "3"},
                     {"reports": [report(6), report(5)], "nextCursor": "6"},
                     {"reports": [report(5)] * 101, "nextCursor": "5"}):
            with self.subTest(page=page), self.assertRaises(ValueError):
                merge_page(state, page)

    def test_atomic_snapshot_is_cursor_authority_and_rebuilds_jsonl(self):
        class FakeFred:
            def __init__(self):
                self.calls = []

            def request(self, path, payload=None):
                self.calls.append(path)
                if path == API + "/inventory":
                    self.payload = payload
                    return {"ok": True}
                if "after=0" in path:
                    return {"reports": [report(1), report(2)], "nextCursor": "2"}
                return {"reports": [], "nextCursor": "2"}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            source, target = root / "inventory.json", root / "results.json"
            live_inventory = inventory(datetime.now(timezone.utc))
            atomic_write(source, json.dumps(live_inventory).encode())
            first = FakeFred()
            self.assertEqual(run_once(first, source, target)["cursor"], "2")
            # Simulate interruption after snapshot replace but before JSONL.
            atomic_write(target.with_suffix(".jsonl"), b'corrupted derivative\n')
            second = FakeFred()
            self.assertEqual(run_once(second, source, target)["fetched"], 0)
            self.assertIn("after=2", second.calls[1])
            rows = [json.loads(line) for line in target.with_suffix(".jsonl").read_text().splitlines()]
            self.assertEqual([row["seq"] for row in rows], ["1", "2"])
            self.assertEqual(read_json(target)["cursor"], "2")
            self.assertTrue(first.payload["snapshotComplete"])


class ForwardingTests(unittest.TestCase):
    def switch_fixture(self):
        return {"schema": "sccc.network.switchport_telemetry.v1", "switches": [
            {"switch_name": "SW-A", "switch_ip": "10.1.1.1", "building": "Building A", "ok": True,
             "polled_at": STAMP, "interfaces": [
                 {"port": "1/1/1", "mode": "access", "is_physical": True, "oper_status": "up"},
                 {"port": "1/1/2", "mode": "trunk", "is_physical": True, "oper_status": "up"},
                 {"port": "1/1/3", "mode": "access", "is_physical": True, "oper_status": "up"},
                 {"port": "1/1/4", "mode": "access", "is_physical": True, "oper_status": "up"}],
             "lldp_neighbors": [{"local_port": "1/1/3", "system_name": "SW-B", "management_addresses": ["10.1.1.2"]}],
             "raw_cli": {"mac": "10 0011.2233.4401 dynamic 1/1/1\n10 0011.2233.4402 dynamic 1/1/2\n10 0011.2233.4403 dynamic 1/1/3\n10 0011.2233.4404 dynamic 1/1/4"}},
            {"switch_name": "SW-B", "switch_ip": "10.1.1.2", "ok": False}]}

    def test_individual_entries_not_mac_counts(self):
        raw = ("10 0011.2233.4455 DYNAMIC Gi1/0/1\n"
               "00:11:22:33:44:56 10 1/1/2 Dynamic\n"
               "10 0011.2233.4457 STATIC Gi1/0/3\n"
               "10 0011.2233.4458 DYNAMIC Po10\n"
               "10 ffff.ffff.ffff DYNAMIC Gi1/0/4")
        self.assertEqual(parse_forwarding_entries(raw), [
            {"mac": "00:11:22:33:44:55", "port": "Gi1/0/1"},
            {"mac": "00:11:22:33:44:56", "port": "1/1/2"}])
        self.assertEqual(normalize_mac("001122-334455"), "00:11:22:33:44:55")

    def test_uplinks_trunks_and_explicit_exclusions_are_not_edge(self):
        observations, _ = switch_observations(self.switch_fixture(), {"switches": [
            {"switchName": "SW-A", "approvedEdgePorts": ["1/1/2", "1/1/3"], "excludedPorts": ["1/1/4"]}]}, NOW)
        self.assertEqual([row["port"] for row in observations], ["1/1/1"])

    def test_stale_switches_missing_building_and_unknown_mode_do_not_locate(self):
        fixture = self.switch_fixture()
        fixture["switches"][0]["polled_at"] = (NOW - timedelta(minutes=20)).isoformat()
        self.assertEqual(switch_observations(fixture, {}, NOW)[0], [])
        fixture = self.switch_fixture()
        fixture["switches"][0]["interfaces"][0]["mode"] = None
        rows, _ = switch_observations(fixture, {"switches": [{"switchName": "SW-A", "excludedPorts": ["1/1/4"]}]}, NOW)
        self.assertEqual(rows, [])

    def test_conflicting_mac_locations_preserved_for_server_ambiguity(self):
        fixture = self.switch_fixture()
        other = copy.deepcopy(fixture["switches"][0])
        other.update(switch_name="SW-C", switch_ip="10.1.1.3", building="Building C")
        fixture["switches"].append(other)
        rows, _ = switch_observations(fixture, {}, NOW)
        candidates = [row for row in rows if row["mac"] == "00:11:22:33:44:01"]
        self.assertEqual({row["building"] for row in candidates}, {"Building A", "Building C"})

    def test_phone_buildings_require_exact_identity_and_suppress_conflicts(self):
        owners = {"generatedAt": STAMP, "assignments": [
            {"webexPersonId": "p1", "building": "A"}, {"webexPersonId": "p2", "building": "B"}]}
        mappings = {"users": [{"username": "staff@example.invalid", "webexPersonId": "p1"},
                               {"username": "STAFF@example.invalid", "webexPersonId": "p2"},
                               {"username": "ok@example.invalid", "webexPersonId": "p1"},
                               {"username": "SCCC\\staff", "webexPersonId": "p1"},
                               {"username": "guess", "webexPersonId": "p1"}]}
        self.assertEqual(phone_assignments(owners, mappings), [
            {"username": "ok@example.invalid", "building": "A", "source": "desk-phone", "observedAt": STAMP},
            {"username": "sccc\\staff", "building": "A", "source": "desk-phone", "observedAt": STAMP}])

    def test_optional_sources_missing_remain_explicitly_missing(self):
        value = build_inventory(inventory(), now=NOW)
        self.assertEqual(value["observations"], [])
        self.assertEqual(value["userBuildingAssignments"], [])
        self.assertIn("unavailable", value["warnings"][0])


if __name__ == "__main__":
    unittest.main()
