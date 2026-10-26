#!/usr/bin/env bash
set -euo pipefail

LIVE_ROOT=/home/scccadmin/apps/Network-Insight-Hub
SOURCE_REL=artifacts/it-reporting/src/pages/network/building-probes.tsx
DIST_REL=artifacts/it-reporting/dist/public
STAGED_SOURCE=/home/scccadmin/building-probe-phase2-staging/building-probes.tsx
EXPECTED_OLD=cbb828a0c47a33bcd79f0d25490850f2e2caebef93a0c18c1b8e24b54de8f078
EXPECTED_NEW=f82eaa226211fae2869d62581110732349b8005b7d9ba20533eba17406f733ca
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP=/home/scccadmin/building-probe-phase2-staging/backups/ui-$STAMP

test "$(sha256sum "$LIVE_ROOT/$SOURCE_REL" | awk '{print $1}')" = "$EXPECTED_OLD"
test "$(sha256sum "$STAGED_SOURCE" | awk '{print $1}')" = "$EXPECTED_NEW"
mkdir -p "$BACKUP"
sudo cp -a "$LIVE_ROOT/$SOURCE_REL" "$BACKUP/building-probes.tsx.before"
tar -C "$LIVE_ROOT/$DIST_REL" -czf "$BACKUP/frontend.before.tgz" .
sha256sum "$LIVE_ROOT/$DIST_REL/index.html" > "$BACKUP/index.before.sha256"

rollback() {
  sudo cp -a "$BACKUP/building-probes.tsx.before" "$LIVE_ROOT/$SOURCE_REL"
  rm -rf "$LIVE_ROOT/$DIST_REL"
  mkdir -p "$LIVE_ROOT/$DIST_REL"
  tar -C "$LIVE_ROOT/$DIST_REL" -xzf "$BACKUP/frontend.before.tgz"
}
trap 'rollback' ERR

sudo install -o root -g root -m 0644 "$STAGED_SOURCE" "$LIVE_ROOT/$SOURCE_REL"
cd "$LIVE_ROOT"
BASE_PATH=/ pnpm --filter @workspace/it-reporting run build
if [[ "$(id -u)" -eq 0 ]]; then
  chown -R scccadmin:scccadmin "$LIVE_ROOT/$DIST_REL"
fi
test "$(sha256sum "$LIVE_ROOT/$SOURCE_REL" | awk '{print $1}')" = "$EXPECTED_NEW"
test -s "$LIVE_ROOT/$DIST_REL/index.html"
index_url="https://app-server2.centralus.cloudapp.azure.com/network/building-probes?phase2=$STAMP"
test "$(curl -sS -o "$BACKUP/live.html" -w '%{http_code}' "$index_url")" = 200
asset="$(grep -oE '/assets/index-[^\" ]+\.js' "$BACKUP/live.html" | head -n1)"
test -n "$asset"
curl -fsS "https://app-server2.centralus.cloudapp.azure.com$asset" -o "$BACKUP/live.js"
grep -q 'Building computers' "$BACKUP/live.js"
sha256sum "$LIVE_ROOT/$DIST_REL/index.html" > "$BACKUP/index.after.sha256"
trap - ERR
printf 'deployed=%s\nbackup=%s\nasset=%s\n' "$EXPECTED_NEW" "$BACKUP" "$asset"
