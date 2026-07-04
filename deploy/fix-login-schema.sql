-- =============================================================================
-- fix-login-schema.sql — repair self-hosted schema drift that breaks login
-- =============================================================================
-- Symptoms this fixes:
--   * Sign-in with Microsoft succeeds, then bounces back to /login. Server log:
--       relation "sessions" does not exist
--   * Server log on boot:
--       Failed to strip non-break-glass passwords ...
--       null value in column "password_hash" ... violates not-null constraint
--
-- Both are caused by the production database missing schema changes that exist
-- in the app code. Every statement below is idempotent — safe to run repeatedly.
-- It mirrors lib/db/src/schema (sessions.ts, users.ts).
--
-- Run it on the VM against the production database, e.g.:
--   psql "$DATABASE_URL" -f deploy/fix-login-schema.sql
-- or, if you administer Postgres locally:
--   sudo -u postgres psql -d <db_name> -f deploy/fix-login-schema.sql
-- then restart the service:  sudo systemctl restart sccc-api
--
-- (Deploying the current code also applies these on boot via ensureSchema();
--  this script is only for fixing an already-running instance immediately.)
-- =============================================================================

-- 1) Persistent bearer-token session store (keeps users logged in across restarts)
CREATE TABLE IF NOT EXISTS "sessions" (
  "token"      text PRIMARY KEY NOT NULL,
  "user_id"    integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "sessions_user_id_idx"    ON "sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions" ("expires_at");

-- 2) SSO users have no local password, so password_hash must be nullable.
--    No-op if it is already nullable.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
