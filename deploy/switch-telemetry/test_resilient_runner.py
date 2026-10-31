import unittest
from datetime import datetime,timezone,timedelta
from resilient_runner import publish_available,SCHEMA

def switch(ip,**extra):
    return dict(switch_name='sw-'+ip,switch_ip=ip,building='Test',ok=True,polled_at=datetime.now(timezone.utc).isoformat(),interfaces=[{'port':'1/1/1','is_physical':True}],**extra)
class ContinuationTests(unittest.TestCase):
    def run_batch(self,rows,fail=None):
        calls=[]
        def sender(endpoint,token,a,s,*,dry_run):
            calls.append((s['switch_ip'],dry_run));bad=fail==(s['switch_ip'],dry_run)
            return {'ok':not bad,'status':401 if bad else 200}
        result=publish_available({'schema':SCHEMA,'run_id':'test','switches':rows},[{'ip':ip,'name':ip} for ip in ['1','2','3']],'unused','unused',sender)
        return result,calls
    def test_collection_failure_does_not_block_other_devices(self):
        rows=[switch(i) for i in ['1','2','3']];rows[1].update(ok=False,errors=['timeout']);r,c=self.run_batch(rows)
        self.assertEqual(r['applied'],2);self.assertNotIn(('2',False),c);self.assertEqual(r['failures'][0]['stage'],'collection')
    def test_failed_preflight_is_never_written_and_later_device_continues(self):
        r,c=self.run_batch([switch(i) for i in ['1','2','3']],('2',True));self.assertEqual(r['applied'],2);self.assertNotIn(('2',False),c);self.assertIn(('3',False),c)
    def test_failed_write_does_not_abort_later_devices(self):
        r,c=self.run_batch([switch(i) for i in ['1','2','3']],('2',False));self.assertEqual(r['applied'],2);self.assertIn(('3',False),c)
    def test_missing_target_is_explicit(self):
        r,c=self.run_batch([switch('1')]);self.assertEqual(r['applied'],1);self.assertEqual(len(r['failures']),2)
    def test_duplicates_rejected(self):
        r,c=self.run_batch([switch('1'),switch('1'),switch('3')]);self.assertEqual(r['applied'],1);self.assertNotIn(('1',False),c)
    def test_stale_and_future_results_not_refreshed(self):
        a,b=switch('1'),switch('2');a['polled_at']=(datetime.now(timezone.utc)-timedelta(days=1)).isoformat();b['polled_at']=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()
        r,c=self.run_batch([a,b,switch('3')]);self.assertEqual(r['applied'],1);self.assertEqual(c,[('3',True),('3',False)])
    def test_no_physical_evidence_is_rejected(self):
        a=switch('1');a['interfaces']=[];r,c=self.run_batch([a,switch('3')]);self.assertEqual(r['applied'],1);self.assertNotIn(('1',True),c)
    def test_invalid_aggregate_stops_without_requests(self):
        with self.assertRaises(ValueError):publish_available({},[],'unused','unused')
if __name__=='__main__':unittest.main()
