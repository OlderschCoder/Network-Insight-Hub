#!/usr/bin/env bash
set -euo pipefail

archive="${1:-/tmp/fred-building-average-20261029.tgz}"
expected_archive_sha="${2:-b5e7315fab0ba5a012fb68909d619670b4d17ef4ac0a37df419681296d066fac}"
app_root="/home/scccadmin/apps/Network-Insight-Hub"
api_source="$app_root/artifacts/api-server/src/lib/building_performance.ts"
ui_source="$app_root/artifacts/it-reporting/src/pages/network/buildings.tsx"
api_dist="$app_root/artifacts/api-server/dist"
ui_public="$app_root/artifacts/it-reporting/dist/public"
expected_api_source_sha="4bae0f30a7e364c014f8b450889b616c8f3b51164b5bedcfd8ad3b5f5bb6e7ed"
expected_ui_source_sha="b8afabd8f8723afd79399c944700b47a76880689b290b2197c5fee2e47e1a96f"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work_dir="$(mktemp -d /tmp/fred-building-average.XXXXXX)"
backup_dir="$app_root/.release-backups/${stamp}-building-average"
api_previous="$app_root/artifacts/api-server/dist.previous-${stamp}"
ui_previous="$app_root/artifacts/it-reporting/dist/public.previous-${stamp}"
rollback_needed=0

rollback() {
  status=$?
  if [[ "$rollback_needed" == "1" ]]; then
    cp -a "$backup_dir/building_performance.ts" "$api_source"
    cp -a "$backup_dir/buildings.tsx" "$ui_source"
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
echo "$expected_api_source_sha  $api_source" | sha256sum -c -
echo "$expected_ui_source_sha  $ui_source" | sha256sum -c -

tar -xzf "$archive" -C "$work_dir"
[[ -f "$work_dir/api-dist/index.mjs" ]]
[[ -f "$work_dir/frontend-public/index.html" ]]
[[ -f "$work_dir/sources/api/building_performance.ts" ]]
[[ -f "$work_dir/sources/frontend/buildings.tsx" ]]

mkdir -p "$backup_dir"
cp -a "$api_source" "$backup_dir/building_performance.ts"
cp -a "$ui_source" "$backup_dir/buildings.tsx"
cp -a "$api_dist" "$backup_dir/api-dist"
cp -a "$ui_public" "$backup_dir/frontend-public"

cp -a "$work_dir/sources/api/building_performance.ts" "$api_source"
cp -a "$work_dir/sources/frontend/buildings.tsx" "$ui_source"
cp -a "$work_dir/api-dist" "$app_root/artifacts/api-server/dist.new-${stamp}"
cp -a "$work_dir/frontend-public" "$app_root/artifacts/it-reporting/dist/public.new-${stamp}"
chown -R scccadmin:scccadmin "$api_source" "$ui_source" \
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
grep -q "Recent endpoint speed average" "$ui_public/assets/"*.js

rollback_needed=0
echo "DEPLOYED backup=$backup_dir"
