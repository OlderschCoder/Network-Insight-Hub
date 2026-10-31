import unittest
from firewall_telemetry import summarize
class FirewallTests(unittest.TestCase):
    def test_fresh_interface_evidence(self):
        r=summarize('172.25.0.1',[{'_time':'2026-10-31T06:00:00Z','_measurement':'interface','ifName':'port1'}],True,'2026-10-31T06:05:00Z')
        self.assertTrue(r['telemetryAvailable']);self.assertEqual(r['interfaceCount'],1);self.assertEqual(r['lastPolled'],'2026-10-31T06:00:00Z')
    def test_ping_alone_does_not_claim_snmp(self):
        r=summarize('172.25.0.1',[{'_time':'2026-10-31T06:00:00Z','_measurement':'ping'}],True,'2026-10-31T06:05:00Z');self.assertTrue(r['reachable']);self.assertFalse(r['telemetryAvailable'])
    def test_stale_future_and_invalid_excluded(self):
        for at in ['2026-10-31T05:00:00Z','2026-10-31T07:00:00Z','invalid']:
            r=summarize('172.25.0.1',[{'_time':at,'_measurement':'interface','ifName':'port1'}],True,'2026-10-31T06:05:00Z');self.assertFalse(r['telemetryAvailable'])
if __name__=='__main__':unittest.main()
