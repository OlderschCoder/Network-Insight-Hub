---
name: Publish migrates prod by diffing the DEV database, not the schema files
description: Why a prod schema migration on publish can silently no-op, and why the dev DB must match source-of-truth first.
---

# Publish diffs the dev DATABASE against prod, not your schema .ts files

Replit's publish-time prod migration computes a SQL diff between the **development database** and the **production database** — it does NOT read `lib/db/src/schema/*.ts`. So if the dev DB itself has drifted behind the schema files (columns present in the source of truth but never applied to dev), publishing will migrate prod to match dev's *stale* shape and the intended columns still won't land in prod.

**Why:** a task agent can verify a feature against source-of-truth code while the dev DB silently lacks the columns; the feature "works after a fresh push" but a publish would carry the drift, not the fix.

**How to apply:** before telling the user to re-publish to fix a missing prod column, first confirm the dev DB matches the schema files (reconcile via direct SQL when the drizzle push TUI blocks — see drizzle-push-noninteractive). Only then does the dev→prod publish diff include the new DDL.

**Task-agent limits for prod verification:** a task agent CANNOT publish (suggestDeploy only works in the main context) and CANNOT run DDL against prod (`executeSql environment:"production"` is read-only). So "verify break-glass/login on the live site" is only completable up to the dev boundary from a task agent — final live confirmation is blocked on a user-initiated re-publish after merge.
