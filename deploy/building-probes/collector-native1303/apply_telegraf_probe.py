#!/usr/bin/env python3
"""Prepared only: guarded initial Building Probe input addition to existing Telegraf."""
import sys
sys.dont_write_bytecode = True
import argparse
import copy
import csv
import datetime as dt
import errno
import hashlib
import io
import ipaddress
import json
import os
from pathlib import Path
import re
import runpy
import signal
import socket
import ssl
import stat
import struct
import subprocess
import tempfile
import time
import tomllib
import urllib.parse
import urllib.request
import uuid

ROOT = Path('/home/ITADMIN/sccc-ops')
COMPOSE = ROOT / 'compose.yml'
CONFIG = ROOT / 'telegraf/telegraf.conf'
SECRET_DIR = ROOT / 'telegraf-export-private'
SECRET = SECRET_DIR / 'export.token'
TOKEN_DEST = '/etc/telegraf/building-probe-export.token'
OLD_COMPOSE = 'E6D8C61891BCB8D737B860085C32738D443CB4D9D8431F8B738F459CD40A0945'
NEW_COMPOSE = '4F868605E8F04FD383036683698894237A36EED31EBACDAD6679A16F802DCE67'
OLD_CONFIG = '86F741119C6FD70FC7064880DCF7A110D5EBA4CAD456D046FD1559757C12B9E5'
NEW_CONFIG = '72E76ABB0E8A895526DA690397874A19AFD009A2319EB192101F8B897E6B5CD5'
INPUT_SHA = 'A56042A70F455FF56AA0D403AFCE630C4CCC5300778D9FF6A23D08420588A501'
PARSER_SHA = '4680094A44F9F5604DD7223B9329F4A99F9B17BEBC8EA50C3DB429BBE9261F50'
BASELINE_SHA = 'AE0CD4AC9F7BDAD93357C7EC39D69427419E6D46783680746E562123B5C8A8E3'
TELEGRAF_ID = '8ce06028e4c6d94f0cec3c95b2e09909ea7a80c5416cb9fbf46bfe074477f2cf'
RUNTIME_UID = RUNTIME_GID = 999
ACL_XATTR = 'system.posix_acl_access'
RUNTIME_READ_ACL = struct.pack('<I', 2) + b''.join(struct.pack('<HHI', tag, permissions, identity) for tag, permissions, identity in (
    (1, 6, 0xFFFFFFFF), (2, 4, RUNTIME_UID), (4, 0, 0xFFFFFFFF), (16, 4, 0xFFFFFFFF), (32, 0, 0xFFFFFFFF)))
IMAGE = 'sha256:e9fed213aa114dc196fe4cef487e815d7a3e65231cfa5421833b041029e899c6'
IMAGE_TAG = 'telegraf:1.30'
NETWORK = '3ba5ca25d485711ce26b07a0cd28b4bb8e59db30152dab8ceb26a00ad6b7a04b'
INFLUX_ID = '186f7ed5adea4e887624df57f4c1e9f93be37eb91d5c11b04b9fadf77b2c305d'
INFLUX_IP = '172.18.0.4'
LIVE_URL = 'https://app-server2.centralus.cloudapp.azure.com/api/building-probes/results/export?recent=true&limit=1000'
MARKER = b'\n\n# SCCC Building Probe export: input-only native Telegraf 1.30.3 compatibility.\n'
COMPOSE_ARGS = ['docker', 'compose', '--project-directory', str(ROOT), '-p', 'sccc-ops', '-f', str(COMPOSE)]


class Guard(Exception):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest().upper()


def command(args, timeout=15):
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Guard('CommandUnavailableOrTimedOut') from None
    if result.returncode or len(result.stdout) > 8 * 1024 * 1024:
        raise Guard('CommandFailedOrOutputBound')
    return result.stdout


def no_links(path):
    for item in (path, *path.parents):
        if item.is_symlink():
            raise Guard('SymlinkRefused')


