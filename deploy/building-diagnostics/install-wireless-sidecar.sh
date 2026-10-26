#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || exit 1
bundle=$(realpath "${1:?Supply the verified wireless sidecar source directory}")
live=/opt/sccc-wireless-metrics/wireless_metrics_collector.py
expected=94883ab699a00bc05bb98850efaf371c5cd7eb88542f9c7cb435a17d34e74e49
[[ $(sha256sum "$live" | cut -d' ' -f1) == "$expected" ]] || { echo 'Wireless source differs from reviewed baseline; stop.' >&2; exit 1; }
override=/etc/systemd/system/sccc-wireless-metrics.service.d/40-diagnostics-sidecar.conf
[[ ! -e "$override" ]] || { echo 'Sidecar override exists; reconcile.' >&2; exit 1; }
backup=/opt/sccc-wireless-metrics/diagnostics-backup-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$backup"
cp -a "$live" "$backup/"
docker build -f "$bundle/Dockerfile.wireless-metrics" -t sccc-wireless-metrics:1.1.0 "$bundle"
install -m 0755 "$bundle/wireless_metrics_collector.py" "$live"
install -d -m 0755 "$(dirname "$override")"
cat > "$override" <<'UNIT'
[Service]
ExecStart=
ExecStart=/usr/bin/docker run --rm --name sccc-wireless-metrics --network host --env-file /etc/sccc-wireless-metrics.env -v /etc/sccc-wireless-metrics/known_hosts:/etc/sccc-wireless-metrics/known_hosts:ro -v /var/lib/sccc-wireless-metrics:/var/lib/sccc-wireless-metrics sccc-wireless-metrics:1.1.0
UNIT
systemctl daemon-reload
echo "Wireless sidecar image configured; existing timer retained. Backup: $backup"
echo 'Rollback: restore backed-up Python file, remove only this new override, daemon-reload. Image1.0 remains available.'
