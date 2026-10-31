#!/usr/bin/env bash
set -euo pipefail

root=/home/scccadmin/apps/Network-Insight-Hub
stamp=$(TZ=America/Chicago date +%Y%m%d-%H%M)
cutoff=$(TZ=America/Chicago date --date='+110 minutes' --iso-8601=seconds)
report_dir=/home/scccadmin/daytime-speed/${stamp}

exec /usr/bin/node \
  "${root}/deploy/building-diagnostics/overnight-librespeed-sweep.cjs" \
  --campaign "daytime-librespeed-${stamp}" \
  --cutoff "${cutoff}" \
  --report-dir "${report_dir}" \
  --interval-seconds 60 \
  --pending-target 4 \
  --per-building 5
