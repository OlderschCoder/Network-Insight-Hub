import copy
from datetime import datetime, timedelta, timezone
import json
import math
import multiprocessing
import os
from pathlib import Path
import tempfile
import time
import sys
import unittest
from unittest.mock import patch

from coordinator_worker import (DATASOURCE_UID, InfluxClient, collector_points, cycle,
                                dashboard, export_reports, presence_points, report_point, report_points, time_ns,
                                wifi_observations, wireless_dashboard)
from private_snmp_collector import (BRIDGE_MAP, FDB_PORT, FDB_STATUS, IF_TABLE,
                                    IFX_TABLE, access_interfaces, collect_one,
                                    collect_targets, exclude_shared_port_observations,
                                    explicit_profiles, load_targets, rate,
                                    bounded_process, run_bulkwalk)
from pull_worker import API, atomic_write, read_json, validate_inventory

NOW = datetime.now(timezone.utc)
STAMP = NOW.isoformat()
TARGET = {"hostname": "synthetic-edge", "ip": "192.168.2.27", "building": "Synthetic A"}
MAC_KEY = (1, 0, 17, 34, 51, 68, 85)


def report(seq=1):
    return {"seq": str(seq), "deviceId": "synthetic-device", "jobId": "synthetic-job", "computerName": "SYNTHETIC", "building": "Synthetic A", "user": "EXAMPLE\\staff", "recordedAt": STAMP, "downloadMbps": 25.5, "uploadMbps": 10, "latencyMs": 2, "requestLossPercent": 0, "downloadBytes": 1024}


def librespeed_report(seq=2):
    return {"seq": str(seq), "deviceId": "synthetic-device", "jobId": "synthetic-job-v2", "computerName": "SYNTHETIC",
            "building": "Synthetic A", "user": "EXAMPLE\\staff", "recordedAt": STAMP, "type": "librespeed-v2",
            "libreSpeed": {"schema": "sccc.librespeed.multistream-v2.v1", "method": "MultiStreamV2", "concurrent": 3,
                           "durationSecondsPerDirection": 15, "serverId": 92, "serverOrigin": "https://denspeed.sharktech.net",
                           "measurements": [
                               {"sourceIp": "10.11.50.10", "adapterKind": "ethernet", "mac": "00:11:22:33:44:55", "interfaceAlias": "Ethernet",
                                "linkMbps": 1000, "downloadMbps": 889.2, "uploadMbps": 726.1, "pingMs": 22.4, "jitterMs": 1.2,
                                "bytesReceived": 1_000_000, "bytesSent": 900_000, "elapsedMs": 31_100, "transferClosed": True, "rawJson": "{}"},
                               {"sourceIp": "10.70.33.69", "adapterKind": "wifi", "mac": "66:77:88:99:aa:bb", "interfaceAlias": "Wi-Fi",
                                "linkMbps": 1201, "ssid": "SCCC Wireless", "bssid": "aa:bb:cc:dd:ee:ff", "downloadMbps": 399.4,
                                "uploadMbps": 420.3, "pingMs": 25.1, "jitterMs": 2.1, "bytesReceived": 800_000, "bytesSent": 850_000,
                                "elapsedMs": 31_250, "transferClosed": True, "rawJson": "{}"}]}}


def presence():
    return {"observedAt": STAMP, "updatedAt": STAMP, "readiness": {}, "devices": [{"deviceId": "synthetic-device", "adObjectGuid": "7393b75e-8173-4e96-b87a-5165fa12e6f1", "computerName": "SYNTHETIC", "domain": "example.invalid", "enabled": True, "enrolled": True, "online": True, "adVerified": True, "lastSeenAt": STAMP, "loggedOnUser": "EXAMPLE\\staff", "location": {"building": "Synthetic A", "kind": "network-confirmed"}}]}


def metadata_owner(owner=0):
    original = os.fstat
    def synthetic_owner(descriptor):
        values = list(original(descriptor))
        values[4] = owner
        return os.stat_result(values)
    return patch("private_snmp_collector.os.fstat", side_effect=synthetic_owner)


