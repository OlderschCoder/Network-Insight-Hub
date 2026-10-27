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
import csv
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import shlex
import shutil
import sqlite3
import subprocess
import sys
import time
from urllib.parse import urlencode
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
if model.get('uid') != 'sccc-wireless-overview' or len(model.get('panels', [])) != 24:
    raise SystemExit('Reviewed dashboard contract does not match.')

destination = dashboard_dir / 'sccc-wireless-overview.json'
raw = json.dumps(model, separators=(',', ':')).encode()
if destination.exists() and (not destination.is_file() or destination.is_symlink()):
    raise SystemExit('Existing dashboard is not a regular file.')
changed = not destination.exists() or destination.read_bytes() != raw
backup = None
if changed and destination.exists():
    backup_root = dashboard_dir.parent / 'backups'
    backup_root.mkdir(mode=0o700, exist_ok=True)
    backup = backup_root / ('sccc-wireless-overview-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.json')
    if backup.exists():
        raise SystemExit('Dashboard backup path already exists.')
    shutil.copy2(destination, backup)
if changed:
    temporary = dashboard_dir / '.sccc-wireless-overview.json.new'
    if temporary.exists() or temporary.is_symlink():
        raise SystemExit('Stale dashboard temporary path exists.')
    with temporary.open('xb') as handle:
        handle.write(raw)
    owner = dashboard_dir.stat()
    os.chown(temporary, owner.st_uid, owner.st_gid)
    temporary.chmod(0o644)
    os.replace(temporary, destination)

opener = build_opener(ProxyHandler({}))

def request(url, payload=None, headers=None):
    req = Request(url, None if payload is None else payload, headers=headers or {})
    with opener.open(req, timeout=30) as response:
        return response.read(2 * 1024 * 1024 + 1)

health = json.loads(request('http://127.0.0.1:3000/api/health'))
if health.get('database') != 'ok':
    raise SystemExit('Grafana health check failed.')

containers = []
for line in subprocess.check_output(
        ['docker', 'ps', '--format', '{{.ID}}\t{{.Image}}\t{{.Names}}'], text=True).splitlines():
    container_id, image, name = line.split('\t', 2)
    if 'grafana' in (image + ' ' + name).lower():
        containers.append(container_id)
if len(containers) != 1:
    raise SystemExit('Expected exactly one running Grafana container.')
details = json.loads(subprocess.check_output(['docker', 'inspect', containers[0]], text=True))[0]
mounts = [entry for entry in details.get('Mounts', []) if entry.get('Destination') == '/var/lib/grafana']
if len(mounts) != 1:
    raise SystemExit('Grafana data mount could not be resolved safely.')
database = Path(mounts[0]['Source']) / 'grafana.db'
if not database.is_file() or database.is_symlink():
    raise SystemExit('Grafana database is not a regular file.')

loaded = None
for _ in range(20):
    with sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True, timeout=10) as connection:
        row = connection.execute('SELECT data FROM dashboard WHERE uid = ?', (model['uid'],)).fetchone()
    if row:
        loaded = json.loads(row[0])
        titles = {panel.get('title') for panel in loaded.get('panels', [])}
        required = {'PC download by building / user / computer', 'PC upload by building / user / computer',
                    'PC latency by building / user / computer', 'PC request loss by building / user / computer',
                    'PC external DNS / TCP / TLS / TTFB', 'Building PC speed summary',
                    'Latest PC performance results', 'ClearPass Overall Health',
                    'ClearPass Server Health'}
        if len(loaded.get('panels', [])) == 24 and required <= titles:
            break
    time.sleep(2)
if not loaded or len(loaded.get('panels', [])) != 24 or not required <= titles:
    raise SystemExit('Grafana did not load the reviewed dashboard.')

for key in ('INFLUX_URL', 'INFLUX_TOKEN', 'INFLUX_ORG'):
    if not worker.get(key):
        raise SystemExit('Existing Influx connection is incomplete.')
if worker['INFLUX_URL'].rstrip('/') != 'http://127.0.0.1:8086':
    raise SystemExit('Only the existing local Influx service is accepted.')

def influx(flux):
    raw = request(worker['INFLUX_URL'].rstrip('/') + '/api/v2/query?' + urlencode({'org': worker['INFLUX_ORG']}),
                  json.dumps({'query': flux, 'type': 'flux'}).encode(),
                  {'Authorization': 'Token ' + worker['INFLUX_TOKEN'], 'Content-Type': 'application/json',
                   'Accept': 'application/csv'})
    if len(raw) > 2 * 1024 * 1024:
        raise SystemExit('Influx query response exceeded the safety bound.')
    return list(csv.DictReader(io.StringIO('\n'.join(
        line for line in raw.decode().splitlines() if not line.startswith('#')))))

source = 'from(bucket: ' + json.dumps(bucket) + ')'
wireless = influx(source + ' |> range(start: -15m) |> filter(fn: (r) => r._measurement == "aruba_wireless_summary" and r._field == "clients_total") |> last()')
pc = influx(source + ' |> range(start: -7d) |> filter(fn: (r) => r._measurement == "sccc_device_performance" and r._field == "download_mbps")')
for label, rows in (('wireless', wireless), ('PC', pc)):
    if not any(row.get('_value') not in (None, '', '_value') for row in rows):
        raise SystemExit('Influx did not return expected ' + label + ' data.')
print(json.dumps({'ok': True, 'uid': model['uid'], 'panels': 24, 'changed': changed,
                  'backup': str(backup) if backup else None, 'grafanaDatabase': 'loaded',
                  'wirelessRows': len(wireless), 'pcRows': len(pc)}))
PY
