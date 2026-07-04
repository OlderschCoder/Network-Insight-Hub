---
name: Persistent bearer sessions
description: How auth sessions survive API restarts; the sessions table and its expiry/cleanup contract.
---

# Persistent bearer-token sessions

Bearer tokens live in a `sessions` DB table (token PK, user_id FK cascade, created_at, expires_at), NOT an in-memory Map. This is why logins survive an API-server restart/redeploy.

**Contract to keep consistent:**
- Session helpers in `artifacts/api-server/src/routes/auth.ts` are all async now (`createToken`, `getUserIdFromToken`, `invalidateUserSessions`, `deleteToken`). Any new caller must `await` them — `invalidateUserSessions` is awaited in the users route.
- Tokens get a 30-day sliding TTL. `getUserIdFromToken` treats an expired row as absent and deletes it; a periodic `startSessionCleanup` timer (hourly, unref'd, started in `index.ts`) sweeps expired rows.
- SSO transient state (`entraTxns` PKCE, `exchangeCodes`) is intentionally still in-memory: it's 60s–10min lived, so a restart mid-login just needs a retry (degrades gracefully). Do not "fix" this into the DB unless there's a real need.

**Why:** an in-memory session Map logged everyone out on every deploy.
