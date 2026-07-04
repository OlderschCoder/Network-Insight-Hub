---
name: drizzle-kit push non-interactive
description: Why `drizzle-kit push` can block on a TUI prompt, and how to get around it.
---

# drizzle-kit push gets stuck on interactive prompts

`drizzle-kit push` confirmations are a raw-keypress TUI (@clack/prompts). Piping
(`printf '\n' | ...`, here-strings, `script -qec`) does NOT reliably answer it,
and `--force` still prompts for one case: **adding a UNIQUE constraint to a
column that already has rows** (it asks "truncate the table?" and blocks).

**Workaround:** apply the missing DDL directly via SQL (`executeSql` / the
`database` skill) — `ADD COLUMN IF NOT EXISTS` plus a guarded `ADD CONSTRAINT
... UNIQUE` inside a `DO $$ ... IF NOT EXISTS $$` block. A Postgres UNIQUE
constraint allows NULLs, so adding it on a freshly added all-NULL column is safe.

**Why:** a database that drifts behind `lib/db/src/schema/*.ts` makes
restart-time seeders crash-loop, and the push TUI can't be scripted to fix it.

**How to apply:** when a startup seeder logs `column ... does not exist` or a
NOT NULL violation, treat it as DB drift, not a code bug — reconcile against the
schema files via direct SQL rather than fighting the push TUI.
