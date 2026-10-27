"""Pure, synthetic checks only. No subprocess, network, credential or collector use."""
import sys
sys.dont_write_bytecode = True
import copy
import io
from pathlib import Path
import runpy
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
MODULE = runpy.run_path(str(HERE / 'apply_telegraf_probe.py'))
GLOBALS = MODULE['build_candidates'].__globals__
PARSER = runpy.run_path(str(HERE / 'validate_native_telegraf_1303.py'))
INPUT = (HERE / 'telegraf-building-probes.native1303.conf').read_bytes()


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.compose = b'services:\n  telegraf:\n    image: telegraf:1.30\n    volumes:\n      - ./mibs:/usr/share/snmp/mibs:ro\n'
        self.config = b'[agent]\nprecision="1s"\n[[outputs.influxdb_v2]]\nurls=["http://influxdb:8086"]\ntoken="SYNTHETIC_ONLY"\norganization="SCCC"\nbucket="telegraf"\n[[inputs.snmp]]\nname="synthetic"\n[[inputs.ping]]\nurls=["192.0.2.1"]\n'
        line = b'      - ./telegraf-export-private/export.token:/etc/telegraf/building-probe-export.token:ro\n'
        self.expected_compose = self.compose + line
        self.expected_config = self.config + MODULE['MARKER'] + INPUT
        self.pins = {'OLD_COMPOSE': MODULE['digest'](self.compose), 'OLD_CONFIG': MODULE['digest'](self.config), 'NEW_COMPOSE': MODULE['digest'](self.expected_compose), 'NEW_CONFIG': MODULE['digest'](self.expected_config)}

    def test_only_one_bind_and_append_preserve_original_bytes_and_settings(self):
        with patch.dict(GLOBALS, self.pins):
            compose, config = MODULE['build_candidates'](self.compose, self.config, INPUT)
        self.assertEqual(compose, self.expected_compose)
        self.assertEqual(config, self.expected_config)
        self.assertEqual(config[:len(self.config)], self.config)

    def test_changed_baseline_fails(self):
        with patch.dict(GLOBALS, self.pins), self.assertRaises(MODULE['Guard']):
            MODULE['build_candidates'](self.compose + b'# drift\n', self.config, INPUT)

    def test_changed_reviewed_input_fails(self):
        with patch.dict(GLOBALS, self.pins), self.assertRaises(MODULE['Guard']):
            MODULE['build_candidates'](self.compose, self.config, INPUT + b'# drift\n')

    def test_normalized_compose_allows_only_exact_readonly_bind(self):
        old = {'services': {'telegraf': {'image': 'telegraf:1.30', 'environment': {'token': 'SYNTHETIC_ONLY'}, 'volumes': []}, 'influxdb': {'image': 'unchanged'}, 'grafana': {'image': 'unchanged'}}}
        new = copy.deepcopy(old)
        new['services']['telegraf']['volumes'].append({'type': 'bind', 'source': str(MODULE['SECRET']), 'target': MODULE['TOKEN_DEST'], 'read_only': True, 'bind': {}})
        MODULE['validate_compose'](old, new)
        for change in ('other_service', 'readwrite', 'duplicate_bind'):
            invalid = copy.deepcopy(new)
            if change == 'other_service':
                invalid['services']['grafana']['image'] = 'changed'
            elif change == 'readwrite':
                invalid['services']['telegraf']['volumes'][0]['read_only'] = False
            else:
                invalid['services']['telegraf']['volumes'].append(copy.deepcopy(invalid['services']['telegraf']['volumes'][0]))
            with self.assertRaises(MODULE['Guard']):
                MODULE['validate_compose'](old, invalid)


