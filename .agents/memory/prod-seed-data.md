---
name: Production seed data
description: Replit managed production DB gets schema-only on publish, no seed data — so any "seeded" reference data must self-seed at app startup, not via one-off scripts.
---

# Production database starts empty of seed data

Replit's managed production database is provisioned fresh on publish: the **schema** is migrated (dev→prod diff at publish time), but **row data is NOT copied**. Any data inserted only into the dev DB (e.g. via an ephemeral `/tmp` script or a `scripts/*.mjs` run against `DATABASE_URL`) exists in dev only. The deployed app connects to a different, empty production DB.

**Symptom seen:** the embedded AI "knew nothing" in the published app because `ai_knowledge` had 0 rows in production even though dev had 49. `executeSql({environment:"production"})` is READ-ONLY, so you cannot INSERT into prod through tooling.

**Why:** publish migrates DDL, not DML. There is no supported tool path to write seed rows into managed prod.

**How to apply:** for reference/seed data that must exist in every environment, seed it from **app startup** (idempotent), not from a manual script. Pattern used here: `artifacts/api-server/src/lib/seed_app_usage.ts` runs on boot from `index.ts` after `app.listen`, inside a transaction guarded by `pg_advisory_xact_lock` (serializes concurrent boots so delete+insert can't duplicate; no unique constraint / schema migration needed). Then the fix ships only on the **next publish** — a code change alone doesn't touch the already-running prod app until redeploy.
