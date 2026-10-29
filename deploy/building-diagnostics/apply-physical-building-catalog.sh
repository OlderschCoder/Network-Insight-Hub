#!/usr/bin/env bash
set -euo pipefail

archive="${1:-/tmp/fred-physical-building-catalog-20261029.tgz}"
expected_archive_sha="${2:?Expected archive SHA-256 is required}"
app_root="/home/scccadmin/apps/Network-Insight-Hub"
network_source="$app_root/artifacts/api-server/src/routes/network_nodes.ts"
catalog_source="$app_root/artifacts/api-server/src/lib/building_diagnostics_catalog.ts"
ui_source="$app_root/artifacts/it-reporting/src/pages/network/buildings.tsx"
api_dist="$app_root/artifacts/api-server/dist"
ui_public="$app_root/artifacts/it-reporting/dist/public"
expected_network_source_sha="0d139aa751ca114dc7cbd72a382820c601ec74d3da72ac5dd767ce19eed76ddc"
expected_ui_source_sha="b93bf881d048877bcbc7c74230703bc8e91f9378f1a72641d970c00cd2cdd8bf"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work_dir="$(mktemp -d /tmp/fred-physical-building-catalog.XXXXXX)"
backup_dir="$app_root/.release-backups/${stamp}-physical-building-catalog"
api_previous="$app_root/artifacts/api-server/dist.previous-${stamp}"
ui_previous="$app_root/artifacts/it-reporting/dist/public.previous-${stamp}"
rollback_needed=0

rollback() {
  status=$?
  if [[ "$rollback_needed" == "1" ]]; then
    cp -a "$backup_dir/network_nodes.ts" "$network_source"
    cp -a "$backup_dir/buildings.tsx" "$ui_source"
    rm -f "$catalog_source"
    if [[ -f "$backup_dir/building_diagnostics_catalog.ts" ]]; then
      cp -a "$backup_dir/building_diagnostics_catalog.ts" "$catalog_source"
    fi
    if [[ -d "$api_previous" ]]; then
      mv "$api_dist" "$api_dist.failed-${stamp}"
      mv "$api_previous" "$api_dist"
    fi
    if [[ -d "$ui_previous" ]]; then
      mv "$ui_public" "$ui_public.failed-${stamp}"
      mv "$ui_previous" "$ui_public"
    fi
    chown -R scccadmin:scccadmin "$app_root/artifacts/api-server" "$app_root/artifacts/it-reporting/dist"
    systemctl restart sccc-api.service || true
  fi
  exit "$status"
}
trap rollback ERR

[[ "$(id -u)" == "0" ]] || { echo "Run as root" >&2; exit 1; }
[[ -f "$archive" ]] || { echo "Missing archive: $archive" >&2; exit 1; }
echo "$expected_archive_sha  $archive" | sha256sum -c -
echo "$expected_network_source_sha  $network_source" | sha256sum -c -
echo "$expected_ui_source_sha  $ui_source" | sha256sum -c -
[[ ! -e "$catalog_source" ]] || { echo "Unexpected existing catalog source" >&2; exit 1; }

tar -xzf "$archive" -C "$work_dir"
[[ -f "$work_dir/api-dist/index.mjs" ]]
[[ -f "$work_dir/frontend-public/index.html" ]]
[[ -f "$work_dir/sources/api/network_nodes.ts" ]]
[[ -f "$work_dir/sources/api/building_diagnostics_catalog.ts" ]]
[[ -f "$work_dir/sources/frontend/buildings.tsx" ]]

mkdir -p "$backup_dir"
cp -a "$network_source" "$backup_dir/network_nodes.ts"
cp -a "$ui_source" "$backup_dir/buildings.tsx"
cp -a "$api_dist" "$backup_dir/api-dist"
cp -a "$ui_public" "$backup_dir/frontend-public"

cp -a "$work_dir/sources/api/network_nodes.ts" "$network_source"
cp -a "$work_dir/sources/api/building_diagnostics_catalog.ts" "$catalog_source"
cp -a "$work_dir/sources/frontend/buildings.tsx" "$ui_source"
cp -a "$work_dir/api-dist" "$app_root/artifacts/api-server/dist.new-${stamp}"
cp -a "$work_dir/frontend-public" "$app_root/artifacts/it-reporting/dist/public.new-${stamp}"
chown -R scccadmin:scccadmin "$network_source" "$catalog_source" "$ui_source" \
  "$app_root/artifacts/api-server/dist.new-${stamp}" \
  "$app_root/artifacts/it-reporting/dist/public.new-${stamp}"

mv "$api_dist" "$api_previous"
mv "$app_root/artifacts/api-server/dist.new-${stamp}" "$api_dist"
mv "$ui_public" "$ui_previous"
mv "$app_root/artifacts/it-reporting/dist/public.new-${stamp}" "$ui_public"
rollback_needed=1

systemctl restart sccc-api.service
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8080/api/healthz >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:8080/api/healthz
curl -fsS https://app-server2.centralus.cloudapp.azure.com/network/buildings >/dev/null
curl -fsS https://app-server2.centralus.cloudapp.azure.com/api/network/public/buildings \
  | python3 -c 'import json,sys; rows=json.load(sys.stdin); names={r["name"] for r in rows}; forbidden={"Azure (Hybrid-VNet)","Azure Connectivity (Objects)","Business","Campus Wide","Epworth ALC"}; assert not names & forbidden; assert "Industrial Technology Campus" in names'
grep -q "Former Epworth inventory remains" "$ui_public/assets/"*.js

rollback_needed=0
echo "DEPLOYED backup=$backup_dir"