class FakeAgent:
    SNMP_PROFILES = {TARGET["ip"]: "never-read-profile"}
    def __init__(self):
        self.tables = {FDB_PORT: {MAC_KEY: "1", (1, 0, 17, 34, 51, 68, 86): "1", (1, 1, 17, 34, 51, 68, 88): "1"}, FDB_STATUS: {MAC_KEY: "3", (1, 0, 17, 34, 51, 68, 86): "4", (1, 1, 17, 34, 51, 68, 88): "3"}, BRIDGE_MAP: {(1,): "11"}, IF_TABLE + ".14": {(11,): "0"}, IFX_TABLE + ".6": {(11,): "10000"}, IFX_TABLE + ".10": {(11,): "20000"}}
        self.interface = {"ifIndex": 11, "interfaceName": "1/1/2", "isPhysical": True, "portMode": "access", "operStatus": "up", "speedMbps": 1000, "inErrors": 999, "outErrors": 999}
    def valid_snmp_target(self, address):
        return address == TARGET["ip"]
    def run_snmpwalk(self, address, oid, required=True):
        return (oid if oid in self.tables else ""), None
    def parse_walk(self, text, prefix):
        return self.tables.get(text, {})
    def collect_lldp_target(self, _target):
        for oid in (IF_TABLE + ".14", IF_TABLE + ".20", IFX_TABLE + ".6", IFX_TABLE + ".10"):
            self.run_snmpwalk(TARGET["ip"], oid)
        return {"ok": True, "interfaces": [self.interface], "neighbors": []}


