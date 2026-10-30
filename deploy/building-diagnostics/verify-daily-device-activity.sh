#!/usr/bin/env bash
# Read back the live daily Ethernet/Wi-Fi measurement series from private InfluxDB.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with the normal privileged NOC operator.' >&2; exit 1; }
env_file=/etc/sccc-building-diagnostics/worker.env
[[ -f "$env_file" && ! -L "$env_file" ]] || { echo 'Private worker environment is unavailable.' >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$env_file"
set +a
for name in INFLUX_URL INFLUX_TOKEN INFLUX_ORG INFLUX_BUCKET; do
  [[ -n "${!name:-}" ]] || { echo "Missing $name" >&2; exit 1; }
done

read -r -d '' flux <<EOF || true
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -7d)
  |> filter(fn: (r) => r._measurement == "sccc_device_performance" and r.type == "librespeed-v2" and r.method == "MultiStreamV2" and r._field == "measurement_ok" and r._value == true)
  |> group(columns: ["report_id", "adapter"])
  |> last()
  |> group(columns: ["adapter"])
  |> aggregateWindow(every: 1d, fn: count, createEmpty: false)
  |> keep(columns: ["_time", "adapter", "_value"])
EOF
influx query --raw --host "$INFLUX_URL" --token "$INFLUX_TOKEN" --org "$INFLUX_ORG" "$flux"
