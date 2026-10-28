#!/usr/bin/env bash
# Guarded private collector/dashboard upgrade for honest endpoint summary panels.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with the normal privileged NOC operator.' >&2; exit 1; }
bundle=$(realpath "${1:?Usage: upgrade-private-reporting-1.3.2.sh /absolute/reviewed/building-diagnostics}")
root=/opt/sccc-building-diagnostics
current=$root/current
release=$root/releases/1.3.2
state=/var/lib/sccc-building-diagnostics
dashboards=/home/ITADMIN/sccc-ops/grafana-new/dashboards
[[ -L "$current" && -d "$(readlink -f "$current")" ]] || { echo 'Existing immutable collector release required.' >&2; exit 1; }
[[ ! -e "$release" ]] || { echo 'Release 1.3.2 already exists; reconcile instead of overwriting.' >&2; exit 1; }
[[ -f /etc/sccc-building-diagnostics/worker.env && -d "$state" && ! -L "$state" ]] || exit 1
[[ -d "$dashboards" && ! -L "$dashboards" ]] || { echo 'Existing Grafana dashboard directory required.' >&2; exit 1; }
for file in coordinator_worker.py private_snmp_collector.py pull_worker.py build_inventory.py verify-private-reporting.py; do
  [[ -f "$bundle/$file" && ! -L "$bundle/$file" ]] || { echo "Missing reviewed file: $file" >&2; exit 1; }
done

prior=$(readlink -f "$current")
backup=$root/reporting-backup-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$backup"
cp -a "$state/grafana-device-performance.json" "$backup/state-grafana-device-performance.json" 2>/dev/null || true
cp -a "$state/grafana-wireless-operations.json" "$backup/state-grafana-wireless-operations.json" 2>/dev/null || true
for name in sccc-device-performance.json sccc-wireless-overview.json sccc-wireless-operations.json; do
  if [[ -f "$dashboards/$name" && ! -L "$dashboards/$name" ]]; then
    cp -a "$dashboards/$name" "$backup/live-$name"
  else
    : > "$backup/absent-$name"
  fi
done

install -d -m 0755 "$release"
install -m 0644 "$bundle/"*.py "$release/"
python3 -m py_compile "$release/"*.py

python3 - "$release" "$state" <<'PY'
import json, os, shlex, sys
from pathlib import Path
release, state = map(Path, sys.argv[1:])
values = {}
for line in Path('/etc/sccc-building-diagnostics/worker.env').read_text().splitlines():
    if '=' not in line or line.lstrip().startswith('#'):
        continue
    key, raw = line.split('=', 1)
    parts = shlex.split(raw, comments=False)
    if len(parts) == 1:
        values[key.strip()] = parts[0]
bucket = values.get('INFLUX_BUCKET')
if not bucket:
    raise SystemExit('Existing Influx bucket is missing.')
sys.path.insert(0, str(release))
from coordinator_worker import dashboard, wireless_dashboard
models = (('grafana-device-performance.json', dashboard(bucket), 21),
          ('grafana-wireless-operations.json', wireless_dashboard(bucket), 27))
for name, model, count in models:
    if len(model.get('panels', [])) != count:
        raise SystemExit('Generated dashboard panel contract does not match.')
    temporary = state / ('.' + name + '.new')
    if temporary.exists() or temporary.is_symlink():
        raise SystemExit('Stale dashboard temporary file exists.')
    temporary.write_text(json.dumps(model, separators=(',', ':')))
    temporary.chmod(0o600)
    os.replace(temporary, state / name)
PY

replacement=$root/.current-1.3.2
ln -s "$release" "$replacement"
mv -Tf "$replacement" "$current"

rollback() {
  result=$?
  trap - ERR
  replacement=$root/.current-rollback
  rm -f "$replacement"
  ln -s "$prior" "$replacement"
  mv -Tf "$replacement" "$current"
  rm -rf -- "$release"
  rm -f "$state/grafana-device-performance.json" "$state/grafana-wireless-operations.json"
  [[ -f "$backup/state-grafana-device-performance.json" ]] && cp -a "$backup/state-grafana-device-performance.json" "$state/grafana-device-performance.json"
  [[ -f "$backup/state-grafana-wireless-operations.json" ]] && cp -a "$backup/state-grafana-wireless-operations.json" "$state/grafana-wireless-operations.json"
  for name in sccc-device-performance.json sccc-wireless-overview.json sccc-wireless-operations.json; do
    rm -f "$dashboards/$name"
    [[ -f "$backup/live-$name" ]] && cp -a "$backup/live-$name" "$dashboards/$name"
  done
  systemctl restart sccc-building-diagnostics-worker.timer || true
  echo "Reporting upgrade failed; collector and dashboards rolled back. Backup: $backup" >&2
  exit "$result"
}
trap rollback ERR

if [[ -f "$dashboards/sccc-wireless-operations.json" ]]; then
  python3 - "$dashboards/sccc-wireless-operations.json" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
if path.is_symlink() or json.loads(path.read_text()).get('uid') != 'sccc-wireless-overview':
    raise SystemExit('Unexpected legacy wireless dashboard file.')
PY
  mv "$dashboards/sccc-wireless-operations.json" "$backup/retired-sccc-wireless-operations.json"
fi

systemctl enable --now sccc-building-diagnostics-worker.timer
systemctl start sccc-building-diagnostics-worker.service
python3 "$release/verify-private-reporting.py" --provision-dashboard
systemctl is-enabled --quiet sccc-building-diagnostics-worker.timer
systemctl is-active --quiet sccc-building-diagnostics-worker.timer
trap - ERR
echo "Private reporting 1.3.2 verified. Grafana dashboards provisioned. Backup: $backup"
