#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR=${1:-/tmp/sccc-wireless-metrics}
MM_ENV_FILE=${2:-/tmp/sccc-wireless-mm.env}
STACK_ENV=/home/ITADMIN/sccc-ops/.env
TELEGRAF_CONFIG=/home/ITADMIN/sccc-ops/telegraf/telegraf.conf
INSTALL_DIR=/opt/sccc-wireless-metrics
CONFIG_FILE=/etc/sccc-wireless-metrics.env

[[ -r "$SOURCE_DIR/wireless_metrics_collector.py" ]] || { echo "collector source is missing" >&2; exit 2; }
[[ -r "$MM_ENV_FILE" ]] || { echo "Mobility Master credential file is missing" >&2; exit 2; }
[[ -r "$STACK_ENV" ]] || { echo "existing NOC stack environment is missing" >&2; exit 2; }
[[ -r "$TELEGRAF_CONFIG" ]] || { echo "existing Telegraf configuration is missing" >&2; exit 2; }

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
[[ ! -d "$INSTALL_DIR" ]] || cp -a "$INSTALL_DIR" "${INSTALL_DIR}.backup-${timestamp}"
[[ ! -f "$CONFIG_FILE" ]] || cp -a "$CONFIG_FILE" "${CONFIG_FILE}.backup-${timestamp}"

install -d -o root -g root -m 0755 "$INSTALL_DIR"
install -o root -g root -m 0755 "$SOURCE_DIR/wireless_metrics_collector.py" "$INSTALL_DIR/"
install -o root -g root -m 0644 "$SOURCE_DIR/Dockerfile.wireless-metrics" "$INSTALL_DIR/"
docker build -f "$INSTALL_DIR/Dockerfile.wireless-metrics" -t sccc-wireless-metrics:1.0 "$INSTALL_DIR"

install -d -o root -g root -m 0700 /etc/sccc-wireless-metrics
ssh-keyscan -T 5 aruba-mm.sccc.edu > /etc/sccc-wireless-metrics/known_hosts
chmod 0600 /etc/sccc-wireless-metrics/known_hosts

set -a
# shellcheck disable=SC1090
source "$MM_ENV_FILE"
# shellcheck disable=SC1090
source "$STACK_ENV"
set +a
: "${MM_USER:?MM_USER missing}"
: "${MM_PASSWORD:?MM_PASSWORD missing}"
LIVE_INFLUX_TOKEN=$(sed -n -E 's/^[[:space:]]*token[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$TELEGRAF_CONFIG" | head -1)
LIVE_INFLUX_ORG=$(sed -n -E 's/^[[:space:]]*organization[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$TELEGRAF_CONFIG" | head -1)
LIVE_INFLUX_BUCKET=$(sed -n -E 's/^[[:space:]]*bucket[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$TELEGRAF_CONFIG" | head -1)
: "${LIVE_INFLUX_TOKEN:?live Telegraf Influx token missing}"
: "${LIVE_INFLUX_ORG:?live Telegraf Influx organization missing}"
: "${LIVE_INFLUX_BUCKET:?live Telegraf Influx bucket missing}"
token_status=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Token $LIVE_INFLUX_TOKEN" http://127.0.0.1:8086/api/v2/buckets)
[[ "$token_status" == "200" ]] || { echo "live Telegraf token validation failed" >&2; exit 3; }

umask 077
{
  printf 'MM_HOST=%s\n' 'aruba-mm.sccc.edu'
  printf 'MM_PORT=%s\n' '22'
  printf 'MM_USER=%s\n' "$MM_USER"
  printf 'MM_PASSWORD=%s\n' "$MM_PASSWORD"
  printf 'MM_KNOWN_HOSTS=%s\n' '/etc/sccc-wireless-metrics/known_hosts'
  printf 'INFLUX_URL=%s\n' 'http://127.0.0.1:8086'
  printf 'INFLUX_TOKEN=%s\n' "$LIVE_INFLUX_TOKEN"
  printf 'INFLUX_ORG=%s\n' "$LIVE_INFLUX_ORG"
  printf 'INFLUX_BUCKET=%s\n' "$LIVE_INFLUX_BUCKET"
  printf 'WIRELESS_STATE_FILE=%s\n' '/var/lib/sccc-wireless-metrics/state.json'
} > "$CONFIG_FILE"
chown root:root "$CONFIG_FILE"
chmod 0600 "$CONFIG_FILE"
shred -u "$MM_ENV_FILE" 2>/dev/null || rm -f "$MM_ENV_FILE"

install -o root -g root -m 0644 "$SOURCE_DIR/sccc-wireless-metrics.service" /etc/systemd/system/
install -o root -g root -m 0644 "$SOURCE_DIR/sccc-wireless-metrics.timer" /etc/systemd/system/
systemctl daemon-reload

docker run --rm --network host --env-file "$CONFIG_FILE" \
  -v /etc/sccc-wireless-metrics/known_hosts:/etc/sccc-wireless-metrics/known_hosts:ro \
  -v /var/lib/sccc-wireless-metrics:/var/lib/sccc-wireless-metrics \
  sccc-wireless-metrics:1.0 --dry-run \
  | grep -q '^aruba_wireless_summary,'

systemctl start sccc-wireless-metrics.service
systemctl enable --now sccc-wireless-metrics.timer
systemctl is-active sccc-wireless-metrics.timer
systemctl show sccc-wireless-metrics.service -p Result -p ExecMainStatus

provider_dir=/home/ITADMIN/sccc-ops/provisioning/dashboards
dashboard_dir=/home/ITADMIN/sccc-ops/grafana-new/dashboards
provider_file="$provider_dir/sccc-wireless.yml"
dashboard_file="$dashboard_dir/sccc-wireless-overview.json"
install -d -o ITADMIN -g ITADMIN -m 0755 "$provider_dir" "$dashboard_dir"
grafana_changed=0
if ! cmp -s "$SOURCE_DIR/grafana-wireless-provider.yml" "$provider_file"; then
  [[ ! -f "$provider_file" ]] || cp -a "$provider_file" "${provider_file}.backup-${timestamp}"
  install -o ITADMIN -g ITADMIN -m 0644 "$SOURCE_DIR/grafana-wireless-provider.yml" "$provider_file"
  grafana_changed=1
fi
if ! cmp -s "$SOURCE_DIR/grafana-wireless-dashboard.json" "$dashboard_file"; then
  [[ ! -f "$dashboard_file" ]] || cp -a "$dashboard_file" "${dashboard_file}.backup-${timestamp}"
  install -o ITADMIN -g ITADMIN -m 0644 "$SOURCE_DIR/grafana-wireless-dashboard.json" "$dashboard_file"
  grafana_changed=1
fi
if [[ "$grafana_changed" == "1" ]]; then
  docker restart grafana >/dev/null
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
      break
    fi
    sleep 1
  done
  curl -fsS http://127.0.0.1:3000/api/health >/dev/null
fi
