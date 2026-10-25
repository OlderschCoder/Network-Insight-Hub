#!/usr/bin/env bash
set -Eeuo pipefail
umask 0077

readonly APP_ROOT="${TELEMETRY_APP_ROOT:-/opt/sccc-switch-telemetry}"
readonly STATE_ROOT="${TELEMETRY_STATE_ROOT:-/var/lib/sccc-switch-telemetry}"
readonly LOCK_FILE="${TELEMETRY_LOCK_FILE:-/var/lib/sccc-switch-telemetry-lock/run.lock}"
readonly RUNS_ROOT="$STATE_ROOT/runs"
readonly STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
readonly DEFAULT_IMPORT_URL="https://app-server2.centralus.cloudapp.azure.com/api/network-map/import/telemetry/switch"
readonly IMPORT_URL="${TELEMETRY_IMPORT_URL:-$DEFAULT_IMPORT_URL}"

RUN_NAME=""
RUN_DIR=""
STAGE="initializing"
LATEST_CANDIDATE=""

die() {
  printf 'ERROR: %s\n' "$1" >&2
  return "${2:-1}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1" 69
}

write_status() {
  local state="$1"
  local finished_at="${2:-}"
  local message="${3:-}"
  local collection_run_id="${4:-}"
  local switches_ok="${5:-null}"
  local imports_applied="${6:-null}"
  local switches_failed="${7:-null}"
  local firewalls_ok="${8:-null}"
  local firewalls_failed="${9:-null}"
  local temporary="$STATE_ROOT/.status.json.$$"

  jq -n \
    --arg schema 'sccc.network.switchport_telemetry.status.v1' \
    --arg state "$state" \
    --arg release "${APP##*/}" \
    --arg runId "$RUN_NAME" \
    --arg collectionRunId "$collection_run_id" \
    --arg stage "$STAGE" \
    --arg startedAt "$STARTED_AT" \
    --arg finishedAt "$finished_at" \
    --arg message "$message" \
    --argjson expectedTargets "$EXPECTED_TARGET_COUNT" \
    --argjson switchesOk "$switches_ok" \
    --argjson switchesFailed "$switches_failed" \
    --argjson firewallsOk "$firewalls_ok" \
    --argjson firewallsFailed "$firewalls_failed" \
    --argjson importsApplied "$imports_applied" \
    '{
      schema: $schema,
      state: $state,
      release: $release,
      run_id: (if $runId == "" then null else $runId end),
      collection_run_id: (if $collectionRunId == "" then null else $collectionRunId end),
      stage: $stage,
      started_at: $startedAt,
      finished_at: (if $finishedAt == "" then null else $finishedAt end),
      expected_targets: $expectedTargets,
      switches_ok: $switchesOk,
      switches_failed: $switchesFailed,
      firewalls_ok: $firewallsOk,
      firewalls_failed: $firewallsFailed,
      imports_applied: $importsApplied,
      message: (if $message == "" then null else $message end)
    }' >"$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$STATE_ROOT/status.json"
}

on_error() {
  local code=$?
  local line="${BASH_LINENO[0]:-unknown}"
  trap - ERR TERM INT
  set +e
  [[ -z "$LATEST_CANDIDATE" ]] || rm -f -- "$LATEST_CANDIDATE"
  write_status \
    'failed' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "Telemetry stopped during $STAGE (exit $code, line $line). The previous latest run was preserved."
  exit "$code"
}

on_termination() {
  trap - ERR TERM INT
  set +e
  [[ -z "$LATEST_CANDIDATE" ]] || rm -f -- "$LATEST_CANDIDATE"
  write_status \
    'cancelled' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "Telemetry was stopped during $STAGE. The previous latest run was preserved."
  exit 143
}

for command_name in date flock jq readlink tee; do
  require_command "$command_name"
done

