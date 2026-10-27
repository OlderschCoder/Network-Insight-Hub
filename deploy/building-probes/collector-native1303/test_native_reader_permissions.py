#!/usr/bin/env python3
"""Opt-in, synthetic-only ACL proof on the pinned collector image; no production apply."""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import runpy
import socket
import stat
import subprocess
import tempfile
import threading
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--applier', type=Path, required=True)
    parser.add_argument('--applier-sha256', required=True)
    parser.add_argument('--execute-synthetic', action='store_true', required=True)
    args = parser.parse_args()
    if os.geteuid() != 1000 or socket.gethostname() != 'CiscoDirectoryConnector':
        raise RuntimeError('Exact collector/operator required')
    if hashlib.sha256(args.applier.read_bytes()).hexdigest().upper() != args.applier_sha256.upper():
        raise RuntimeError('Reviewed helper hash required')
    module = runpy.run_path(str(args.applier))
    image = module['IMAGE']
    actual = subprocess.check_output(['docker', 'image', 'inspect', 'telegraf:1.30', '--format', '{{.Id}}'], timeout=10, text=True).strip()
    if actual != image:
        raise RuntimeError('Cached image pin mismatch')
    root = Path(tempfile.mkdtemp(prefix='sccc-telegraf-acl-synthetic-', dir='/home/ITADMIN/.cache'))
    os.chmod(root, 0o700)
    token = root / 'dummy.token'
    dummy = b'A' * 43
    module['new_file'](token, dummy)
    requests = {'authorized': 0}
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.headers.get('Authorization') != 'Bearer ' + dummy.decode():
                self.send_error(403)
                return
            requests['authorized'] += 1
            data = b'{"fixture_ok":1}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        def log_message(self, *_args):
            pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    config_data = ('[[inputs.http]]\nurls=["http://127.0.0.1:' + str(server.server_address[1]) + '/synthetic"]\ntimeout="3s"\nmethod="GET"\ntoken_file="/etc/telegraf/building-probe-export.token"\ndata_format="json"\nname_override="sccc_acl_fixture"\n').encode()
    config = root / 'synthetic.conf'
    module['new_file'](config, config_data)
    module['grant_runtime_reader'](config, module['digest'](config_data))
    module['grant_runtime_reader'](token, module['digest'](dummy))
    public_config = root / 'public-synthetic.conf'
    module['new_file'](public_config, config_data)
    os.chmod(public_config, 0o644)
    cases = []
    try:
        for identity, selected_config, expected in [('999:999', config, 'allowed'), ('65534:65534', config, 'config-denied'), ('65534:65534', public_config, 'token-denied')]:
            name = 'sccc-acl-synthetic-' + uuid.uuid4().hex
            before = requests['authorized']
            command = ['docker', 'run', '--rm', '--pull', 'never', '--name', name, '--label', 'org.sccc.acl-synthetic=' + name,
                       '--network', 'host', '--read-only', '--user', identity, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                       '--pids-limit', '64', '--memory', '256m', '--cpus', '0.5', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m',
                       '--mount', 'type=bind,src=' + str(selected_config) + ',dst=/etc/telegraf/telegraf.conf,readonly',
                       '--mount', 'type=bind,src=' + str(token) + ',dst=/etc/telegraf/building-probe-export.token,readonly',
                       '--entrypoint', '/usr/bin/telegraf', image, '--config', '/etc/telegraf/telegraf.conf', '--test', '--input-filter', 'http']
            try:
                result = subprocess.run(command, capture_output=True, timeout=20, check=False)
            finally:
                item = subprocess.run(['docker', 'inspect', name], capture_output=True, timeout=8)
                if item.returncode == 0:
                    live = json.loads(item.stdout)[0]
                    if live['Image'] != image or (live['Config'].get('Labels') or {}).get('org.sccc.acl-synthetic') != name:
                        raise RuntimeError('Synthetic container ownership mismatch')
                    subprocess.run(['docker', 'rm', '-f', live['Id']], capture_output=True, timeout=8, check=True)
            emitted = b'sccc_acl_fixture' in result.stdout and b'fixture_ok=1' in result.stdout
            denied = b'permission denied' in result.stderr.lower()
            calls = requests['authorized'] - before
            if expected == 'allowed':
                passed = result.returncode == 0 and emitted and calls == 1
            else:
                passed = result.returncode != 0 and denied and not emitted and calls == 0
            cases.append({'identity': identity, 'case': expected, 'passed': passed, 'nativeExit': result.returncode, 'authorizedLoopbackGets': calls, 'fixtureMetricEmitted': emitted, 'permissionDeniedObserved': denied})
            if not passed:
                raise RuntimeError('Synthetic native permission case failed: ' + expected)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
    files = []
    for path in (config, token):
        info = path.stat()
        files.append({'name': path.name, 'uid': info.st_uid, 'gid': info.st_gid, 'mode': oct(stat.S_IMODE(info.st_mode)), 'exactReaderAcl': os.getxattr(path, module['ACL_XATTR']) == module['RUNTIME_READ_ACL']})
    report = {'schema': 'sccc.telegraf.native-reader-permission.v1', 'status': 'SyntheticNativeReaderPassed', 'imageId': image, 'applierSha256': args.applier_sha256.upper(), 'scratchPath': str(root), 'syntheticOnly': True, 'realExportTokenUsed': False, 'fredContacted': False, 'influxWrites': False, 'productionConfigChanged': False, 'files': files, 'cases': cases}
    module['new_file'](root / 'result.json', (json.dumps(report, indent=2) + '\n').encode())
    print(json.dumps(report))


if __name__ == '__main__':
    main()
