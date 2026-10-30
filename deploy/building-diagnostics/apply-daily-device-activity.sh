#!/usr/bin/env bash
# Add only the reviewed daily Ethernet/Wi-Fi activity panel to the live dashboard.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with the normal privileged NOC operator.' >&2; exit 1; }
bundle=$(realpath "${1:?Usage: apply-daily-device-activity.sh /absolute/reviewed/building-diagnostics}")
formatter="$bundle/add-daily-device-activity.py"
live=/srv/sccc-ops/sccc-dashboards/sccc-device-performance.json
[[ -f "$formatter" && ! -L "$formatter" && -f "$live" && ! -L "$live" ]] || exit 1

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="/srv/sccc-ops/backups/${stamp}-daily-device-activity"
install -d -m 0700 "$backup_dir"
cp -a "$live" "$backup_dir/sccc-device-performance.json"
candidate=$(mktemp /srv/sccc-ops/sccc-dashboards/.sccc-device-performance.XXXXXX)
trap 'rm -f "$candidate"' EXIT
python3 "$formatter" "$live" "$candidate"

python3 - "$candidate" <<'PY'
import json, sys
model=json.load(open(sys.argv[1]))
panels={p.get('id'):p for p in model.get('panels',[])}
panel=panels.get(24,{})
if model.get('uid')!='sccc-device-performance' or len(model.get('panels',[]))!=24:
    raise SystemExit('Dashboard identity or reviewed panel count changed unexpectedly.')
if panel.get('title')!='Daily validated speed measurements by adapter':
    raise SystemExit('Daily activity panel is missing.')
query=(panel.get('targets') or [{}])[0].get('query','')
for expected in ('r.type == "librespeed-v2"','r.method == "MultiStreamV2"','group(columns: ["adapter"])','aggregateWindow(every: 1d'):
    if expected not in query:
        raise SystemExit(f'Daily activity query is missing {expected}.')
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
        loaded=json.loads(row[0])
        if len(loaded.get('panels',[]))==24 and any(p.get('id')==24 for p in loaded.get('panels',[])):
            break
    time.sleep(2)
if not loaded or len(loaded.get('panels',[]))!=24:
    raise SystemExit('Grafana did not load the reviewed 24-panel dashboard.')
print(json.dumps({'ok':True,'uid':expected['uid'],'version':loaded.get('version'),'panels':24}))
PY
echo "backup=$backup_dir"
