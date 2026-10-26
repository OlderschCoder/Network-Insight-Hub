"""Isolated metadata-guard tests: no server, process, credential, or apply call."""
import importlib.util,json,pathlib,subprocess,unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('probe_phase1_v2',pathlib.Path(__file__).with_name('phase1-apply-v2.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
TABLES=['building_probe_buildings','building_probes','building_probe_jobs','building_probe_slots','building_probe_campus_lease','building_probe_result_exports']
DUMMY='DUMMY_PRIVATE_VALUE_MUST_NOT_APPEAR_IN_ERRORS'

class MetadataBounds(unittest.TestCase):
 def result(self,code=0,present=False):
  return subprocess.CompletedProcess(['node'],code,json.dumps([{'name':x,'present':present} for x in TABLES]),'')
 def test_success_applies_all_three_database_timeouts_and_hard_process_bound(self):
  with patch.object(module.subprocess,'run',return_value=self.result()) as run:
   self.assertEqual(module.metadata_guard({'DATABASE_URL':DUMMY}),{x:False for x in TABLES})
  args,kwargs=run.call_args
  code=args[0][-1]
  for value in ('connectionTimeoutMillis:5000','query_timeout:10000','statement_timeout:10000'):
   self.assertIn(value,code)
  self.assertIn("BEGIN READ ONLY",code)
  self.assertEqual(kwargs['timeout'],30)
  self.assertTrue(kwargs['capture_output'])
  self.assertNotIn(DUMMY,str(args[0]))
 def test_hard_timeout_has_fixed_error_and_does_not_expose_child_output(self):
  error=subprocess.TimeoutExpired(['node'],30,output=DUMMY,stderr=DUMMY)
  with patch.object(module.subprocess,'run',side_effect=error):
   with self.assertRaises(RuntimeError) as caught:module.metadata_guard({'DATABASE_URL':DUMMY})
  self.assertEqual(str(caught.exception),'Read-only feature table check exceeded its 30-second limit')
  self.assertNotIn(DUMMY,str(caught.exception))
  self.assertTrue(caught.exception.__suppress_context__)
 def test_failed_connection_or_query_has_fixed_error(self):
  failure=subprocess.CompletedProcess(['node'],1,DUMMY,DUMMY)
  with patch.object(module.subprocess,'run',return_value=failure):
   with self.assertRaisesRegex(RuntimeError,'^Read-only feature table check failed$'):
    module.metadata_guard({'DATABASE_URL':DUMMY})
 def test_existing_feature_tables_still_fail_closed(self):
  with patch.object(module.subprocess,'run',return_value=self.result(present=True)):
   with self.assertRaisesRegex(RuntimeError,'^Feature tables unexpectedly exist$'):
    module.metadata_guard({'DATABASE_URL':DUMMY})
 def test_missing_context_starts_no_child(self):
  with patch.object(module.subprocess,'run') as run:
   with self.assertRaisesRegex(RuntimeError,'^Database read-only verification context unavailable$'):
    module.metadata_guard({})
   run.assert_not_called()

if __name__=='__main__':unittest.main()
