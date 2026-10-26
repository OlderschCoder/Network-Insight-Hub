#!/usr/bin/env bash
# Narrow update of the deployed pilot. No policy, environment or job changes.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with the normal privileged deployment account.' >&2; exit 1; }
candidate="$(realpath "${1:?Usage: apply-device-performance-update.sh /absolute/reviewed/build}")"
live=/home/scccadmin/apps/Network-Insight-Hub
[[ -d "$live" && "$candidate" != "$live" ]] || exit 1
new_asset=artifacts/it-reporting/dist/public/assets/index-DZuAKmZF.js
existing=(artifacts/api-server/src/routes/auth.ts artifacts/it-reporting/src/pages/login.tsx artifacts/it-reporting/src/lib/diagnosticsEntry.ts artifacts/api-server/src/routes/building_diagnostics.ts artifacts/api-server/src/lib/building_diagnostics_store.ts artifacts/api-server/dist/index.mjs artifacts/api-server/dist/index.mjs.map artifacts/it-reporting/dist/public/index.html)
verify_payload() {
  (cd -- "$1" && sha256sum --check <<'PAYLOAD'
8d8b0f11693da671a9f8196464e51c1fbb6bab0b185a26feee7cf6fc7b7c8288  artifacts/api-server/src/routes/auth.ts
fa0c16b908dbe933e9105d91e1d9c82e7771b1a8075c2d446cbab433d55d9381  artifacts/it-reporting/src/pages/login.tsx
67ade27dac1e3eb54d5f97598f4f7ac597094bdde29ee7c27867421f73bbf34d  artifacts/it-reporting/src/lib/diagnosticsEntry.ts
eec9c03d776a99970d6ebfc3aac779da4b68fbacbd800ab458d2fd53a9cc63f7  artifacts/api-server/src/routes/building_diagnostics.ts
a3b2f4ea0e320675be50e8e69e72f18b2dd28be392a2ddfa8ec31b6945bc93c6  artifacts/api-server/src/lib/building_diagnostics_store.ts
a0a2d557302a92a216e91127a8ee1f1d51a205d77b54aea1867f9fd35e7086e6  artifacts/api-server/dist/index.mjs
0c632ba2d148e7ea81a6db0e68631135237d75faa444970678daa9f47c26966d  artifacts/api-server/dist/index.mjs.map
eaf6c367b0d934a9c4ec170591d93812298c5537c35724a0bd96b897350eac29  artifacts/it-reporting/dist/public/index.html
fb0488a02822d114ecc1bdfb87e947c1aae2a40e854d589b95764b692d7752cd  artifacts/it-reporting/dist/public/assets/index-DZuAKmZF.js
PAYLOAD
  )
}
verify_flags() {
  python3 - <<'PY'
from pathlib import Path
import subprocess
pid = subprocess.check_output(["systemctl", "show", "sccc-api", "-p", "MainPID", "--value"], text=True).strip()
if not pid.isdigit() or pid == "0":
    raise SystemExit("API process is not running")
wanted = {b"BUILDING_DIAGNOSTICS_ENABLED", b"BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED"}
values = {key.decode(): value.decode() for item in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0") if b"=" in item for key, value in [item.split(b"=", 1)] if key in wanted}
if values.get("BUILDING_DIAGNOSTICS_ENABLED") != "true" or values.get("BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED", "false") != "false":
    raise SystemExit("Pilot flags changed; reconcile before continuing")
print("Pilot flags verified: reporting enabled, automatic scheduler disabled")
PY
}
verify_payload "$candidate"
node --check "$candidate/artifacts/api-server/dist/index.mjs"
cd -- "$live"
sha256sum --check <<'BASELINE'
de7d9a7c71bdf8c0980d07402c68d523fe5a1ee46f09199ae3196057b0c39ff7  artifacts/api-server/src/routes/auth.ts
0f7894bf2c0613fba7f2894a0bb1ec783baefbf414cf632d1483b629994724da  artifacts/it-reporting/src/pages/login.tsx
a790ccdd88db1f3aaea0fe1c9b3a6635f412c242aa05ed8b7341d55185bf1df6  artifacts/it-reporting/src/lib/diagnosticsEntry.ts
caac57703199b6255d58d221911659818dcb1946cb962c69a3a99b9152bf3406  artifacts/api-server/src/routes/building_diagnostics.ts
e99361e26820f88d38b734893e370139b7acc6c236ab5b1a1889d395cc3c7cc8  artifacts/api-server/src/lib/building_diagnostics_store.ts
d63131271f4d8f0db18c6453c5f24e46965204da099b2cef3b77f677546d4c3c  artifacts/api-server/dist/index.mjs
b7084e833778dde78321b3474d6862cb1609a61655ddb8a3e5537beeb5ea17ea  artifacts/api-server/dist/index.mjs.map
a2f55f9a465f602587cc25a22dda453e599901d5b0657d69f1fdde3d5f767edc  artifacts/it-reporting/dist/public/index.html
BASELINE
systemctl is-active --quiet sccc-api
verify_flags
asset_preexisting=false
if [[ -e "$live/$new_asset" ]]; then
  cmp -- "$candidate/$new_asset" "$live/$new_asset"
  asset_preexisting=true
fi
mkdir -p /home/scccadmin/backups
backup="$(mktemp -d /home/scccadmin/backups/fred-device-performance-XXXXXXXX)"
tar -czf "$backup/prior-files.tar.gz" "${existing[@]}"
sha256sum "${existing[@]}" > "$backup/prior.sha256"
completed=false
rollback() {
  result=$?
  trap - EXIT
  if [[ "$completed" != true ]]; then
    tar -xzf "$backup/prior-files.tar.gz" -C "$live"
    if [[ "$asset_preexisting" != true ]]; then rm -f -- "$live/$new_asset"; fi
    systemctl restart sccc-api || true
    echo "Update failed; prior files restored from $backup. Verify service health." >&2
  fi
  exit "$result"
}
trap rollback EXIT
# Existing assets are retained, including the old entrypoint's immutable JS.
install -o scccadmin -g scccadmin -m 0644 -- "$candidate/$new_asset" "$live/$new_asset"
for file in "${existing[@]}"; do
  install -o scccadmin -g scccadmin -m 0644 -- "$candidate/$file" "$live/$file"
done
systemctl restart sccc-api
for attempt in {1..10}; do
  if curl -fsS --connect-timeout 2 --max-time 2 http://127.0.0.1:8080/api/healthz >/dev/null; then break; fi
  sleep 1
done
systemctl is-active --quiet sccc-api
curl -fsS --max-time 10 https://insights.sccc.edu/api/healthz >/dev/null
curl -fsS --max-time 10 https://insights.sccc.edu/api/auth/entra/status | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data["configured"] is True; assert data["loginOrigin"] == "https://app-server2.centralus.cloudapp.azure.com"'
[[ "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://insights.sccc.edu/api/building-diagnostics/overview)" == 401 ]]
worker_status="$(curl -sS --max-time 10 -o "$backup/anonymous-reporting-status.json" -w '%{http_code}' https://insights.sccc.edu/api/building-diagnostics/reporting-snapshot)"
[[ "$worker_status" == 401 ]]
python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["error"] == "Diagnostics worker authentication required"' "$backup/anonymous-reporting-status.json"
curl -fsS --max-time 10 'https://insights.sccc.edu/network/diagnostics?sso=1' | python3 -c 'import sys; assert "/assets/index-DZuAKmZF.js" in sys.stdin.read()'
verify_flags
verify_payload "$live"
completed=true
printf 'Device performance update applied. Backup: %s\n' "$backup"
echo 'Health, registered SSO origin, anonymous network/worker restrictions, pilot flags and all nine file hashes verified. No alert, measurement, credential or policy action was requested.'
