#!/usr/bin/env bash
# Provision only the current Wireless Operations dashboard. No collector changes.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with the normal privileged NOC operator.' >&2; exit 1; }
bundle=$(realpath "${1:?Usage: provision-wireless-dashboard.sh /absolute/reviewed/building-diagnostics}")
[[ -f "$bundle/coordinator_worker.py" && ! -L "$bundle/coordinator_worker.py" ]] || exit 1
[[ -f /etc/sccc-building-diagnostics/worker.env ]] || exit 1
dashboard_dir=/home/ITADMIN/sccc-ops/grafana-new/dashboards
[[ -d "$dashboard_dir" && ! -L "$dashboard_dir" ]] || { echo 'Existing Grafana dashboard directory required.' >&2; exit 1; }

python3 - "$bundle" "$dashboard_dir" <<'PY'
import base64
from datetime import datetime, timezone
import importlib
import json
import os
from pathlib import Path
import shlex
import shutil
import sys
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

bundle, dashboard_dir = map(Path, sys.argv[1:])

def environment(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if '=' not in line or line.lstrip().startswith('#'):
            continue
        key, raw = line.split('=', 1)
        parts = shlex.split(raw, comments=False)
        if len(parts) == 1:
            values[key.strip()] = parts[0]
    return values

worker = environment('/etc/sccc-building-diagnostics/worker.env')
bucket = worker.get('INFLUX_BUCKET')
if not bucket:
    raise SystemExit('Existing Influx bucket is missing.')
sys.path.insert(0, str(bundle))
from coordinator_worker import DATASOURCE_UID, wireless_dashboard
model = wireless_dashboard(bucket)
if model.get('uid') != 'sccc-wireless-overview' or len(model.get('panels', [])) != 21:
    raise SystemExit('Reviewed dashboard contract does not match.')

destination = dashboard_dir / 'sccc-wireless-operations.json'
raw = json.dumps(model, separators=(',', ':')).encode()
if destination.exists() and (not destination.is_file() or destination.is_symlink()):
    raise SystemExit('Existing dashboard is not a regular file.')
changed = not destination.exists() or destination.read_bytes() != raw
backup = None
if changed and destination.exists():
    backup_root = dashboard_dir.parent / 'backups'
    backup_root.mkdir(mode=0o700, exist_ok=True)
    backup = backup_root / ('sccc-wireless-operations-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.json')
    if backup.exists():
        raise SystemExit('Dashboard backup path already exists.')
    shutil.copy2(destination, backup)
if changed:
    temporary = dashboard_dir / '.sccc-wireless-operations.json.new'
    if temporary.exists() or temporary.is_symlink():
        raise SystemExit('Stale dashboard temporary path exists.')
    with temporary.open('xb') as handle:
        handle.write(raw)
    owner = dashboard_dir.stat()
    os.chown(temporary, owner.st_uid, owner.st_gid)
    temporary.chmod(0o644)
    os.replace(temporary, destination)

grafana = environment('/home/ITADMIN/sccc-ops/.env')
credentials = base64.b64encode((grafana['GRAFANA_ADMIN_USER'] + ':' + grafana['GRAFANA_ADMIN_PASSWORD']).encode()).decode()
opener = build_opener(ProxyHandler({}))
def request(path, payload=None):
    req = Request('http://127.0.0.1:3000' + path,
                  None if payload is None else json.dumps(payload).encode(),
                  headers={'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/json'})
    with opener.open(req, timeout=30) as response:
        return json.load(response)

loaded = None
for _ in range(20):
    try:
        loaded = request('/api/dashboards/uid/sccc-wireless-overview')
        if loaded.get('dashboard', {}).get('uid') == model['uid'] and len(loaded['dashboard'].get('panels', [])) == 21:
            break
    except HTTPError as error:
        if error.code != 404:
            raise
    time.sleep(2)
if not loaded or len(loaded.get('dashboard', {}).get('panels', [])) != 21:
    raise SystemExit('Grafana did not load the reviewed dashboard.')

now_ms = int(time.time() * 1000)
source = 'from(bucket: ' + json.dumps(bucket) + ')'
payload = {'from': str(now_ms - 7 * 86400 * 1000), 'to': str(now_ms), 'queries': [
    {'refId': 'A', 'datasource': {'type': 'influxdb', 'uid': DATASOURCE_UID},
     'query': source + ' |> range(start: -15m) |> filter(fn: (r) => r._measurement == "aruba_wireless_summary" and r._field == "clients_total") |> last()',
     'maxDataPoints': 1000, 'intervalMs': 60000},
    {'refId': 'B', 'datasource': {'type': 'influxdb', 'uid': DATASOURCE_UID},
     'query': source + ' |> range(start: -7d) |> filter(fn: (r) => r._measurement == "sccc_device_performance" and r._field == "download_mbps")',
     'maxDataPoints': 1000, 'intervalMs': 60000}]}
results = request('/api/ds/query', payload).get('results', {})
for ref in ('A', 'B'):
    result = results.get(ref, {})
    frames = result.get('frames', [])
    if result.get('error') or not any(frame.get('data', {}).get('values') for frame in frames):
        raise SystemExit('Grafana datasource did not return expected ' + ref + ' data.')
print(json.dumps({'ok': True, 'uid': model['uid'], 'panels': 21, 'changed': changed,
                  'backup': str(backup) if backup else None, 'wirelessFrames': len(results['A']['frames']),
                  'pcFrames': len(results['B']['frames'])}))
PY
