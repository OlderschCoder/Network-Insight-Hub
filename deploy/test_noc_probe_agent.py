import importlib.util
import os
from pathlib import Path
import unittest


os.environ.setdefault("NOC_PROBE_TOKEN", "unit-test-token")
MODULE_PATH = Path(__file__).with_name("noc_probe_agent.py")
SPEC = importlib.util.spec_from_file_location("noc_probe_agent", MODULE_PATH)
assert SPEC and SPEC.loader
noc_probe_agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(noc_probe_agent)


class ObservedInterfaceCounterTests(unittest.TestCase):
    def test_absent_counter_oids_remain_null(self):
        counters = noc_probe_agent.observed_interface_counters({}, {}, 7)

        self.assertEqual(
            counters,
            {
                "inErrors": None,
                "outErrors": None,
                "inDiscards": None,
                "outDiscards": None,
                "inOctets": None,
                "outOctets": None,
            },
        )

    def test_observed_zero_is_preserved_and_high_capacity_counter_wins(self):
        if_table = {
            (10, 7): "99",
            (13, 7): "0",
            (14, 7): "0",
            (16, 7): "88",
            (19, 7): "3",
            (20, 7): "4",
        }
        ifx_table = {
            (6, 7): "0",
            (10, 7): "1234",
        }

        counters = noc_probe_agent.observed_interface_counters(
            if_table, ifx_table, 7
        )

        self.assertEqual(counters["inErrors"], 0)
        self.assertEqual(counters["outErrors"], 4)
        self.assertEqual(counters["inDiscards"], 0)
        self.assertEqual(counters["outDiscards"], 3)
        self.assertEqual(counters["inOctets"], "0")
        self.assertEqual(counters["outOctets"], "1234")


if __name__ == "__main__":
    unittest.main()
