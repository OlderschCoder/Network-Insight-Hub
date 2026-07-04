---
name: Dev DB schema drift vs drizzle push
description: The dev Postgres drifts from the Drizzle schema; push prompts interactively and can't be piped.
---

# Dev DB drifts from the Drizzle schema

The dev Postgres has been observed missing schema columns (e.g. `users.is_break_glass`, `job_title`, `entra_object_id`) and carrying stale constraints (`users.password_hash NOT NULL` even though the schema made it nullable). Symptoms: boot-time seeders crash ("column ... does not exist", "null value in column password_hash violates not-null") and `requireAuth` 500s.

**Why it persists:** `pnpm --filter @workspace/db run push` opens an interactive @clack prompt when a change is potentially destructive (e.g. adding a UNIQUE constraint to a table with rows). It reads a raw TTY, so piping stdin (`printf '\n' | ...`) does NOT answer it — the push aborts and no schema is applied.

**How to apply:** reconcile with direct idempotent SQL via `executeSql` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `DROP NOT NULL`, add named constraints guarded by `pg_constraint` checks) instead of relying on `push`, or answer the prompt in a real TTY. After fixing, restart the API workflow and confirm the seed logs are clean ("Stripped local passwords ...").
