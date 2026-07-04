#!/usr/bin/env bash
# =============================================================================
# deploy.sh — build the Hub from source and roll it out to /opt/sccc-it
# =============================================================================
# Run ON the Azure VM. Override the source checkout path with SRC=... if needed.
#   SRC=~/Network-Insight-Hub ./deploy/deploy.sh
# =============================================================================
set -euo pipefail

SRC="${SRC:-$HOME/Network-Insight-Hub}"
DEST="/opt/sccc-it"
FRONTEND_SUB="artifacts/it-reporting/dist/public"
BACKEND_SUB="artifacts/api-server/dist"

echo ">> Source: $SRC"
echo ">> Dest:   $DEST"
cd "$SRC"

echo ">> Pulling latest source..."
git pull --ff-only

echo ">> Installing dependencies..."
pnpm install --frozen-lockfile

echo ">> Building frontend (static)..."
BASE_PATH=/ pnpm --filter @workspace/it-reporting run build

echo ">> Building backend (bundle)..."
pnpm --filter @workspace/api-server run build

echo ">> Copying build output to $DEST..."
sudo mkdir -p "$DEST/$FRONTEND_SUB" "$DEST/$BACKEND_SUB"
sudo rsync -a --delete "$SRC/$FRONTEND_SUB/" "$DEST/$FRONTEND_SUB/"
sudo rsync -a --delete "$SRC/$BACKEND_SUB/" "$DEST/$BACKEND_SUB/"

echo ">> Restarting service..."
sudo systemctl restart sccc-api
sleep 2
sudo systemctl status sccc-api --no-pager -n 8 || true

echo ">> Done. Tail logs with: sudo journalctl -u sccc-api -f"
echo ">> NOTE: restarting resets in-memory sessions — users must sign in again."
