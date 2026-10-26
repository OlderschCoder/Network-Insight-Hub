#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Use the authorized private VM administrator.' >&2; exit 1; }
source_dir=$(realpath "${1:?Supply the verified private collector bundle}")
root=/opt/sccc-building-diagnostics
release=$root/releases/1.2.0
[[ ! -e "$release" ]] || { echo 'Immutable collector release exists; reconcile.' >&2; exit 1; }
[[ ! -e "$root/current" && ! -L "$root/current" ]] || { echo 'Collector current already exists; use a guarded atomic upgrade.' >&2; exit 1; }
[[ -f /etc/sccc-building-diagnostics/worker.env && -f /etc/sccc-wireless-metrics.env ]]
for file in coordinator_worker.py private_snmp_collector.py pull_worker.py build_inventory.py targets.csv; do [[ -f "$source_dir/$file" && ! -L "$source_dir/$file" ]]; done
mkdir -p "$root/releases"
install -d -m 0755 "$release"
install -m 0644 "$source_dir/"*.py "$release/"
install -m 0600 "$source_dir/targets.csv" /etc/sccc-building-diagnostics/targets.csv
install -d -m 0700 /var/lib/sccc-building-diagnostics
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/sccc-building-diagnostics/worker.env')
source=Path('/etc/sccc-wireless-metrics.env')
keys=('INFLUX_URL','INFLUX_TOKEN','INFLUX_ORG','INFLUX_BUCKET')
values=dict(line.split('=',1) for line in source.read_text().splitlines() if '=' in line and not line.startswith('#'))
if not all(values.get(k) for k in keys): raise SystemExit('Existing Influx configuration is incomplete.')
old=p.read_text()
if any(k+'=' in old for k in keys): raise SystemExit('Influx settings already present; reconcile.')
p.write_text(old+''.join(k+'='+values[k]+'\n' for k in keys))
p.chmod(0o600)
PY
ln -s "$release" "$root/current"
cat > /etc/systemd/system/sccc-building-diagnostics-worker.service <<'UNIT'
[Unit]
Description=SCCC private device location, port performance and result coordinator
Wants=network-online.target
After=network-online.target docker.service
[Service]
Type=oneshot
User=root
Group=root
EnvironmentFile=/etc/sccc-building-diagnostics/worker.env
ExecStart=/usr/bin/python3 /opt/sccc-building-diagnostics/current/coordinator_worker.py --state-dir /var/lib/sccc-building-diagnostics --targets /etc/sccc-building-diagnostics/targets.csv --wifi /var/lib/sccc-wireless-metrics/diagnostics-observations.json
UMask=0077
TimeoutStartSec=300
KillMode=control-group
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ReadWritePaths=/var/lib/sccc-building-diagnostics
UNIT
cat > /etc/systemd/system/sccc-building-diagnostics-worker.timer <<'UNIT'
[Unit]
Description=Refresh private SCCC device evidence and pull measurements every five minutes
[Timer]
OnBootSec=90s
OnUnitInactiveSec=5min
AccuracySec=15s
Unit=sccc-building-diagnostics-worker.service
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
python3 -m py_compile "$release/"*.py
echo 'Private collector installed. Review and start one cycle before enabling its timer.'
