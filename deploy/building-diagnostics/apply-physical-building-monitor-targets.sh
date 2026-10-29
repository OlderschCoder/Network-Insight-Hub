#!/usr/bin/env bash
set -euo pipefail

archive="${1:-/tmp/fred-physical-building-monitor-targets-20261029.tgz}"
expected_archive_sha="${2:?Expected archive SHA-256 is required}"
app_root="/home/scccadmin/apps/Network-Insight-Hub"
network_source="$app_root/artifacts/api-server/src/routes/network_nodes.ts"
api_dist="$app_root/artifacts/api-server/dist"
expected_network_source_sha="87dc4ee240fc0d412b8470fde57371d6b74aeab2c0d20d306008fd85fb0ef07b"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work_dir="$(mktemp -d /tmp/fred-building-monitor-targets.XXXXXX)"
backup_dir="$app_root/.release-backups/${stamp}-building-monitor-targets"
api_previous="$app_root/artifacts/api-server/dist.previous-${stamp}"
rollback_needed=0

rollback() {
  status=$?
  if [[ "$rollback_needed" == "1" ]]; then
    cp -a "$backup_dir/network_nodes.ts" "$network_source"
    if [[ -d "$api_previous" ]]; then
      mv "$api_dist" "$api_dist.failed-${stamp}"
      mv "$api_previous" "$api_dist"
    fi
    chown -R scccadmin:scccadmin "$app_root/artifacts/api-server"
    systemctl restart sccc-api.service || true
  fi
  exit "$status"
}
trap rollback ERR

[[ "$(id -u)" == "0" ]] || { echo "Run as root" >&2; exit 1; }
echo "$expected_archive_sha  $archive" | sha256sum -c -
echo "$expected_network_source_sha  $network_source" | sha256sum -c -
tar -xzf "$archive" -C "$work_dir"
[[ -f "$work_dir/api-dist/index.mjs" ]]
[[ -f "$work_dir/network_nodes.ts" ]]

mkdir -p "$backup_dir"
cp -a "$network_source" "$backup_dir/network_nodes.ts"
cp -a "$api_dist" "$backup_dir/api-dist"
cp -a "$work_dir/network_nodes.ts" "$network_source"
cp -a "$work_dir/api-dist" "$app_root/artifacts/api-server/dist.new-${stamp}"
chown -R scccadmin:scccadmin "$network_source" "$app_root/artifacts/api-server/dist.new-${stamp}"
mv "$api_dist" "$api_previous"
mv "$app_root/artifacts/api-server/dist.new-${stamp}" "$api_dist"
rollback_needed=1

systemctl restart sccc-api.service
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8080/api/healthz >/dev/null; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:8080/api/healthz
curl -fsS https://app-server2.centralus.cloudapp.azure.com/api/network/public/buildings \
  | python3 -c 'import json,sys; rows=json.load(sys.stdin); assert len(rows)==27; assert all(r["name"] not in {"Epworth ALC","Campus Wide","Business","Azure (Hybrid-VNet)"} for r in rows)'

rollback_needed=0
echo "DEPLOYED backup=$backup_dir"
