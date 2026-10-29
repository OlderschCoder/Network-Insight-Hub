#!/usr/bin/env bash
# Apply only the reviewed speed/bar presentation to the live provisioned dashboard.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with the normal privileged NOC operator.' >&2; exit 1; }
bundle=$(realpath "${1:?Usage: apply-device-speed-bars.sh /absolute/reviewed/building-diagnostics}")
formatter="$bundle/format-device-building-bars.py"
live=/srv/sccc-ops/sccc-dashboards/sccc-device-performance.json
[[ -f "$formatter" && ! -L "$formatter" && -f "$live" && ! -L "$live" ]] || exit 1

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="/srv/sccc-ops/backups/${stamp}-device-speed-bars"
install -d -m 0700 "$backup_dir"
cp -a "$live" "$backup_dir/sccc-device-performance.json"
candidate=$(mktemp /srv/sccc-ops/sccc-dashboards/.sccc-device-performance.XXXXXX)
trap 'rm -f "$candidate"' EXIT
python3 "$formatter" "$live" "$candidate"

python3 - "$candidate" <<'PY'
import json, sys
model=json.load(open(sys.argv[1]))
by_id={p.get('id'):p for p in model.get('panels',[])}
if model.get('uid')!='sccc-device-performance' or len(model.get('panels',[]))!=23:
    raise SystemExit('Dashboard identity or panel count changed unexpectedly.')
for panel_id in (5,6,19,20,22,23):
    panel=by_id.get(panel_id,{})
    if panel.get('type')!='bargauge' or panel.get('options',{}).get('legend',{}).get('showLegend') is not False:
        raise SystemExit(f'Panel {panel_id} is not the reviewed hidden-legend bar.')
if '_value' in json.dumps([by_id[5].get('fieldConfig'),by_id[6].get('fieldConfig'),by_id[22].get('fieldConfig'),by_id[23].get('fieldConfig')]):
    raise SystemExit('Speed display names still contain _value.')
PY

owner=$(stat -c '%u:%g' "$live")
chown "$owner" "$candidate"
chmod 0644 "$candidate"
mv -f "$candidate" "$live"
trap - EXIT

python3 - "$live" <<'PY'
import json, sqlite3, sys, time
from pathlib import Path
expected=json.load(open(sys.argv[1]))
database=Path('/srv/sccc-ops/grafana/grafana.db')
if not database.is_file() or database.is_symlink():
    raise SystemExit('Grafana database is not a regular file.')
loaded=None
for _ in range(20):
    with sqlite3.connect('file:'+str(database)+'?mode=ro',uri=True,timeout=10) as db:
        row=db.execute('SELECT data FROM dashboard WHERE uid=?',(expected['uid'],)).fetchone()
    if row:
        loaded=json.loads(row[0]); ids={p.get('id') for p in loaded.get('panels',[])}
        if len(loaded.get('panels',[]))==23 and {5,6,19,20,22,23} <= ids:
            break
    time.sleep(2)
if not loaded or len(loaded.get('panels',[]))!=23:
    raise SystemExit('Grafana did not load the 23-panel dashboard.')
print(json.dumps({'ok':True,'uid':expected['uid'],'version':expected.get('version'),'panels':23}))
PY
echo "backup=$backup_dir"
