#!/usr/bin/env bash
set -euo pipefail

LIVE_ROOT=/home/scccadmin/apps/Network-Insight-Hub
CONFIG_ROOT=/etc/sccc-building-probes
DROPIN_ROOT=/etc/systemd/system/sccc-api.service.d
DROPIN_FILE="$DROPIN_ROOT/50-building-probes.conf"
API_ENV="$CONFIG_ROOT/api.env"
SIGNING_KEY="$CONFIG_ROOT/signing.pem"
EXPORT_TOKEN="$CONFIG_ROOT/export.token"
EXPORT_HASH="$CONFIG_ROOT/export.token.sha256"
EXPECTED_API_SHA256=4d24773db13b96f7f42fa7fb53e2a62792feef833c25b1bf9ebf75adffc1c375
ORIGIN=https://app-server2.centralus.cloudapp.azure.com
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_ROOT="/home/scccadmin/building-probe-phase2/$STAMP"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

actual_api_sha256="$(sha256sum "$LIVE_ROOT/artifacts/api-server/dist/index.mjs" | awk '{print $1}')"
if [[ "$actual_api_sha256" != "$EXPECTED_API_SHA256" ]]; then
  echo "Live API hash changed; refusing to alter configuration." >&2
  exit 1
fi

install -d -o root -g root -m 0700 "$BACKUP_ROOT"
install -d -o root -g scccadmin -m 0750 "$CONFIG_ROOT"
install -d -o root -g root -m 0755 "$DROPIN_ROOT"

for file in "$API_ENV" "$DROPIN_FILE" "$SIGNING_KEY" "$EXPORT_TOKEN" "$EXPORT_HASH"; do
  if [[ -e "$file" ]]; then
    cp -a "$file" "$BACKUP_ROOT/$(basename "$file").before"
  fi
done
systemctl cat sccc-api > "$BACKUP_ROOT/sccc-api.unit.before.txt"
systemctl show sccc-api -p ActiveState -p SubState -p MainPID -p NRestarts > "$BACKUP_ROOT/sccc-api.state.before.txt"

if [[ ! -e "$SIGNING_KEY" ]]; then
  tmp_key="$(mktemp "$CONFIG_ROOT/.signing.XXXXXX")"
  rm -f "$tmp_key"
  node "$LIVE_ROOT/artifacts/api-server/src/scripts/create_building_probe_key.mjs" "$tmp_key"
  chown root:scccadmin "$tmp_key"
  chmod 0640 "$tmp_key"
  mv "$tmp_key" "$SIGNING_KEY"
fi

if [[ ! -e "$EXPORT_TOKEN" ]]; then
  umask 077
  token="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  if [[ ! "$token" =~ ^[A-Za-z0-9_-]{43}$ ]]; then
    echo "Generated export token has an unexpected format." >&2
    exit 1
  fi
  printf '%s' "$token" > "$EXPORT_TOKEN"
  unset token
fi
chown root:root "$EXPORT_TOKEN"
chmod 0600 "$EXPORT_TOKEN"
sha256sum "$EXPORT_TOKEN" | awk '{print $1}' > "$EXPORT_HASH"
chown root:scccadmin "$EXPORT_HASH"
chmod 0640 "$EXPORT_HASH"

tmp_env="$(mktemp "$CONFIG_ROOT/.api.env.XXXXXX")"
cat > "$tmp_env" <<EOF
BUILDING_PROBES_ENABLED=true
BUILDING_PROBE_SCHEDULER_ENABLED=false
BUILDING_PROBE_THROUGHPUT_TARGET_READY=false
BUILDING_PROBE_CAPACITY_ENABLED=false
BUILDING_PROBE_SIGNING_KEY_FILE=$SIGNING_KEY
BUILDING_PROBE_EXPORT_TOKEN_HASH_FILE=$EXPORT_HASH
BUILDING_PROBE_PUBLIC_ORIGIN=$ORIGIN
BUILDING_PROBE_QUICK_CONCURRENCY=4
BUILDING_PROBE_HOURLY_CONCURRENCY=1
BUILDING_PROBE_CAPACITY_CONCURRENCY=1
EOF
chown root:root "$tmp_env"
chmod 0600 "$tmp_env"
mv "$tmp_env" "$API_ENV"

tmp_dropin="$(mktemp "$DROPIN_ROOT/.building-probes.XXXXXX")"
cat > "$tmp_dropin" <<EOF
[Service]
EnvironmentFile=$API_ENV
EOF
chown root:root "$tmp_dropin"
chmod 0644 "$tmp_dropin"
mv "$tmp_dropin" "$DROPIN_FILE"

systemctl daemon-reload
systemctl restart sccc-api

for _ in $(seq 1 30); do
  if systemctl is-active --quiet sccc-api && curl -fsS -o /dev/null "$ORIGIN/api/healthz"; then
    break
  fi
  sleep 1
done
systemctl is-active --quiet sccc-api

status="$(curl -sS -o /dev/null -w '%{http_code}' "$ORIGIN/api/building-probes/agent/ping")"
[[ "$status" == "400" ]] || { echo "Feature readiness check returned HTTP $status, expected 400." >&2; exit 1; }

export_status="$(curl -sS -o "$BACKUP_ROOT/initial-export.json" -w '%{http_code}' \
  -H "Authorization: Bearer $(cat "$EXPORT_TOKEN")" \
  "$ORIGIN/api/building-probes/results/export?recent=true&limit=1")"
[[ "$export_status" == "200" ]] || { echo "Authenticated export check returned HTTP $export_status." >&2; exit 1; }
node -e 'const fs=require("fs");const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const k of ["results","health","metrics","capacityWindows","capacityMetrics","healthMetrics"])if(!Array.isArray(x[k]))throw new Error(`missing ${k}`)' "$BACKUP_ROOT/initial-export.json"

table_count="$(sudo -u postgres psql -d sccc_it -Atqc "select count(*) from information_schema.tables where table_schema='public' and table_name in ('building_probe_buildings','building_probes','building_probe_jobs','building_probe_slots','building_probe_campus_lease','building_probe_result_exports');" 2>/dev/null || true)"
if [[ -n "$table_count" && "$table_count" != "6" ]]; then
  echo "Expected six Building Probe tables; found $table_count." >&2
  exit 1
fi

systemctl show sccc-api -p ActiveState -p SubState -p MainPID -p NRestarts --no-pager
echo "PHASE2_BASE_STATUS=verified"
echo "SCHEDULER_ENABLED=false"
echo "THROUGHPUT_TARGET_READY=false"
echo "CAPACITY_ENABLED=false"
echo "BACKUP_ROOT=$BACKUP_ROOT"