[[ "$APP_ROOT" == /* ]] || die 'TELEMETRY_APP_ROOT must be an absolute path' 64
[[ "$STATE_ROOT" == /* ]] || die 'TELEMETRY_STATE_ROOT must be an absolute path' 64
[[ "$LOCK_FILE" == /* ]] || die 'TELEMETRY_LOCK_FILE must be an absolute path' 64
[[ "$IMPORT_URL" == https://* ]] || die 'TELEMETRY_IMPORT_URL must use HTTPS' 78
[[ -L "$APP_ROOT/current" ]] || die "$APP_ROOT/current is not a release symlink" 66
APP="$(readlink -f -- "$APP_ROOT/current")"
case "$APP" in
  "$APP_ROOT"/releases/*) ;;
  *) die "active release resolves outside $APP_ROOT/releases" 66 ;;
esac

PYTHON="$APP/.venv/bin/python"
COLLECTOR="$APP/collect_switch_ports.py"
AUDITOR="$APP/audit_switch_telemetry.py"
PUBLISHER="$APP/publish_switch_telemetry.py"
FIREWALL_CHECKER="$APP/check_firewall_telemetry.py"
MANIFEST="${TELEMETRY_MANIFEST_FILE:-$APP/switches.csv}"
REQUIRED_TARGETS="${TELEMETRY_REQUIRED_TARGETS_FILE:-$APP/required-targets.txt}"
DEVICE_CATALOG="${TELEMETRY_DEVICE_CATALOG_FILE:-$APP/device-catalog.csv}"

if [[ -r "$APP/expected-target-count" ]]; then
  release_expected_count="$(tr -d '[:space:]' <"$APP/expected-target-count")"
else
  release_expected_count=49
fi
EXPECTED_TARGET_COUNT="${TELEMETRY_EXPECTED_TARGET_COUNT:-$release_expected_count}"
[[ "$EXPECTED_TARGET_COUNT" =~ ^[1-9][0-9]*$ ]] || die 'expected target count must be a positive integer' 64
EXPECTED_CATALOG_COUNT="${TELEMETRY_EXPECTED_CATALOG_COUNT:-51}"
EXPECTED_FIREWALL_COUNT="${TELEMETRY_EXPECTED_FIREWALL_COUNT:-2}"
[[ "$EXPECTED_CATALOG_COUNT" =~ ^[1-9][0-9]*$ ]] || die 'expected catalog count must be a positive integer' 64
[[ "$EXPECTED_FIREWALL_COUNT" =~ ^[1-9][0-9]*$ ]] || die 'expected firewall count must be a positive integer' 64
[[ "$EXPECTED_TARGET_COUNT" == 49 ]] || die 'the approved production switch scope is exactly 49 targets' 78
[[ "$EXPECTED_CATALOG_COUNT" == 51 ]] || die 'the approved production catalog scope is exactly 51 devices' 78
[[ "$EXPECTED_FIREWALL_COUNT" == 2 ]] || die 'the approved production firewall scope is exactly 2 devices' 78

for required_file in "$COLLECTOR" "$AUDITOR" "$PUBLISHER" "$FIREWALL_CHECKER" "$MANIFEST" "$REQUIRED_TARGETS" "$DEVICE_CATALOG"; do
  [[ -f "$required_file" && ! -L "$required_file" ]] || die "required release file is missing or unsafe: $required_file" 66
done
[[ -x "$PYTHON" ]] || die "release Python is not executable: $PYTHON" 66

mkdir -p -- "$STATE_ROOT" "$RUNS_ROOT"
chmod 0700 "$STATE_ROOT" "$RUNS_ROOT"
[[ -f "$LOCK_FILE" && ! -L "$LOCK_FILE" ]] || die 'shared run lock must be a regular, non-symlink file' 77
exec 9>>"$LOCK_FILE"
if ! flock -n 9; then
  die 'another approved telemetry collection or deployment already owns the run lock' 75
fi

RUN_NAME="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$RUNS_ROOT/$RUN_NAME"
mkdir -- "$RUN_DIR"
chmod 0700 "$RUN_DIR"
LATEST_CANDIDATE="$STATE_ROOT/.latest.$RUN_NAME"

trap on_error ERR
trap on_termination TERM INT
write_status 'running'

EXPECTED_TARGETS="$RUN_DIR/expected-targets.txt"
AGGREGATE="$RUN_DIR/sccc_all_switches_single.json"
AUDIT_RESULT="$RUN_DIR/telemetry_audit.json"
AUDIT_CSV="$RUN_DIR/telemetry_switch_summary.csv"
PUBLISH_RESULT="$RUN_DIR/telemetry_publish.json"
FIREWALL_RESULT="$RUN_DIR/firewall_telemetry.json"

STAGE="manifest validation"
"$PYTHON" - \
  "$MANIFEST" \
  "$REQUIRED_TARGETS" \
  "$DEVICE_CATALOG" \
  "$EXPECTED_TARGET_COUNT" \
  "$EXPECTED_CATALOG_COUNT" \
  "$EXPECTED_FIREWALL_COUNT" \
  "$EXPECTED_TARGETS" <<'PY'
import csv
import ipaddress
import pathlib
import sys

manifest = pathlib.Path(sys.argv[1])
required_targets = pathlib.Path(sys.argv[2])
device_catalog = pathlib.Path(sys.argv[3])
expected_count = int(sys.argv[4])
expected_catalog_count = int(sys.argv[5])
expected_firewall_count = int(sys.argv[6])
output = pathlib.Path(sys.argv[7])

with manifest.open(encoding="utf-8-sig", newline="") as handle:
    reader = csv.DictReader(handle)
    if not reader.fieldnames or "ip" not in reader.fieldnames:
        raise SystemExit("manifest must contain an ip column")
    rows = list(reader)

ips = []
for number, row in enumerate(rows, start=2):
    address = str(row.get("ip") or "").strip()
    name = str(row.get("name") or "").strip()
    if not name:
        raise SystemExit(f"manifest row {number} has no name")
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError as exc:
        raise SystemExit(f"manifest row {number} has an invalid IP address") from exc
    if parsed.version != 4:
        raise SystemExit(f"manifest row {number} is not IPv4")
    if "enabled" in row and str(row.get("enabled") or "").strip().lower() not in {"1", "true", "yes"}:
        raise SystemExit(f"manifest row {number} is not enabled; the telemetry manifest must contain targets only")
    ips.append(str(parsed))

if len(ips) != expected_count:
    raise SystemExit(f"manifest has {len(ips)} targets; expected exactly {expected_count}")
if len(set(ips)) != len(ips):
    raise SystemExit("manifest contains duplicate management IP addresses")

required = [line.strip() for line in required_targets.read_text(encoding="ascii").splitlines() if line.strip()]
try:
    required = [str(ipaddress.ip_address(address)) for address in required]
except ValueError as exc:
    raise SystemExit("release required-targets.txt contains an invalid IP address") from exc
if len(required) != expected_count or len(set(required)) != expected_count:
    raise SystemExit("release required-targets.txt does not contain the exact expected unique target count")
if sorted(ips) != sorted(required):
    raise SystemExit("manifest IP set differs from the release's canonical required target set")

with device_catalog.open(encoding="utf-8-sig", newline="") as handle:
    catalog_reader = csv.DictReader(handle)
    required_columns = {"name", "ip", "device_type", "status", "monitoring_required", "canonical_ip"}
    if not catalog_reader.fieldnames or not required_columns.issubset(catalog_reader.fieldnames):
        raise SystemExit("device catalog is missing required canonical-scope columns")
    catalog_rows = list(catalog_reader)

monitored = [row for row in catalog_rows if str(row["monitoring_required"]).strip().lower() == "true"]
switch_rows = [row for row in monitored if str(row["device_type"]).strip().lower() == "switch"]
firewall_rows = [row for row in monitored if str(row["device_type"]).strip().lower() == "firewall"]
if len(monitored) != expected_catalog_count:
    raise SystemExit(f"catalog has {len(monitored)} required devices; expected {expected_catalog_count}")
if len(switch_rows) != expected_count:
    raise SystemExit(f"catalog has {len(switch_rows)} required switches; expected {expected_count}")
if len(firewall_rows) != expected_firewall_count:
    raise SystemExit(f"catalog has {len(firewall_rows)} required firewalls; expected {expected_firewall_count}")
if any(str(row["status"]).strip().lower() != "canonical" for row in monitored):
    raise SystemExit("every monitoring-required catalog row must have Canonical status")

def catalog_ips(rows, label):
    result = []
    for row in rows:
        address = str(ipaddress.ip_address(str(row["ip"]).strip()))
        canonical = str(ipaddress.ip_address(str(row["canonical_ip"]).strip()))
        if address != canonical:
            raise SystemExit(f"{label} catalog row {row['name']} does not use its canonical IP")
        result.append(address)
    if len(result) != len(set(result)):
        raise SystemExit(f"{label} catalog contains duplicate canonical IP addresses")
    return result

catalog_switch_ips = catalog_ips(switch_rows, "switch")
catalog_firewall_ips = catalog_ips(firewall_rows, "firewall")
if set(catalog_switch_ips).intersection(catalog_firewall_ips):
    raise SystemExit("switch and firewall catalog scopes overlap")
if sorted(catalog_switch_ips) != sorted(required):
    raise SystemExit("canonical required target set differs from catalog monitoring-required switches")

output.write_text("".join(f"{address}\n" for address in sorted(required)), encoding="ascii")
PY
chmod 0600 "$EXPECTED_TARGETS"

STAGE="firewall telemetry verification"
if "$PYTHON" "$FIREWALL_CHECKER" \
  --result "$FIREWALL_RESULT" \
  2>&1 | tee "$RUN_DIR/firewall.log"; then
  :
else
  printf 'WARNING: one or more firewalls lack fresh telemetry; switch collection will continue.\n' >&2
fi
[[ -s "$FIREWALL_RESULT" ]] || die 'firewall verifier did not create a result'
jq -e \
  --argjson expectedCount "$EXPECTED_FIREWALL_COUNT" '
    .schema == "sccc.network.firewall_telemetry.status.v1" and
    .expected == $expectedCount and
    ((.ok + .failed) == $expectedCount) and
    (.firewalls | type == "array") and
    (.failures | type == "array" and length == .failed)
  ' "$FIREWALL_RESULT" >/dev/null || die 'firewall verification result is malformed'
FIREWALLS_OK="$(jq -er '.ok' "$FIREWALL_RESULT")"
FIREWALLS_FAILED="$(jq -er '.failed' "$FIREWALL_RESULT")"

EXPECTED_JSON="$("$PYTHON" - "$EXPECTED_TARGETS" <<'PY'
import json
import pathlib
import sys

print(json.dumps(pathlib.Path(sys.argv[1]).read_text(encoding="ascii").splitlines()))
PY
)"

export FRED_INVENTORY_FILE="$MANIFEST"
export OUT_DIR="$RUN_DIR"
export OUTPUT_JSON="$AGGREGATE"
export PYTHONUNBUFFERED=1
export SWITCH_TELEMETRY_IMPORT_URL="$IMPORT_URL"

STAGE="full inventory collection"
(
  cd "$APP"
  "$PYTHON" "$COLLECTOR" \
    --workers "${TELEMETRY_COLLECT_WORKERS:-4}" \
    --output-json "$AGGREGATE"
) 2>&1 | tee "$RUN_DIR/collector.log"

[[ -s "$AGGREGATE" ]] || die 'collector did not create a telemetry aggregate'
jq -e \
  --argjson expected "$EXPECTED_JSON" \
  --argjson expectedCount "$EXPECTED_TARGET_COUNT" '
    .schema == "sccc.network.switchport_telemetry.v1" and
    .collection_scope == "full" and
    .switch_count == $expectedCount and
    ((.switch_count_ok + .switch_count_failed) == $expectedCount) and
    .switch_count_ok > 0 and
    ((.target_ips | sort) == $expected) and
    (([.switches[].switch_ip] | sort) == $expected) and
    all(.switches[];
      if .ok == true
      then ((.interfaces // []) | any(.is_physical == true))
      else ((.errors // []) | type == "array" and length > 0)
      end
    )
  ' "$AGGREGATE" >/dev/null || die 'aggregate failed the exact count, IP-set, count-consistency, or eligible-record gate'

COLLECTION_RUN_ID="$(jq -er '.run_id | select(type == "string" and length > 0)' "$AGGREGATE")"
SWITCHES_OK="$(jq -er '.switch_count_ok' "$AGGREGATE")"
SWITCHES_FAILED="$(jq -er '.switch_count_failed' "$AGGREGATE")"

STAGE="audit"
"$PYTHON" "$AUDITOR" \
  "$AGGREGATE" \
  --report "$AUDIT_RESULT" \
  --csv "$AUDIT_CSV" \
  --allow-failed-records \
  2>&1 | tee "$RUN_DIR/audit.log"

[[ -s "$AUDIT_RESULT" ]] || die 'auditor did not create an audit result'
jq -e \
  --arg runId "$COLLECTION_RUN_ID" \
  --argjson expectedCount "$EXPECTED_TARGET_COUNT" \
  --argjson switchesOk "$SWITCHES_OK" \
  --argjson switchesFailed "$SWITCHES_FAILED" '
    .schema == "sccc.network.switchport_telemetry.audit.v1" and
    .run_id == $runId and
    .passed == true and
    (.issues | type == "array" and length == 0) and
    .collector_records == $expectedCount and
    .records_ok == $switchesOk and
    .records_failed == $switchesFailed and
    (.failed_switches | type == "array" and length == $switchesFailed)
  ' "$AUDIT_RESULT" >/dev/null || die 'audit result did not pass the full-scope consistency gate'

STAGE="publish"
"$PYTHON" "$PUBLISHER" \
  "$AGGREGATE" \
  --result "$PUBLISH_RESULT" \
  2>&1 | tee "$RUN_DIR/publish.log"

[[ -s "$PUBLISH_RESULT" ]] || die 'publisher did not create a publish result'
jq -e \
  --arg runId "$COLLECTION_RUN_ID" \
  --argjson switchesOk "$SWITCHES_OK" '
    .schema == "sccc.network.switchport_telemetry.publish.v1" and
    .run_id == $runId and
    .preflight_attempted == $switchesOk and
    .preflight_succeeded == $switchesOk and
    .preflight_failed == 0 and
    (.preflight_results | type == "array" and length == $switchesOk) and
    all(.preflight_results[];
      .ok == true and
      (.status | type == "number" and . >= 200 and . < 300)
    ) and
    .attempted == $switchesOk and
    .applied == $switchesOk and
    .failed == 0 and
    (.results | type == "array" and length == $switchesOk) and
    all(.results[];
      .ok == true and
      (.status | type == "number" and . >= 200 and . < 300)
    )
  ' "$PUBLISH_RESULT" >/dev/null || die 'publish result did not pass the eligible applied-count and HTTP-success gate'

STAGE="completion"
chmod 0600 "$RUN_DIR"/*
COMPLETION_STATE='completed'
COMPLETION_MESSAGE="All $EXPECTED_TARGET_COUNT switches were collected and published; both firewalls have fresh continuous telemetry."
if (( SWITCHES_FAILED > 0 || FIREWALLS_FAILED > 0 )); then
  COMPLETION_STATE='completed_with_warnings'
  COMPLETION_MESSAGE="Attempted all $EXPECTED_TARGET_COUNT switches and verified both firewalls: published $SWITCHES_OK switches; $SWITCHES_FAILED switches and $FIREWALLS_FAILED firewalls require attention."
fi
write_status \
  "$COMPLETION_STATE" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$COMPLETION_MESSAGE" \
  "$COLLECTION_RUN_ID" \
  "$SWITCHES_OK" \
  "$SWITCHES_OK" \
  "$SWITCHES_FAILED" \
  "$FIREWALLS_OK" \
  "$FIREWALLS_FAILED"

# Promotion is intentionally the final fallible operation. Any earlier failure
# leaves the prior latest symlink untouched.
trap '' TERM INT
ln -s -- "$RUN_DIR" "$LATEST_CANDIDATE"
mv -Tf -- "$LATEST_CANDIDATE" "$STATE_ROOT/latest"
LATEST_CANDIDATE=""
trap - ERR TERM INT
exit 0
