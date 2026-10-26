#!/usr/bin/env bash
# Deploy only the reviewed diagnostics feature and built artifacts. No activation.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run with the normal privileged deployment account.' >&2; exit 1; }
live=/home/scccadmin/apps/Network-Insight-Hub
candidate=$(realpath "${1:?Usage: deploy-fred.sh /absolute/reviewed/build}")
[[ -d "$live" && "$candidate" != "$live" && -f "$candidate/deploy/building-diagnostics/live-baseline.sha256" ]] || exit 1
cd "$live"
sha256sum --check "$candidate/deploy/building-diagnostics/live-baseline.sha256"
mapfile -t source_files < <(tr -d '\r' < "$candidate/deploy/building-diagnostics/deploy-source-files.txt")
for path in "${source_files[@]}"; do
  [[ "$path" != /* && "$path" != *..* && -f "$candidate/$path" ]] || exit 1
  # New modules may not overwrite another intervening deployment.
  if [[ "$path" == *building_diagnostics* || "$path" == *building-diagnostics.tsx || "$path" == *diagnosticsEntry.ts ]]; then
    [[ ! -e "$live/$path" ]] || { echo "New feature file already exists: $path" >&2; exit 1; }
  fi
done
[[ -f "$candidate/artifacts/api-server/dist/index.mjs" && -f "$candidate/artifacts/it-reporting/dist/public/index.html" ]] || exit 1
systemctl is-active --quiet sccc-api
# Do not activate load tests during a source deployment. These variables must be
# absent/false in the existing service environment; operator reviews that file.
if systemctl show sccc-api --property=Environment --value | grep -Eq 'BUILDING_DIAGNOSTICS_(ENABLED|SCHEDULER_ENABLED)=true'; then
  echo 'Disable diagnostics activation flags before the initial deployment.' >&2; exit 1
fi
python3 - <<'PY'
import pathlib, re, subprocess
value = subprocess.check_output(["systemctl", "show", "sccc-api", "--property=EnvironmentFiles", "--value"], text=True)
for path in re.findall(r'(\S+) \(ignore_errors=(?:yes|no)\)', value):
    file = pathlib.Path(path)
    if not file.exists():
        continue
    for line in file.read_text().splitlines():
        match = re.match(r'\s*(BUILDING_DIAGNOSTICS_(?:ENABLED|SCHEDULER_ENABLED))\s*=\s*(.*?)\s*$', line)
        if match and match[2].strip("\"'") == "true":
            raise SystemExit("Disable diagnostics activation flags in the service environment before deployment.")
PY
backup=/home/scccadmin/fred-diagnostics-backup-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -m 700 "$backup"
existing=()
for path in "${source_files[@]}"; do [[ ! -e "$path" ]] || existing+=("$path"); done
tar -czf "$backup/source.tgz" "${existing[@]}"
cp -a artifacts/api-server/dist "$backup/api-dist"
cp -a artifacts/it-reporting/dist/public "$backup/public"
printf '%s\n' "${source_files[@]}" > "$backup/source-files.txt"
printf '%s\n' "${existing[@]}" > "$backup/existing-source-files.txt"
printf '%s\n' "$backup" > "$candidate/deploy/building-diagnostics/last-backup-path.txt"

restore() {
  echo "Deployment failed; restoring built artifacts from $backup" >&2
  cp -a "$backup/api-dist/." "$live/artifacts/api-server/dist/"
  # Restore the old entrypoint without deleting unrelated public files/assets.
  cp -a "$backup/public/." "$live/artifacts/it-reporting/dist/public/"
  tar -xzf "$backup/source.tgz" -C "$live"
  for path in "${source_files[@]}"; do
    if ! grep -Fxq -- "$path" "$backup/existing-source-files.txt"; then rm -f -- "$live/$path"; fi
  done
  systemctl restart sccc-api || true
}
trap restore ERR
for path in "${source_files[@]}"; do
  install -D -m 644 "$candidate/$path" "$live/$path"
done
cp -a "$candidate/artifacts/api-server/dist/." artifacts/api-server/dist/
# Publish assets before index.html; preserve unrelated public files.
cp -a "$candidate/artifacts/it-reporting/dist/public/assets/." artifacts/it-reporting/dist/public/assets/
install -m 644 "$candidate/artifacts/it-reporting/dist/public/index.html" artifacts/it-reporting/dist/public/index.html
systemctl restart sccc-api
for attempt in {1..15}; do
  if curl --fail --silent --connect-timeout 2 --max-time 3 http://127.0.0.1:8080/api/healthz >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8080/api/healthz >/dev/null
status=$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/api/building-diagnostics/overview)
[[ "$status" == 401 ]] || { echo "Unexpected anonymous diagnostics status: $status" >&2; exit 1; }
systemctl is-active --quiet sccc-api
trap - ERR
printf 'Diagnostics code deployed with no fleet activation. Backup: %s\n' "$backup"
echo 'Sign in to https://insights.sccc.edu/network/diagnostics and confirm staged status.'
