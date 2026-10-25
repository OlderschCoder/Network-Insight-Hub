#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT=/home/ITADMIN/fred-network-enrollment
readonly PREFIX='switch-enrollment '
request="${SSH_ORIGINAL_COMMAND:-}"

[[ "$request" == "$PREFIX"* ]] || {
  printf '{"schema":"sccc.network.switch_enrollment.error.v1","error":"Command not permitted"}\n'
  exit 64
}

encoded="${request#"$PREFIX"}"
[[ "$encoded" =~ ^[A-Za-z0-9_-]{8,8192}$ ]] || {
  printf '{"schema":"sccc.network.switch_enrollment.error.v1","error":"Request encoding is invalid"}\n'
  exit 64
}

exec "$APP_ROOT/.venv/bin/python" "$APP_ROOT/switch_enrollment_control.py" --request-b64 "$encoded"
