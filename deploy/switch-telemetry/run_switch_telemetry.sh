#!/bin/sh
set -eu
APP=$(readlink -f /opt/sccc-switch-telemetry/current)
exec "$APP/.venv/bin/python" "$APP/resilient_runner.py"