def file_bytes(path, expected=None, private=False, maximum=2 * 1024 * 1024):
    no_links(path)
    with path.open('rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 1000 or info.st_nlink != 1 or info.st_size > maximum:
            raise Guard('UnexpectedFileMetadata')
        if private and stat.S_IMODE(info.st_mode) != 0o600:
            raise Guard('PrivateFileModeRequired')
        data = stream.read(maximum + 1)
    if len(data) > maximum or expected and digest(data) != expected:
        raise Guard('FileHashOrSizeMismatch')
    return data


def new_file(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def access_acl(fd):
    try:
        return os.getxattr(fd, ACL_XATTR)
    except OSError as error:
        if error.errno == errno.ENODATA:
            return None
        raise Guard('PosixAclUnavailable') from None


def grant_runtime_reader(path, expected, on_changed=None):
    """Owner-only ACL change on one exact regular file; no group/other access."""
    no_links(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 1000 or info.st_gid != 1000 or info.st_nlink != 1 or info.st_size > 2 * 1024 * 1024:
            raise Guard('RuntimeReaderFileMetadataMismatch')
        data = stream.read(2 * 1024 * 1024 + 1)
        if digest(data) != expected:
            raise Guard('RuntimeReaderFileHashMismatch')
        acl = access_acl(stream.fileno())
        if stat.S_IMODE(info.st_mode) == 0o600 and acl is None:
            os.setxattr(stream.fileno(), ACL_XATTR, RUNTIME_READ_ACL)
            if on_changed is not None:
                on_changed()
            os.fsync(stream.fileno())
        elif stat.S_IMODE(info.st_mode) != 0o640 or acl != RUNTIME_READ_ACL:
            raise Guard('UnexpectedExistingRuntimeReaderAcl')
        after = os.fstat(stream.fileno())
        if (after.st_uid, after.st_gid, after.st_nlink, stat.S_IMODE(after.st_mode)) != (1000, 1000, 1, 0o640) or access_acl(stream.fileno()) != RUNTIME_READ_ACL:
            raise Guard('RuntimeReaderAclReadbackMismatch')
        stream.seek(0)
        if digest(stream.read(2 * 1024 * 1024 + 1)) != expected:
            raise Guard('RuntimeReaderFileChangedDuringAcl')


def reuse_rollback_credential(baseline, token_hash, on_changed=None):
    evidence = baseline.get('priorRollbackReceipt', {})
    expected_path = '/home/ITADMIN/.cache/sccc-telegraf-apply-20261027T035025Z/receipt.json'
    expected_sha = '1CAAE56950EDC01E090F81CB8C8003676D404B7D122A20B498D4E7BAE8BDA818'
    if evidence != {'path': expected_path, 'sha256': expected_sha}:
        raise Guard('KnownRollbackEvidenceRequired')
    prior = json.loads(file_bytes(Path(expected_path), expected_sha, True))
    if any(prior.get(key) != value for key, value in {'status': 'RolledBack', 'phase': 'RollbackVerified', 'rollbackSourceHashesVerified': True, 'protectedCredentialCreated': True, 'permanentCredentialPath': str(SECRET)}.items()):
        raise Guard('RollbackCredentialEvidenceMismatch')
    no_links(SECRET_DIR)
    info = SECRET_DIR.stat()
    if not stat.S_ISDIR(info.st_mode) or (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (1000, 1000, 0o700) or set(SECRET_DIR.iterdir()) != {SECRET}:
        raise Guard('RetainedCredentialDirectoryMismatch')
    if access_acl(str(SECRET_DIR)) is not None:
        raise Guard('UnexpectedRetainedDirectoryAcl')
    grant_runtime_reader(SECRET, token_hash, on_changed)


def atomic_replace(path, data, expected_current, on_installed=None):
    if digest(file_bytes(path)) != expected_current:
        raise Guard('LiveFileChangedBeforeReplace')
    previous = path.stat()
    if previous.st_uid != 1000 or previous.st_gid != 1000 or stat.S_IMODE(previous.st_mode) != 0o664:
        raise Guard('LiveFileOwnershipOrModeChanged')
    fd, temporary = tempfile.mkstemp(prefix='.sccc-probe-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchown(stream.fileno(), -1, previous.st_gid)
            os.fchmod(stream.fileno(), 0o664)
        if digest(file_bytes(path)) != expected_current:
            raise Guard('LiveFileChangedDuringReplace')
        os.replace(temporary, path)
        if on_installed is not None:
            on_installed()  # A later directory durability failure must not hide the completed mutation.
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def build_candidates(compose, config, addition):
    if (digest(compose), digest(config), digest(addition)) != (OLD_COMPOSE, OLD_CONFIG, INPUT_SHA):
        raise Guard('InitialBaselineMismatch')
    newline = b'\r\n' if b'\r\n' in compose else b'\n'
    anchor = b'      - ./mibs:/usr/share/snmp/mibs:ro' + newline
    line = b'      - ./telegraf-export-private/export.token:/etc/telegraf/building-probe-export.token:ro' + newline
    if compose.count(anchor) != 1 or b'building-probe-export.token' in compose or b'/api/building-probes/results/export' in config:
        raise Guard('UniqueAdditiveBaselineRequired')
    proposed_compose = compose.replace(anchor, anchor + line)
    proposed_config = config + MARKER + addition
    if proposed_compose.replace(line, b'') != compose or proposed_config[:len(config)] != config:
        raise Guard('OldBytesWereNotPreserved')
    if (digest(proposed_compose), digest(proposed_config)) != (NEW_COMPOSE, NEW_CONFIG):
        raise Guard('ReviewedPostimageMismatch')
    old = tomllib.loads(config.decode())
    proposed = tomllib.loads(proposed_config.decode())
    http = proposed.get('inputs', {}).pop('http', None)
    if proposed != old or not isinstance(http, list) or len(http) != 3:
        raise Guard('ExistingTelegrafSettingsChanged')
    for entry in http:
        if entry['urls'] != [LIVE_URL] or entry['token_file'] != TOKEN_DEST or entry['precision'] != '1ns' or entry['interval'] != '15s' or entry['timeout'] != '10s' or len(entry['json_v2']) != 1:
            raise Guard('NewInputContractMismatch')
    return proposed_compose, proposed_config


def inspect_running(deadline=None):
    def bounded(args):
        remaining = 15 if deadline is None else min(15, deadline - time.monotonic())
        if remaining <= 0:
            raise Guard('AcceptanceDeadline')
        return command(args, remaining)
    ids = bounded(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=sccc-ops']).decode().split()
    if not ids:
        raise Guard('ProjectContainersMissing')
    rows = json.loads(bounded(['docker', 'inspect', *ids]))
    result = {}
    for row in rows:
        service = (row['Config'].get('Labels') or {}).get('com.docker.compose.service')
        if service in result or service not in ('grafana', 'influxdb', 'telegraf'):
            raise Guard('UnexpectedProjectContainer')
        result[service] = {'id': row['Id'], 'imageId': row['Image'], 'pid': row['State']['Pid'], 'startedAt': row['State']['StartedAt'], 'restartCount': row['RestartCount'], 'health': (row['State'].get('Health') or {}).get('Status')}
    if set(result) != {'grafana', 'influxdb', 'telegraf'}:
        raise Guard('ExpectedThreeRunningServices')
    return result


def cached_image():
    if command(['docker', 'image', 'inspect', IMAGE_TAG, '--format', '{{.Id}}']).decode().strip() != IMAGE:
        raise Guard('CachedImageTagChanged')


def normalized_compose(path):
    args = ['docker', 'compose', '--project-directory', str(ROOT), '-p', 'sccc-ops', '-f', str(path), 'config', '--format', 'json']
    return json.loads(command(args))


def validate_compose(old, proposed):
    remaining = copy.deepcopy(proposed)
    mounts = remaining['services']['telegraf']['volumes']
    selected = [entry for entry in mounts if entry.get('target') == TOKEN_DEST]
    if len(selected) != 1 or selected[0].get('type') != 'bind' or selected[0].get('source') != str(SECRET) or selected[0].get('read_only') is not True:
        raise Guard('ExactlyOneReadOnlyTokenBindRequired')
    mounts.remove(selected[0])
    if remaining != old:
        raise Guard('OtherComposeSettingsChanged')


def native_validation(stage, token_source, parse_metric, types, run_id):
    name = 'sccc-probe-validate-' + run_id
    args = ['docker', 'run', '--rm', '--pull', 'never', '--name', name, '--label', 'org.sccc.probe-validation=' + run_id,
            '--network', NETWORK, '--read-only', '--user', str(RUNTIME_UID) + ':' + str(RUNTIME_GID), '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--pids-limit', '64', '--memory', '256m', '--cpus', '0.5', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m',
            '--mount', 'type=bind,src=' + str(stage / 'telegraf-building-probes.native1303.conf') + ',dst=/etc/telegraf/telegraf.conf,readonly',
            '--mount', 'type=bind,src=' + str(token_source) + ',dst=' + TOKEN_DEST + ',readonly',
            '--entrypoint', '/usr/bin/telegraf', IMAGE, '--config', '/etc/telegraf/telegraf.conf', '--test', '--input-filter', 'http']
    try:
        try:
            process = subprocess.run(args, capture_output=True, timeout=35, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise Guard('NativeValidationUnavailableOrTimedOut') from None
        if process.returncode or len(process.stdout) > 8 * 1024 * 1024 or re.search(rb'(?:^|\s)E!(?:\s|$)', process.stderr):
            raise Guard('NativeValidationReturnedError')
        stdout = process.stdout.decode()
    finally:
        # Only our unique labelled validation container may be removed after a timeout.
        item = subprocess.run(['docker', 'inspect', name], capture_output=True, timeout=10)
        if item.returncode == 0:
            row = json.loads(item.stdout)[0]
            if row['Image'] != IMAGE or (row['Config'].get('Labels') or {}).get('org.sccc.probe-validation') != run_id:
                raise Guard('ValidationContainerOwnershipMismatch')
            command(['docker', 'rm', '-f', row['Id']], 10)
    records = [parse_metric(line.strip().removeprefix('> ')) for line in stdout.splitlines() if line.strip()]
    required = {'sccc_building_probe_performance': {'sampleId', 'jobId', 'outcome', 'termination', 'successful'},
                'sccc_building_probe_capacity_window': {'capacityJobId', 'bytesValidated', 'bytesReserved', 'remainingBytes', 'state', 'attemptCount', 'complete'},
                'sccc_building_probe_health': {'selected', 'capable', 'eligible', 'online', 'offline', 'hasThroughputSample', 'staleThroughput', 'missedSlot', 'consecutiveFailures'}}
    tags = {'sccc_building_probe_performance': {'deviceId', 'buildingId', 'testType'}, 'sccc_building_probe_capacity_window': {'buildingId'}, 'sccc_building_probe_health': {'assignmentId', 'buildingId'}}
    for measurement, actual_tags, fields, timestamp in records:
        if measurement not in required or set(actual_tags) != tags[measurement] or not required[measurement] <= fields.keys() or not fields.keys() <= types[measurement].keys():
            raise Guard('NativeProjectionShapeMismatch')
        if any(kind != types[measurement][key] for key, (kind, _) in fields.items()) or timestamp > time.time_ns() + 30_000_000_000:
            raise Guard('NativeProjectionTypeOrTimeMismatch')
        if measurement.endswith('_performance') and fields['successful'][1] is False and 'mbps' in fields:
            raise Guard('FailedSampleMustNotAcquireMbps')
    if not any(record[0] == 'sccc_building_probe_health' for record in records):
        raise Guard('NoRealHealthRowsAvailable')
    return records


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def influx_access(old_config, telegraf_id):
    config = tomllib.loads(old_config.decode())
    output = config['outputs']['influxdb_v2']
    if len(output) != 1:
        raise Guard('OneExistingInfluxOutputRequired')
    container = json.loads(command(['docker', 'inspect', telegraf_id]))[0]
    environment = dict(value.split('=', 1) for value in container['Config'].get('Env', []) if '=' in value)
    def resolve(value):
        if not isinstance(value, str):
            raise Guard('InfluxConfigurationIncomplete')
        match = re.fullmatch(r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)', value)
        return environment.get(match[1] or match[2], '') if match else value
    entry = output[0]
    urls = [resolve(value) for value in entry['urls']]
    if urls != ['http://influxdb:8086'] or resolve(entry['organization']) != 'SCCC' or resolve(entry['bucket']) != 'telegraf':
        raise Guard('ExistingInfluxDestinationChanged')
    secret = resolve(entry.get('token'))
    if not secret or any(char.isspace() for char in secret):
        raise Guard('ExistingInfluxReadCredentialUnavailable')
    row = json.loads(command(['docker', 'inspect', INFLUX_ID]))[0]
    address = row['NetworkSettings']['Networks']['sccc-ops_default']
    if address['NetworkID'] != NETWORK or address['IPAddress'] != INFLUX_IP or not ipaddress.ip_address(INFLUX_IP).is_private:
        raise Guard('PinnedInfluxContainerNetworkChanged')
    return secret


def query_influx(secret, query, deadline=None):
    request = urllib.request.Request('http://' + INFLUX_IP + ':8086/api/v2/query?org=SCCC', method='POST',
        data=json.dumps({'query': query, 'type': 'flux'}).encode(), headers={'Authorization': 'Token ' + secret, 'Content-Type': 'application/json', 'Accept': 'application/csv'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    budget = 10 if deadline is None else min(10, deadline - time.monotonic())
    if budget <= 0:
        raise Guard('AcceptanceDeadline')
    def alarm_expired(_number, _frame):
        raise TimeoutError()
    previous = signal.signal(signal.SIGALRM, alarm_expired)
    signal.setitimer(signal.ITIMER_REAL, budget)
    try:
        with opener.open(request, timeout=budget) as response:
            body = response.read(4 * 1024 * 1024 + 1)
            if response.status != 200 or len(body) > 4 * 1024 * 1024:
                raise Guard('InfluxReadbackResponseInvalid')
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
    header, records = None, []
    for row in csv.reader(io.StringIO(body.decode())):
        if not row or row[0].startswith('#'):
            continue
        if '_field' in row and '_value' in row and '_time' in row:
            header = row
        elif header and len(row) == len(header):
            records.append(dict(zip(header, row)))
    return records


def verify_ingestion(secret, expected, started_at, now_ns, deadline=None):
    def iso_ns(value):
        seconds, nanos = divmod(value, 1_000_000_000)
        return dt.datetime.fromtimestamp(seconds, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S') + '.' + str(nanos).zfill(9) + 'Z'
    start = iso_ns(started_at - 1_000_000_000)
    health_query = 'from(bucket: "telegraf") |> range(start: time(v: ' + json.dumps(start) + ')) |> filter(fn: (r) => r._measurement == "sccc_building_probe_health" and r._field == "selected") |> group(columns: ["assignmentId", "buildingId"]) |> last()'
    rows = query_influx(secret, health_query, deadline)
    expected_health = {(record[1]['assignmentId'], record[1]['buildingId']) for record in expected if record[0] == 'sccc_building_probe_health'}
    observed_health = {(row.get('assignmentId'), row.get('buildingId')) for row in rows if row.get('_measurement') == 'sccc_building_probe_health' and now_ns(row['_time']) >= started_at}
    if not expected_health <= observed_health:
        return False, {'healthAssignmentsExpected': len(expected_health), 'healthAssignmentsObserved': len(observed_health)}
    performance = [record for record in expected if record[0] == 'sccc_building_probe_performance']
    result = {'healthAssignmentsExpected': len(expected_health), 'healthAssignmentsObserved': len(observed_health), 'historicalPerformancePointVerified': False, 'successfulSpeedClaimed': False}
    if performance:
        measurement, tags, fields, timestamp = max(performance, key=lambda record: record[3])
        stamp = iso_ns(timestamp - 1)
        filters = ' and '.join('r.' + key + ' == ' + json.dumps(value) for key, value in tags.items())
        query = 'from(bucket: "telegraf") |> range(start: time(v: ' + json.dumps(stamp) + ')) |> filter(fn: (r) => r._measurement == "sccc_building_probe_performance" and ' + filters + ') |> filter(fn: (r) => r._field == "sampleId" or r._field == "outcome" or r._field == "successful" or r._field == "bytes" or r._field == "mbps") |> limit(n: 1000)'
        actual = {row['_field']: row['_value'] for row in query_influx(secret, query, deadline) if now_ns(row['_time']) == timestamp}
        if actual.get('sampleId') != fields['sampleId'][1] or actual.get('outcome') != fields['outcome'][1] or actual.get('successful') != str(fields['successful'][1]).lower():
            return False, result
        if 'bytes' in fields and actual.get('bytes') != str(fields['bytes'][1]):
            return False, result
        if fields['successful'][1] is False and 'mbps' in actual:
            raise Guard('InfluxFailedSampleHasUnexpectedMbps')
        result['historicalPerformancePointVerified'] = True
        result['originalTimestampPreserved'] = True
    return True, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage-root', type=Path, required=True)
    parser.add_argument('--apply', action='store_true', help='Without this flag, inspect guards/postimage hashes only; no staging/native/container/config writes')
    args = parser.parse_args()
    stage = args.stage_root
    receipt = {'schema': 'sccc.telegraf.additive-apply.v1', 'status': 'Blocked', 'phase': 'Preflight', 'runId': uuid.uuid4().hex, 'secretPrintedOrPassedOnCli': False, 'otherContainersChangedByUs': False, 'backendJobsOrGatesChanged': False, 'productionConfigChanged': False}
    changed_config = changed_compose = stage_valid = False
    token_bytes = None
    old_compose = old_config = None
    before = None
    def mark_config_installed():
        nonlocal changed_config
        changed_config = True
        receipt['productionConfigChanged'] = True
    def mark_compose_installed():
        nonlocal changed_compose
        changed_compose = True
        receipt['productionConfigChanged'] = True
    try:
        if socket.gethostname() != 'CiscoDirectoryConnector' or os.geteuid() != 1000 or stage.parent != Path('/home/ITADMIN/.cache') or not re.fullmatch(r'sccc-telegraf-apply-[A-Za-z0-9_-]+', stage.name):
            raise Guard('ExpectedCollectorOperatorAndStageRequired')
        no_links(stage)
        info = stage.stat()
        if info.st_uid != 1000 or stat.S_IMODE(info.st_mode) != 0o700 or (stage / 'receipt.json').exists():
            raise Guard('FreshPrivateStageRequired')
        stage_valid = True
        receipt['stageRoot'] = str(stage)
        baseline = json.loads(file_bytes(stage / 'compose-additive-baseline.json', BASELINE_SHA, True))
        addition = file_bytes(stage / 'telegraf-building-probes.native1303.conf', INPUT_SHA, True)
        file_bytes(stage / 'validate_native_telegraf_1303.py', PARSER_SHA, True)
        old_compose, old_config = file_bytes(COMPOSE, OLD_COMPOSE), file_bytes(CONFIG, OLD_CONFIG)
        for path in (COMPOSE, CONFIG):
            item = path.stat()
            if item.st_gid != 1000 or stat.S_IMODE(item.st_mode) != 0o664:
                raise Guard('OriginalOwnershipOrModeChanged')
        proposed_compose, proposed_config = build_candidates(old_compose, old_config, addition)
        before = inspect_running()
        pins = {row['service']: row for row in baseline['runningContainers']}
        for service, current in before.items():
            if any(current[key] != pins[service][key] for key in ('id', 'imageId', 'pid', 'startedAt', 'restartCount')) or current['health'] not in (None, 'healthy'):
                raise Guard('RunningContainerBaselineChanged')
        if before['telegraf']['id'] != TELEGRAF_ID:
            raise Guard('OriginalTelegrafContainerChanged')
        runtime_lines = command(['docker', 'top', TELEGRAF_ID, '-eo', 'uid,gid,comm']).decode().splitlines()
        if len(runtime_lines) != 2 or runtime_lines[1].split() != [str(RUNTIME_UID), str(RUNTIME_GID), 'telegraf']:
            raise Guard('ActualTelegrafRuntimeIdentityChanged')
        cached_image()
        old_normalized = normalized_compose(COMPOSE)
        if digest(json.dumps(old_normalized, sort_keys=True, separators=(',', ':')).encode()) != baseline['composeNormalized']['sha256']:
            raise Guard('ResolvedComposeEnvironmentChanged')
        receipt.update(status='InspectReady', phase='Inspected', composeBeforeSha256=OLD_COMPOSE, composeAfterSha256=NEW_COMPOSE, configBeforeSha256=OLD_CONFIG, configAfterSha256=NEW_CONFIG)
        if not args.apply:
            return
        backup = stage / 'backups'
        backup.mkdir(mode=0o700)
        receipt['backupRoot'] = str(backup)
        new_file(backup / 'compose.before', old_compose)
        new_file(backup / 'telegraf.before', old_config)
        proposed_path = stage / 'compose.candidate.yml'
        new_file(proposed_path, proposed_compose)
        new_file(stage / 'telegraf.candidate.conf', proposed_config)
        validate_compose(old_normalized, normalized_compose(proposed_path))
        receipt.update(status='Prepared', phase='CandidatesVerified', composeBeforeSha256=OLD_COMPOSE, composeAfterSha256=NEW_COMPOSE, configBeforeSha256=OLD_CONFIG, configAfterSha256=NEW_CONFIG)
        receipt['phase'] = 'ProtectedCredentialAndNativeValidation'
        token_source = stage / 'export.token.source'
        token_bytes = bytearray(file_bytes(token_source, private=True, maximum=43))
        token_hash = file_bytes(stage / 'export.token.sha256', private=True, maximum=65).decode('ascii').strip().upper()
        if len(token_bytes) != 43 or not re.fullmatch(rb'[A-Za-z0-9_-]{43}', token_bytes) or not re.fullmatch(r'[A-F0-9]{64}', token_hash) or digest(token_bytes) != token_hash:
            raise Guard('DeliveredExportCredentialDigestMismatch')
        helper = runpy.run_path(str(stage / 'validate_native_telegraf_1303.py'))
        grant_runtime_reader(stage / 'telegraf-building-probes.native1303.conf', INPUT_SHA)
        grant_runtime_reader(token_source, token_hash)
        expected = native_validation(stage, token_source, helper['parse_metric'], helper['TYPES'], receipt['runId'])
        receipt['nativeRuntimeIdentity'] = '999:999'
        receipt['nativeMetricCounts'] = {name: sum(record[0] == name for record in expected) for name in helper['TYPES']}
        influx_secret = influx_access(old_config, TELEGRAF_ID)
        # Read permission is required before any production mutation.
        query_influx(influx_secret, 'from(bucket: "telegraf") |> range(start: -1m) |> filter(fn: (r) => r._measurement == "sccc_building_probe_health") |> limit(n: 1)')
        reuse_rollback_credential(baseline, token_hash, lambda: receipt.update(protectedCredentialAclChanged=True))
        receipt['protectedCredentialReusedFromVerifiedRollback'] = True
        receipt['protectedCredentialReaderUid'] = RUNTIME_UID
        receipt['permanentCredentialPath'] = str(SECRET)
        if digest(file_bytes(COMPOSE)) != OLD_COMPOSE or digest(file_bytes(CONFIG)) != OLD_CONFIG or inspect_running() != before:
            raise Guard('BaselineChangedAfterValidation')
        receipt['phase'] = 'AtomicFileApply'
        atomic_replace(CONFIG, proposed_config, OLD_CONFIG, mark_config_installed)
        atomic_replace(COMPOSE, proposed_compose, OLD_COMPOSE, mark_compose_installed)
        if digest(file_bytes(COMPOSE)) != NEW_COMPOSE or digest(file_bytes(CONFIG)) != NEW_CONFIG:
            raise Guard('AppliedFileReadbackMismatch')
        receipt['phase'] = 'TelegrafOnlyRecreate'
        cached_image()
        started_at = time.time_ns()
        command(COMPOSE_ARGS + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'telegraf'], 60)
        receipt['phase'] = 'HealthAndInfluxAcceptance'
        deadline = time.monotonic() + 90
        accepted = False
        while time.monotonic() < deadline:
            current = inspect_running(deadline)
            if current['grafana'] != before['grafana'] or current['influxdb'] != before['influxdb'] or current['telegraf']['imageId'] != IMAGE or current['telegraf']['restartCount'] != 0:
                raise Guard('UnexpectedContainerRuntimeChange')
            if current['telegraf']['health'] in (None, 'healthy'):
                accepted, receipt['ingestionReadback'] = verify_ingestion(influx_secret, expected, started_at, helper['time_ns'], deadline)
                if accepted:
                    break
            time.sleep(min(5, max(0, deadline - time.monotonic())))
        if not accepted:
            raise Guard('HealthOrInfluxAcceptanceDeadline')
        receipt.update(status='AppliedVerified', phase='Completed', containerAfter=current, originalSettingsPreserved=True)
    except Exception as error:
        receipt['failureCode'] = str(error) if isinstance(error, Guard) else 'FailedAt' + receipt['phase']
        receipt['status'] = 'BlockedBeforeProductionChange'
        if changed_config or changed_compose:
            receipt['phaseBeforeRollback'] = receipt['phase']
            receipt['phase'] = 'Rollback'
            try:
                if changed_compose:
                    atomic_replace(COMPOSE, old_compose, NEW_COMPOSE)
                if changed_config:
                    atomic_replace(CONFIG, old_config, NEW_CONFIG)
                receipt['rollbackSourceHashesRestored'] = True
                if receipt['failureCode'] == 'CommandUnavailableOrTimedOut' and receipt.get('phaseBeforeRollback') == 'TelegrafOnlyRecreate':
                    raise Guard('ComposeOutcomeUnknownNoSecondOperationStarted')
                cached_image()
                command(COMPOSE_ARGS + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'telegraf'], 60)
                rollback_deadline = time.monotonic() + 60
                while True:
                    restored = inspect_running(rollback_deadline)
                    if restored['telegraf']['health'] in (None, 'healthy') and restored['telegraf']['restartCount'] == 0:
                        break
                    if time.monotonic() >= rollback_deadline:
                        raise Guard('RollbackHealthDeadline')
                    time.sleep(min(5, max(0, rollback_deadline - time.monotonic())))
                if digest(file_bytes(COMPOSE)) != OLD_COMPOSE or digest(file_bytes(CONFIG)) != OLD_CONFIG or restored['grafana'] != before['grafana'] or restored['influxdb'] != before['influxdb'] or restored['telegraf']['imageId'] != IMAGE:
                    raise Guard('RollbackReadbackMismatch')
                receipt.update(status='RolledBack', phase='RollbackVerified', rollbackSourceHashesVerified=True)
                receipt['protectedCredentialRetainedUnreferenced'] = any(receipt.get(key, False) for key in ('protectedCredentialCreated', 'protectedCredentialReusedFromVerifiedRollback', 'protectedCredentialAclChanged'))
            except Exception as rollback_error:
                receipt.update(status='RollbackRequiresOperator', rollbackErrorCode=str(rollback_error) if isinstance(rollback_error, Guard) else 'RollbackOperationFailed')
    finally:
        if token_bytes is not None:
            for index in range(len(token_bytes)):
                token_bytes[index] = 0
        receipt['completedAtUtc'] = dt.datetime.now(dt.timezone.utc).isoformat()
        if stage_valid and args.apply:
            try:
                new_file(stage / 'receipt.json', (json.dumps(receipt, indent=2) + '\n').encode())
            except Exception:
                receipt['receiptWriteFailed'] = True
                receipt['status'] = 'OperationCompletedButReceiptWriteFailed'
        print(json.dumps(receipt))
    if receipt['status'] not in ('AppliedVerified', 'InspectReady'):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
