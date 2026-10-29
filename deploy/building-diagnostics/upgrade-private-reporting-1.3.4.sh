#!/usr/bin/env bash
# Add the reviewed private staff-to-building assignment feed without replacing dashboards.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with the normal privileged NOC operator.' >&2; exit 1; }
bundle=$(realpath "${1:?Usage: upgrade-private-reporting-1.3.4.sh /absolute/reviewed/building-diagnostics /absolute/reviewed/staff-assignments.json}")
staff=$(realpath "${2:?Reviewed private staff assignment JSON required}")
root=/opt/sccc-building-diagnostics
current=$root/current
release=$root/releases/1.3.4
state=/var/lib/sccc-building-diagnostics
config=/etc/sccc-building-diagnostics/staff-building-assignments.json
[[ -L "$current" && "$(readlink -f "$current")" == "$root/releases/1.3.3" ]] || { echo 'Reviewed private reporting 1.3.3 baseline required.' >&2; exit 1; }
[[ ! -e "$release" ]] || { echo 'Release 1.3.4 already exists; reconcile instead of overwriting.' >&2; exit 1; }
[[ -f "$staff" && ! -L "$staff" ]] || { echo 'Reviewed private staff assignment file required.' >&2; exit 1; }
for file in coordinator_worker.py private_snmp_collector.py pull_worker.py build_inventory.py verify-private-reporting.py; do
  [[ -f "$bundle/$file" && ! -L "$bundle/$file" ]] || { echo "Missing reviewed file: $file" >&2; exit 1; }
done

restore_timer_on_preflight_error() {
  systemctl restart sccc-building-diagnostics-worker.timer || true
}
trap restore_timer_on_preflight_error ERR
systemctl stop sccc-building-diagnostics-worker.timer
for _ in $(seq 1 72); do
  systemctl is-active --quiet sccc-building-diagnostics-worker.service || break
  sleep 5
done
if systemctl is-active --quiet sccc-building-diagnostics-worker.service; then
  echo 'Collector did not reach a clean release boundary within six minutes.' >&2
  false
fi
trap - ERR

prior=$(readlink -f "$current")
backup=$root/reporting-backup-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$backup"
cp -a "$state/inventory.json" "$backup/inventory.json" 2>/dev/null || true
if [[ -f "$config" && ! -L "$config" ]]; then cp -a "$config" "$backup/staff-building-assignments.json"; else : > "$backup/staff-config-absent"; fi
install -m 0600 -o root -g root "$staff" "$backup/reviewed-staff-building-assignments.json"

rollback() {
  result=$?
  trap - ERR
  replacement=$root/.current-rollback
  rm -f "$replacement"
  ln -s "$prior" "$replacement"
  mv -Tf "$replacement" "$current"
  rm -rf -- "$release"
  rm -f "$config"
  [[ -f "$backup/staff-building-assignments.json" ]] && cp -a "$backup/staff-building-assignments.json" "$config"
  systemctl restart sccc-building-diagnostics-worker.timer || true
  echo "Staff assignment rollout failed and was rolled back. Backup: $backup" >&2
  exit "$result"
}
trap rollback ERR

install -d -m 0755 "$release"
install -m 0644 "$bundle/"*.py "$release/"
python3 -m py_compile "$release/"*.py
python3 - "$release" "$backup/reviewed-staff-building-assignments.json" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from coordinator_worker import staff_assignments
rows = staff_assignments(Path(sys.argv[2]))
if not 1 <= len(rows) <= 2000:
    raise SystemExit('Reviewed staff assignment file is empty or unbounded.')
if any(row['building'] in {'Azure Connectivity (Objects)', 'Business', 'Campus Wide', 'Maintenance'} for row in rows):
    raise SystemExit('A non-physical service scope was found in staff assignments.')
print(f'validated_staff_assignments={len(rows)}')
PY

install -m 0600 -o root -g root "$backup/reviewed-staff-building-assignments.json" "$config.new"
mv -f "$config.new" "$config"
replacement=$root/.current-1.3.4
ln -s "$release" "$replacement"
mv -Tf "$replacement" "$current"

systemctl enable --now sccc-building-diagnostics-worker.timer
systemctl start sccc-building-diagnostics-worker.service
systemctl is-enabled --quiet sccc-building-diagnostics-worker.timer
systemctl is-active --quiet sccc-building-diagnostics-worker.timer
python3 - "$state/inventory.json" "$config" <<'PY'
import json, sys
from pathlib import Path
inventory = json.loads(Path(sys.argv[1]).read_text())
config = json.loads(Path(sys.argv[2]).read_text())
rows = inventory.get('userBuildingAssignments', [])
if len(rows) != len(config['assignments']):
    raise SystemExit('Collector did not publish the reviewed staff assignment count.')
expected = {(row['username'].lower(), row['building']) for row in config['assignments']}
actual = {(row['username'].lower(), row['building']) for row in rows}
if actual != expected:
    raise SystemExit('Published staff assignments differ from the reviewed private source.')
print(f'published_staff_assignments={len(rows)}')
PY
trap - ERR
echo "Private reporting 1.3.4 verified with private staff building assignments. Backup: $backup"
