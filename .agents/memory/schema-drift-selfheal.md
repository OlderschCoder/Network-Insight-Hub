---
name: Self-hosted schema-drift self-heal
description: Why the API server reconciles known DB drift at boot, and the ordering rule that makes it reliable.
---

# Self-hosted schema-drift self-heal

The self-hosted prod DB (Azure VM) is provisioned manually and does NOT get
Drizzle migrations automatically, so tables/columns added to the code schema
later go missing in prod. This has broken login twice: a missing `sessions`
table (login authenticates, then session insert throws `relation "sessions"
does not exist` → user bounced to /login) and a leftover `NOT NULL` on
`users.password_hash` (breaks the SSO-user contract + the boot password strip).

**Fix pattern:** an idempotent `ensureSchema()` (api-server `lib/ensure_schema.ts`)
runs `CREATE TABLE IF NOT EXISTS` / `ALTER ... DROP NOT NULL` at boot, mirroring
the Drizzle schema. Same DDL is mirrored in `deploy/fix-login-schema.sql` for an
instant manual fix without a rebuild.

**Why:** on a manually-provisioned box you cannot rely on `drizzle push` (its TUI
can't be piped; --force still prompts over existing rows). Boot-time idempotent
DDL self-heals fresh AND drifted DBs.

**How to apply — ORDERING IS LOAD-BEARING:** `await ensureSchema()` must run
BEFORE `app.listen()` and before seeds like `stripNonBreakGlassPasswords()`. If
you let it run in parallel (fire-and-forget), the first login or the password
strip can race ahead of the DDL and still fail on the first boot after deploy.
Keep DDL failures non-fatal (log, don't throw) so a reconcile problem never
blocks startup.