class PrivateSnmpTests(unittest.TestCase):
    def setUp(self):
        # Synthetic agents must never invoke an installed SNMP executable.
        mocked = patch("private_snmp_collector.run_bulkwalk", side_effect=lambda agent, target, oid: (oid if oid in agent.tables else "", None))
        mocked.start()
        self.addCleanup(mocked.stop)
    def test_fdb_requires_learned_unicast_mac_and_actual_access_port(self):
        agent = FakeAgent()
        with patch("private_snmp_collector.stamp", return_value=STAMP), patch("private_snmp_collector.time.monotonic", return_value=100):
            result = collect_one(TARGET, agent, {}, "boot", {TARGET["hostname"]})
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["observations"]), 1)
        row = result["observations"][0]
        self.assertEqual(row["mac"], "00:11:22:33:44:55")
        self.assertEqual(row["portTelemetry"]["inErrors"], 0)
        self.assertNotIn("outErrors", row["portTelemetry"])
        self.assertNotIn("inBitsPerSecond", row["portTelemetry"])
        self.assertEqual(row["observedAt"], STAMP)

    def test_high_fanout_port_is_not_endpoint_location_evidence(self):
        def rows(count):
            return [{"switchName": "SWA-AA105", "port": "1/1/51", "mac": f"00:11:22:33:44:{value:02x}"} for value in range(count)]
        self.assertEqual(len(exclude_shared_port_observations(rows(3))), 3)
        self.assertEqual(len(exclude_shared_port_observations(rows(8))), 8)
        self.assertEqual(exclude_shared_port_observations(rows(9)), [])
        self.assertEqual(exclude_shared_port_observations(rows(158)), [])
        self.assertEqual(len(exclude_shared_port_observations(rows(8) + [rows(8)[0]])), 8)

    def test_fanout_is_counted_before_location_row_limit(self):
        shared = [{"switchName": "SWA-AA105", "port": "1/1/51", "mac": f"00:11:22:33:44:{value:02x}"} for value in range(1, 10)]
        ordinary = [{"switchName": "SWA-AA105", "port": f"1/1/{value}", "mac": f"00:22:33:44:55:{value:02x}"} for value in range(1, 5)]
        result = exclude_shared_port_observations([shared[0], *ordinary, *shared[1:]], limit=3)
        self.assertEqual([row["port"] for row in result], ["1/1/1", "1/1/2", "1/1/3"])

    def test_high_fanout_suppression_preserves_port_telemetry(self):
        agent = FakeAgent()
        learned = {(1, 0, 17, 34, 51, 68, value): "1" for value in range(1, 159)}
        agent.tables[FDB_PORT] = learned
        agent.tables[FDB_STATUS] = {key: "3" for key in learned}
        with patch("private_snmp_collector.stamp", return_value=STAMP), patch("private_snmp_collector.time.monotonic", return_value=100):
            result = collect_one(TARGET, agent, {}, "boot", {TARGET["hostname"]})
        self.assertTrue(result["ok"])
        self.assertEqual(result["observations"], [])
        self.assertEqual(len(result["ports"]), 1)
        self.assertEqual(result["ports"][0]["port"], "1/1/2")
        self.assertEqual(result["ports"][0]["telemetry"]["linkMbps"], 1000)

    def test_excludes_lag_trunk_unknown_down_uplink_and_known_lldp_switch_ports(self):
        base = FakeAgent().interface
        for change in ({"portMode": "trunk"}, {"portMode": "unknown"}, {"isPhysical": False}, {"operStatus": "down"}, {"description": "uplink to core"}, {"portchannel": "Po1"}):
            self.assertEqual(access_interfaces({"interfaces": [{**base, **change}]}, set()), {})
        snapshot = {"interfaces": [base], "neighbors": [{"localPort": base["interfaceName"], "remoteSystemName": "core"}]}
        self.assertEqual(access_interfaces(snapshot, {"core"}), {})
        snapshot["neighbors"][0] = {"localPort": base["interfaceName"], "remoteSystemName": "phone", "remoteSystemDescription": "Cisco IP Phone"}
        self.assertIn(11, access_interfaces(snapshot, {"core"}))
        snapshot = {"interfaces": [{**base, "interfaceName": "Gi1/0/1"}], "neighbors": [{"localPort": "GigabitEthernet1/0/1", "remoteSystemName": "core.sccc.edu"}]}
        self.assertEqual(access_interfaces(snapshot, {"core"}), {})

    def test_slow_later_fdb_read_does_not_refresh_earlier_counter_timestamp(self):
        times = [(NOW + timedelta(seconds=index)).isoformat() for index in range(9)]
        with patch("private_snmp_collector.stamp", side_effect=times), patch("private_snmp_collector.time.monotonic", return_value=100):
            result = collect_one(TARGET, FakeAgent(), {}, "boot", set())
        self.assertEqual(result["observations"][0]["portTelemetry"]["observedAt"], times[0])
        self.assertEqual(result["observations"][0]["observedAt"], times[4])

    def test_rates_require_consecutive_same_boot_real_counters_and_link_ceiling(self):
        previous = {"value": "1000", "bits": 64, "monotonic": 90, "observedAt": (NOW - timedelta(seconds=10)).isoformat(), "bootId": "boot"}
        current = {"value": "2000", "bits": 64, "monotonic": 100, "observedAt": STAMP, "bootId": "boot"}
        self.assertEqual(rate(current, previous, "boot", 1000), 800)
        for changed in (None, {**previous, "bootId": "old-boot"}, {**previous, "value": "3000"}, {**previous, "monotonic": 101}, {**previous, "observedAt": (NOW - timedelta(hours=1)).isoformat()}, {**previous, "bits": 32}):
            self.assertIsNone(rate(current, changed, "boot", 1000))
        self.assertIsNone(rate({**current, "value": "999999999999"}, previous, "boot", 1))
        self.assertIsNone(rate(current, previous, "boot", None))
        self.assertIsNone(rate({**current, "switchUptimeTicks": 10}, {**previous, "switchUptimeTicks": 1000}, "boot", 1000))
        self.assertIsNone(rate({**current, "discontinuityTicks": 2}, {**previous, "discontinuityTicks": 1}, "boot", 1000))

    def test_targets_are_intersection_of_explicit_profile_map_and_sanitized_csv(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            profiles, targets = root / "profiles.json", root / "switches.csv"
            atomic_write(profiles, json.dumps({"targets": {TARGET["ip"]: "profile-a"}}).encode())
            atomic_write(targets, b"name,ip,building\nsynthetic-edge,192.168.2.27,Synthetic A\nunapproved,192.168.2.99,Other\n")
            with metadata_owner():
                allowed = explicit_profiles(profiles)
            self.assertEqual(load_targets(targets, allowed), [TARGET])
            atomic_write(targets, b"name,ip,building\none,192.168.2.27,A\ntwo,192.168.2.27,B\n")
            with self.assertRaises(ValueError):
                load_targets(targets, allowed)
        with self.assertRaises(ValueError):
            collect_one({**TARGET, "ip": "192.168.2.99"}, FakeAgent(), {}, "boot", set())

    @unittest.skipUnless(os.name == "posix", "Root metadata mode contract is Linux-only")
    def test_root_profile_metadata_allows_0640_but_rejects_write_nonroot_and_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "profiles.json"
            atomic_write(path, json.dumps({"targets": {TARGET["ip"]: "profile-a"}}).encode())
            path.chmod(0o640)
            with metadata_owner():
                self.assertEqual(explicit_profiles(path), {TARGET["ip"]})
            with metadata_owner(12345), self.assertRaises(ValueError):
                explicit_profiles(path)
            path.chmod(0o660)
            with metadata_owner(), self.assertRaises(ValueError):
                explicit_profiles(path)
            path.chmod(0o640)
            linked = Path(folder) / "linked.json"
            linked.symlink_to(path)
            with metadata_owner(), self.assertRaises(ValueError):
                explicit_profiles(linked)

    @unittest.skipUnless(os.name == "posix", "Private process deadline is Linux-only")
    def test_target_deadline_terminates_only_isolated_workers_and_marks_missing_unknown(self):
        def stalled(connection, *_args):
            os.setsid()
            time.sleep(10)
        started = time.monotonic()
        with patch("private_snmp_collector._child", stalled):
            result = collect_targets([TARGET] * 5, Path("/never-loaded"), {}, deadline_seconds=1)
        self.assertLess(time.monotonic() - started, 4)
        self.assertTrue(result["degraded"])
        self.assertEqual(result["switchesObserved"], 0)
        self.assertEqual(result["observations"], [])


class FakeInflux:
    def __init__(self, fail=False):
        self.lines, self.fail = [], fail
    def write_lines(self, lines):
        self.lines.extend(lines)
        if self.fail:
            raise RuntimeError("synthetic uncertain write")


class BulkBoundaryTests(unittest.TestCase):
    def test_bulk_fdb_uses_only_profile_environment_and_fixed_scope(self):
        agent = FakeAgent()
        with patch("private_snmp_collector.shutil.which", return_value="/usr/bin/snmpbulkwalk"), patch("private_snmp_collector.bounded_process", return_value=("synthetic", None)) as run:
            self.assertEqual(run_bulkwalk(agent, TARGET["ip"], FDB_PORT), ("synthetic", None))
            command, environment = run.call_args.args
            self.assertEqual(command, ["/usr/bin/snmpbulkwalk", "-v3", "-On", "-Cr25", "-t", "1", "-r", "0", TARGET["ip"], FDB_PORT])
            self.assertEqual(environment["SNMPCONFPATH"], "never-read-profile")
            self.assertEqual(run.call_args.kwargs, {"timeout": 15})
            with self.assertRaises(ValueError):
                run_bulkwalk(agent, TARGET["ip"], IF_TABLE)
            with self.assertRaises(ValueError):
                run_bulkwalk(agent, "192.168.2.99", FDB_PORT)

    def test_bulk_output_and_time_are_bounded_without_returning_partial_data(self):
        out, error = bounded_process([sys.executable, "-c", "print('safe')"], os.environ.copy(), timeout=2, max_bytes=100)
        self.assertEqual((out.strip(), error), ("safe", None))
        out, error = bounded_process([sys.executable, "-c", "print('x'*10000)"], os.environ.copy(), timeout=2, max_bytes=100)
        self.assertEqual(out, ""); self.assertIn("size bound", error)
        started = time.monotonic()
        out, error = bounded_process([sys.executable, "-c", "import time;time.sleep(5)"], os.environ.copy(), timeout=0.1, max_bytes=100)
        self.assertEqual(out, ""); self.assertIn("deadline", error)
        self.assertLess(time.monotonic()-started, 3)


class MetricsTests(unittest.TestCase):
    def test_presence_exports_every_ad_guid_with_building_and_known_user(self):
        snapshot = presence()
        snapshot["devices"].append({"adObjectGuid": "12078014-77bb-43b6-9bde-bbb213668861", "computerName": "NOT-ENROLLED", "enabled": None, "enrolled": False, "online": False, "adVerified": False, "location": {"building": "Assigned Office", "kind": "assigned"}, "loggedOnUser": "never-export-user", "interfaces": [{"mac": "never-export-mac"}]})
        lines = presence_points(snapshot)
        self.assertEqual(len(lines), 2)
        self.assertTrue(all(line.endswith(" " + str(time_ns(STAMP))) for line in lines))
        self.assertEqual(lines, presence_points(snapshot))
        self.assertIn("building=Assigned\\ Office", lines[1])
        self.assertIn("location_kind=assigned", lines[1])
        self.assertIn("user=never-export-user", lines[1])
        self.assertIn("user=EXAMPLE\\\\staff", lines[0])
        self.assertIn("ad_enabled_known=false", lines[1])
        self.assertNotIn("ad_enabled=", lines[1])
        with self.assertRaises(ValueError):
            presence_points({**snapshot, "devices": snapshot["devices"] + [snapshot["devices"][0]]})
    def test_metrics_keep_immutable_identity_timestamp_and_numeric_field_types(self):
        line = report_point(report())
        self.assertTrue(line.endswith(" " + str(time_ns(STAMP))))
        self.assertIn("report_id=1", line)
        self.assertIn("building=Synthetic\\ A", line)
        self.assertIn("user=EXAMPLE\\\\staff", line)
        self.assertIn("upload_mbps=10", line)
        self.assertNotIn("upload_mbps=10i", line)
        self.assertIn("user=Unknown\\ user", report_point({**report(), "user": None}))
        self.assertEqual(time_ns("2026-10-25T12:00:00.123456789Z") % 1_000_000_000, 123456789)
        self.assertEqual(time_ns("2026-10-25T07:00:00.123456789-05:00"), time_ns("2026-10-25T12:00:00.123456789Z"))
        for invalid in (math.nan, math.inf, -1, True):
            with self.assertRaises(ValueError):
                report_point({**report(), "downloadMbps": invalid})

    def test_librespeed_exports_one_evidence_preserving_point_per_interface(self):
        lines = report_points(librespeed_report())
        self.assertEqual(len(lines), 2)
        self.assertIn("adapter=ethernet", lines[0])
        self.assertIn("adapter=wifi", lines[1])
        self.assertIn("ssid=SCCC\\ Wireless", lines[1])
        self.assertIn("download_mbps=889.20000000000005", lines[0])
        self.assertIn("upload_mbps=420.30000000000001", lines[1])
        self.assertTrue(all("method=MultiStreamV2" in line and "transfer_closed=true" in line for line in lines))
        self.assertTrue(all(line.endswith(" " + str(time_ns(STAMP))) for line in lines))
        bad = copy.deepcopy(librespeed_report())
        bad["libreSpeed"]["measurements"][1]["sourceIp"] = "10.11.50.10"
        with self.assertRaises(ValueError):
            report_points(bad)

    def test_uncertain_influx_write_replays_same_points_then_advances_cursor_once(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state, checkpoint = root / "results.json", root / "influx.json"
            atomic_write(state, json.dumps({"reports": [report(), librespeed_report()], "cursor": "2"}).encode())
            failed = FakeInflux(True)
            with self.assertRaises(RuntimeError):
                export_reports(failed, state, checkpoint)
            self.assertFalse(checkpoint.exists())
            success = FakeInflux()
            self.assertEqual(export_reports(success, state, checkpoint), 2)
            self.assertEqual(success.lines, failed.lines)
            self.assertEqual(len(success.lines), 3)
            self.assertEqual(export_reports(success, state, checkpoint), 0)
            self.assertEqual(read_json(checkpoint)["cursor"], "2")

    def test_influx_origin_and_grafana_source_are_fixed_and_no_auth_is_in_dashboard(self):
        for origin in ("http://public.example.org", "https://user:secret@example.org", "https://example.org/path", "https://example.org/?token=x"):
            with self.assertRaises(ValueError):
                InfluxClient(origin, "synthetic-token", "synthetic-org", "telegraf")
        InfluxClient("http://127.0.0.1:8086", "synthetic-token", "synthetic-org", "telegraf")
        value = dashboard("telegraf")
        self.assertEqual(value["uid"], "sccc-device-performance")
        self.assertEqual(len(value["panels"]), 21)
        self.assertEqual(value["refresh"], "30s")
        self.assertTrue(all(panel["datasource"]["uid"] == DATASOURCE_UID for panel in value["panels"]))
        encoded_performance = json.dumps(value)
        for field in ("download_mbps", "upload_mbps", "latency_ms", "jitter_ms", "link_mbps", "request_loss_percent", "dns_ms", "tcp_connect_ms", "tls_ms", "ttfb_ms"):
            self.assertIn(field, encoded_performance)
        self.assertNotIn("synthetic-token", json.dumps(value))
        self.assertIn("labels.computer", encoded_performance)
        self.assertIn("Successful validated speed tests", encoded_performance)
        self.assertIn("Failed validated speed tests", encoded_performance)
        self.assertIn('r.type == \\"librespeed-v2\\"', encoded_performance)
        self.assertIn('r.method == \\"MultiStreamV2\\"', encoded_performance)
        for panel in value["panels"]:
            if panel["title"].startswith("Endpoint ") or panel["title"] == "Negotiated endpoint link speed":
                self.assertEqual(panel["fieldConfig"]["defaults"].get("displayName"),
                                 "${__field.labels.computer}")

        wireless = wireless_dashboard("telegraf")
        self.assertEqual(wireless["uid"], "sccc-wireless-overview")
        self.assertEqual(len(wireless["panels"]), 27)
        encoded_wireless = json.dumps(wireless)
        self.assertIn('r.type == \\"librespeed-v2\\"', encoded_wireless)
        self.assertIn('r.method == \\"MultiStreamV2\\"', encoded_wireless)
        self.assertTrue(all(panel["datasource"]["uid"] == DATASOURCE_UID for panel in wireless["panels"]))
        encoded = json.dumps(wireless)
        for measurement in ("aruba_wireless_summary", "aruba_wireless_ssid", "aruba_wireless_building", "aruba_wireless_ap", "aruba_radius_server"):
            self.assertIn(measurement, encoded)
        self.assertIn("Latest PC performance results", encoded)
        self.assertIn("Building PC speed summary", encoded)
        self.assertIn("Unknown user", encoded)
        self.assertIn("sccc_device_performance", encoded)
        self.assertIn("PC jitter by building / user / computer", encoded)
        self.assertIn("PC negotiated link speed", encoded)
        self.assertIn("labels.computer", encoded)
        self.assertIn('"unit": "bps"', encoded)
        self.assertIn('"value": "Download"', encoded)
        self.assertIn('"value": "Latency"', encoded)
        self.assertIn("Throughput automatically displays in Mbps or Gbps", encoded)
        panels_by_title = {panel["title"]: panel for panel in wireless["panels"]}
        self.assertEqual(panels_by_title["Guest clients"]["fieldConfig"]["defaults"]["color"]["fixedColor"], "blue")
        self.assertIn("APs Up", panels_by_title)
        self.assertIn("APs Down", panels_by_title)
        self.assertEqual(panels_by_title["APs Down"]["fieldConfig"]["defaults"]["thresholds"]["steps"][1]["value"], 1)
        self.assertIn("ClearPass Overall Health", panels_by_title)
        self.assertIn("ClearPass Server Health", panels_by_title)
        self.assertIn("SCCC_CPPM_AZ02", panels_by_title["ClearPass Server Health"]["targets"][0]["query"])
        self.assertIn('yield(name: "overall")', panels_by_title["ClearPass Overall Health"]["targets"][0]["query"])
        self.assertIn('yield(name: "servers")', panels_by_title["ClearPass Server Health"]["targets"][0]["query"])
        self.assertEqual(panels_by_title["ClearPass Overall Health"]["fieldConfig"]["defaults"]["mappings"][0]["options"]["0"]["text"], "UNHEALTHY")
        self.assertEqual(panels_by_title["Clients by SSID"]["fieldConfig"]["defaults"]["displayName"],
                         "${__field.labels.ssid}")
        for title in ("Clients by building", "Average clients per AP by building",
                      "Clients without IPv4 by building"):
            self.assertEqual(panels_by_title[title]["fieldConfig"]["defaults"]["displayName"],
                             "${__field.labels.building}")
        self.assertEqual(panels_by_title["AP availability by building"]["fieldConfig"]["defaults"]["displayName"],
                         "${__field.labels.building} \u00b7 ${__field.labels._field}")
        for title in ("PC download by building / user / computer", "PC upload by building / user / computer",
                      "PC latency by building / user / computer", "PC jitter by building / user / computer",
                      "PC negotiated link speed"):
            self.assertEqual(panels_by_title[title]["fieldConfig"]["defaults"]["displayName"],
                             "${__field.labels.computer}")
        self.assertNotIn("synthetic-token", encoded)

    def test_optional_wifi_missing_stale_conflicting_and_current_evidence_stay_explicit(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "wifi.json"
            self.assertEqual(wifi_observations(path, NOW), ([], True))
            rows = [{"source": "wifi", "edge": True, "bssid": "02:11:22:33:44:55", "building": "A", "observedAt": STAMP}, {"source": "wifi", "edge": True, "bssid": "02:11:22:33:44:55", "building": "B", "observedAt": STAMP}]
            atomic_write(path, json.dumps({"observations": rows}).encode())
            found, degraded = wifi_observations(path, NOW)
            self.assertEqual(len(found), 2)  # Fred must see ambiguity, never choose one.
            self.assertFalse(degraded)
            self.assertEqual(wifi_observations(path, NOW + timedelta(minutes=11)), ([], True))
            atomic_write(path, json.dumps({"observations": [{**rows[0], "mac": "00:11:22:33:44:66"}]}).encode())
            self.assertEqual(wifi_observations(path, NOW)[0][0]["mac"], "00:11:22:33:44:66")
            for bad_mac in ("01:11:22:33:44:66", "00:00:00:00:00:00", "not-a-mac", None):
                atomic_write(path, json.dumps({"observations": [{**rows[0], "mac": bad_mac}]}).encode())
                with self.assertRaises(ValueError):
                    wifi_observations(path, NOW)


class CoordinatorTests(unittest.TestCase):
    def test_coordinator_publishes_actual_status_pulls_reports_and_never_queues_jobs(self):
        class Client:
            def __init__(self):
                self.calls = []
            def request(self, path, payload=None):
                self.calls.append((path, payload))
                if path.endswith("/ad-inventory"):
                    return {"snapshotComplete": True, "adObservedAt": STAMP, "adComputers": [{"adObjectGuid": "7393b75e-8173-4e96-b87a-5165fa12e6f1", "computerName": "SYNTHETIC", "domain": "example.invalid", "enabled": True}]}
                if path.endswith("/reporting-snapshot"):
                    return presence()
                if "/reports?" in path:
                    return {"reports": [report()], "nextCursor": "1"} if "after=0" in path else {"reports": [], "nextCursor": "1"}
                return {"ok": True}
        def collect(*_args):
            return {"observations": [], "ports": [], "counters": {}, "switchesObserved": 1, "targetsExpected": 2, "degraded": True}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            client, influx = Client(), FakeInflux()
            result = cycle(client, influx, root, [TARGET], Path("/never-loaded"), None, "telegraf", collect)
            self.assertEqual(result["reportsExported"], 1)
            self.assertEqual(result["presenceRecords"], 1)
            self.assertEqual(result["collectorStatus"], "degraded")
            uploads = [payload for path, payload in client.calls if path == API + "/inventory"]
            self.assertEqual(uploads[0]["collectorStatus"]["switchesObserved"], 1)
            self.assertEqual(uploads[0]["collectorStatus"], uploads[1]["collectorStatus"])
            self.assertFalse(any("/jobs" in path for path, _payload in client.calls))
            self.assertTrue(any("sccc_device_performance," in line for line in influx.lines))
            self.assertEqual(read_json(root / "grafana-device-performance.json")["uid"], "sccc-device-performance")
            self.assertEqual(read_json(root / "grafana-wireless-operations.json")["uid"], "sccc-wireless-overview")
            self.assertEqual(read_json(root / "presence.json")["observedAt"], STAMP)
            self.assertTrue(any("sccc_device_presence," in line for line in influx.lines))

    def test_collector_status_survives_worker_validation_without_reclocking(self):
        value = {"snapshotComplete": True, "adObservedAt": STAMP, "adComputers": [{}], "observations": [], "userBuildingAssignments": [], "collectorStatus": {"observedAt": STAMP, "status": "degraded", "switchesObserved": 0, "portObservations": 0, "wifiObservations": 0}}
        self.assertEqual(validate_inventory(value, NOW)["collectorStatus"], value["collectorStatus"])
        for change in ({"switchesObserved": True}, {"wifiObservations": 60001}, {"status": "guessed"}):
            with self.assertRaises(ValueError):
                validate_inventory({**value, "collectorStatus": {**value["collectorStatus"], **change}}, NOW)


if __name__ == "__main__":
    unittest.main()
