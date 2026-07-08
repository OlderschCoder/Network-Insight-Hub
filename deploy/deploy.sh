#!/usr/bin/env bash
# =============================================================================
# deploy.sh — build the Hub from source and roll it out to /opt/sccc-it
# =============================================================================
# Run ON the Azure VM:
#   cd ~/Network-Insight-Hub && bash deploy/deploy.sh
#
# Flags:
#   --skip-import     skip device config seed import
#   --dry-run-import  preview import without DB writes
# =============================================================================
set -euo pipefail

SRC="${SRC:-$HOME/Network-Insight-Hub}"
DEST="/opt/sccc-it"
FRONTEND_SUB="artifacts/it-reporting/dist/public"
BACKEND_SUB="artifacts/api-server/dist"
SEEDS_SRC="$SRC/artifacts/api-server/src/seeds"
MIGRATION_DIR="$SRC/lib/db/migrations"

SKIP_IMPORT=false
DRY_RUN_IMPORT=false
for arg in "$@"; do
  case $arg in
    --skip-import)     SKIP_IMPORT=true ;;
    --dry-run-import)  DRY_RUN_IMPORT=true ;;
  esac
done

echo ">> Source: $SRC"
echo ">> Dest:   $DEST"
cd "$SRC"

# ── Pull ──────────────────────────────────────────────────────────────────────
echo ""
echo ">> Pulling latest source..."
git pull --ff-only

# ── DB Migrations ─────────────────────────────────────────────────────────────
echo ""
echo ">> Running DB migrations..."
DB_URL=$(grep DATABASE_URL "$DEST/.env.production" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
if [ -z "$DB_URL" ]; then
  DB_URL=$(grep DATABASE_URL "$SRC/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
fi

if [ -z "$DB_URL" ]; then
  echo "   WARNING: DATABASE_URL not found — skipping migrations"
else
  for sql_file in \
    "$MIGRATION_DIR/add_ai_knowledge_scope.sql" \
    "$MIGRATION_DIR/add_device_configs.sql" \
    "$MIGRATION_DIR/add_incident_rooms.sql"
  do
    if [ -f "$sql_file" ]; then
      echo "   Applying $(basename $sql_file)..."
      psql "$DB_URL" -f "$sql_file" 2>&1 | grep -v "^$" || true
    fi
  done
fi

# ── Install ───────────────────────────────────────────────────────────────────
echo ""
echo ">> Installing dependencies..."
pnpm install --frozen-lockfile

# ── Build ─────────────────────────────────────────────────────────────────────
echo ""
echo ">> Building frontend (static)..."
BASE_PATH=/ pnpm --filter @workspace/it-reporting run build

echo ""
echo ">> Building backend (bundle)..."
pnpm --filter @workspace/api-server run build

# ── Deploy build output ───────────────────────────────────────────────────────
echo ""
echo ">> Copying build output to $DEST..."
sudo mkdir -p "$DEST/$FRONTEND_SUB" "$DEST/$BACKEND_SUB"
sudo rsync -a --delete "$SRC/$FRONTEND_SUB/" "$DEST/$FRONTEND_SUB/"
sudo rsync -a --delete "$SRC/$BACKEND_SUB/" "$DEST/$BACKEND_SUB/"

# ── Device config seed import ─────────────────────────────────────────────────
if [ "$SKIP_IMPORT" = false ] && [ -d "$SEEDS_SRC/device-configs" ]; then
  echo ""
  echo ">> Running device config import..."
  TSX="$SRC/node_modules/.bin/tsx"
  [ ! -f "$TSX" ] && TSX="npx tsx"

  cd "$SRC/artifacts/api-server"
  if [ "$DRY_RUN_IMPORT" = true ]; then
    $TSX src/seeds/import_device_configs.ts --dry-run || echo "   Import dry-run failed (non-fatal)"
  else
    $TSX src/seeds/import_device_configs.ts || echo "   Import failed (non-fatal)"
  fi
  cd "$SRC"
else
  [ "$SKIP_IMPORT" = true ] && echo "" && echo ">> Skipping device config import (--skip-import)"
fi

# ── Restart ───────────────────────────────────────────────────────────────────
echo ""
echo ">> Restarting service..."
sudo systemctl restart sccc-api
sleep 2
sudo systemctl status sccc-api --no-pager -n 8 || true

echo ""
echo ">> Done. Tail logs with: sudo journalctl -u sccc-api -f"