class IngestionTests(unittest.TestCase):
    def setUp(self):
        mixed = PARSER['fixtures']()[0][1]
        self.expected = PARSER['expected_records'](mixed)
        self.start = PARSER['time_ns']('2001-01-02T05:00:00.000000001Z')
        self.health = [{'_measurement': 'sccc_building_probe_health', '_field': 'selected', '_value': 'true', '_time': '2001-01-02T05:00:01.123456789Z', **record[1]} for record in self.expected if record[0] == 'sccc_building_probe_health']
        performance = max((record for record in self.expected if record[0] == 'sccc_building_probe_performance'), key=lambda record: record[3])
        self.performance = [{'_field': name, '_value': str(value).lower() if isinstance(value, bool) else str(value), '_time': '2001-01-02T03:06:05.789Z'} for name, (_kind, value) in performance[2].items() if name in ('sampleId', 'outcome', 'successful', 'bytes', 'mbps')]

    def run_fake(self, health, performance):
        queries = []
        def query(_secret, source, _deadline=None):
            queries.append(source)
            return health if '_health' in source else performance
        with patch.dict(MODULE['verify_ingestion'].__globals__, {'query_influx': query}):
            answer = MODULE['verify_ingestion']('SYNTHETIC_ONLY', self.expected, self.start, PARSER['time_ns'])
        return answer, queries

    def test_actual_field_and_nanosecond_timestamp_readback(self):
        (passed, result), queries = self.run_fake(self.health, self.performance)
        self.assertTrue(passed)
        self.assertTrue(result['originalTimestampPreserved'])
        self.assertFalse(result['successfulSpeedClaimed'])
        self.assertIn('2001-01-02T03:06:05.788999999Z', queries[1])

    def test_wrong_building_missing_assignment_or_stale_health_does_not_pass(self):
        for change in ('wrong_building', 'missing_assignment', 'old_timestamp'):
            health = copy.deepcopy(self.health)
            if change == 'wrong_building':
                health[0]['buildingId'] = 'different'
            elif change == 'missing_assignment':
                health.pop()
            else:
                health[0]['_time'] = '2001-01-02T04:59:59.999999999Z'
            (passed, _result), _queries = self.run_fake(health, self.performance)
            self.assertFalse(passed)

    def test_changed_historical_bytes_do_not_pass(self):
        rows = copy.deepcopy(self.performance)
        next(row for row in rows if row['_field'] == 'bytes')['_value'] = '1'
        (passed, _result), _queries = self.run_fake(self.health, rows)
        self.assertFalse(passed)

    def test_failed_point_with_fabricated_mbps_is_rejected(self):
        failure = copy.deepcopy(self.expected)
        for record in failure:
            if record[0] == 'sccc_building_probe_performance' and record[1]['testType'] == 'capacity':
                record[2]['successful'] = ('bool', False)
                record[2]['outcome'] = ('string', 'unavailable')
        self.expected = failure
        rows = copy.deepcopy(self.performance)
        next(row for row in rows if row['_field'] == 'successful')['_value'] = 'false'
        next(row for row in rows if row['_field'] == 'outcome')['_value'] = 'unavailable'
        with self.assertRaises(MODULE['Guard']):
            self.run_fake(self.health, rows)

    def test_expired_query_budget_stops_before_network(self):
        with patch('urllib.request.OpenerDirector.open', side_effect=AssertionError('Network must not run')):
            with self.assertRaises(MODULE['Guard']):
                MODULE['query_influx']('SYNTHETIC_ONLY', 'synthetic query', deadline=0)


class AtomicMutationTests(unittest.TestCase):
    def simulate(self, fail_at):
        observed = {'installed': False, 'renamed': False, 'fsyncs': 0}
        class Stream(io.BytesIO):
            def fileno(self):
                return 9
        target = SimpleNamespace(parent='SYNTHETIC_PARENT', stat=lambda: SimpleNamespace(st_uid=1000, st_gid=1000, st_mode=0o100664))
        def fsync(_fd):
            observed['fsyncs'] += 1
            if (fail_at == 'data_fsync' and observed['fsyncs'] == 1) or (fail_at == 'directory_fsync' and observed['fsyncs'] == 2):
                raise OSError('Synthetic durability failure')
        def replace(_source, _target):
            observed['renamed'] = True
        def open_directory(_path, _flags):
            if fail_at == 'directory_open':
                raise OSError('Synthetic directory open failure')
            return 10
        def close(_fd):
            if fail_at == 'directory_close':
                raise OSError('Synthetic directory close failure')
        fake_os = SimpleNamespace(fdopen=lambda *_args: Stream(), fsync=fsync, fchown=lambda *_args: None, fchmod=lambda *_args: None,
                                  replace=replace, open=open_directory, close=close, O_RDONLY=0, O_DIRECTORY=0,
                                  path=SimpleNamespace(exists=lambda _path: False), unlink=lambda _path: None)
        def installed():
            observed['installed'] = True
        substitutions = {'os': fake_os, 'file_bytes': lambda *_args: b'old', 'tempfile': SimpleNamespace(mkstemp=lambda **_kwargs: (9, 'SYNTHETIC_TEMP'))}
        with patch.dict(MODULE['atomic_replace'].__globals__, substitutions), self.assertRaises(OSError):
            MODULE['atomic_replace'](target, b'new', MODULE['digest'](b'old'), installed)
        return observed

    def test_pre_rename_failure_is_not_recorded_as_installed(self):
        observed = self.simulate('data_fsync')
        self.assertFalse(observed['renamed'])
        self.assertFalse(observed['installed'])

    def test_each_post_rename_failure_keeps_mutation_flag_for_rollback(self):
        for location in ('directory_open', 'directory_fsync', 'directory_close'):
            with self.subTest(location=location):
                observed = self.simulate(location)
                self.assertTrue(observed['renamed'])
                self.assertTrue(observed['installed'])


if __name__ == '__main__':
    unittest.main()
