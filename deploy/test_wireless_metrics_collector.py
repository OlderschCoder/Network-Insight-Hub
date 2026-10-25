from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wireless_metrics_collector as collector


class WirelessMetricsParserTests(unittest.TestCase):
    def test_bss_parser_preserves_ssid_and_ap_with_space(self):
        text = (
            "f0:5c:19:ef:54:b0  SCCC Wireless  N/A   10.80.35.23  "
            "5GHz/VHT/80MHz  136E/19.0/27.5  ap    7       AP- SU121-Unknown  0  3d:2h  1500\n"
        )
        result = collector.parse_bss_table(text)
        self.assertEqual(result["f0:5c:19:ef:54:b0"]["ssid"], "SCCC Wireless")
        self.assertEqual(result["f0:5c:19:ef:54:b0"]["ap"], "AP- SU121-Unknown")
        self.assertEqual(result["f0:5c:19:ef:54:b0"]["clients"], 7)

    def test_user_parser_marks_missing_ipv4(self):
        text = (
            "0.0.0.0  ac:00:7a:65:56:68  mark  sccc_role  00:01:02  802.1x  "
            "AP-AA113  Wireless  SCCC Wireless/94:b4:0f:5f:8c:30/5GHz-VHT  profile\n"
        )
        users = collector.parse_users(text, "controller1")
        self.assertEqual(len(users), 1)
        self.assertFalse(collector.valid_ipv4(users[0]["ip"]))

    def test_radius_parser_uses_expected_columns(self):
        text = (
            "SCCC_CPPM_AZ01 37439 299610 0 0 0 0 1 0 2079 48 37431 297434 0 "
            "361 44 337049 336993 0 0 0 0 0 0 0 0 33 3:22:15 255/255\n"
        )
        parsed = collector.parse_radius_statistics(text)["SCCC_CPPM_AZ01"]
        self.assertEqual(parsed["accept_total"], 2079)
        self.assertEqual(parsed["reject_total"], 48)
        self.assertEqual(parsed["timeout_total"], 361)
        self.assertEqual(parsed["avg_response_ms"], 44.0)

    def test_counter_reset_is_not_negative(self):
        self.assertEqual(collector.counter_delta(20, 15), 5)
        self.assertEqual(collector.counter_delta(3, 100), 3)
        self.assertEqual(collector.counter_delta(3, None), 0)

    def test_building_rules(self):
        self.assertEqual(collector.building_for("AAP-SLC-635-9", "slc-apgrp"), "Student Living Center")
        self.assertEqual(collector.building_for("AP-COS109", "cos-apgrp"), "Cosmetology")
        self.assertEqual(collector.building_for("Mystery", "a-apgrp"), "Main Campus")
        self.assertEqual(collector.building_for("Mystery", "default"), "Unknown")

    def test_line_protocol_escapes_tags(self):
        payload = collector.line_protocol(
            [{"measurement": "m", "tags": {"building": "Main Campus"}, "fields": {"clients": 2}}],
            timestamp=10,
        )
        self.assertEqual(payload, "m,building=Main\\ Campus clients=2i 10\n")


if __name__ == "__main__":
    unittest.main()
