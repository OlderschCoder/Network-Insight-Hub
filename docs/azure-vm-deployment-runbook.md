# SCCC IT Reporting Hub — Azure VM Deployment & Security Runbook

Operational reference for the self-hosted deployment of the SCCC IT Department
Reporting Hub. Covers the server layout, every service and integration we
configured, the security posture, and a troubleshooting playbook for the issues
we actually hit.

> **Secrets are intentionally redacted.** This document uses placeholders like
> `<set in .env.production>` for every credential. Never paste live secret
> values into this file — it may be shared or committed. See
> [Secret rotation](#12-secret-rotation-checklist).

- **Public URL:** `https://sccc-itreporting.centralus.cloudapp.azure.com/`
- **Host:** Azure VM, Ubuntu (hostname `appserver`)
- **Last major work:** Microsoft Entra ID SSO brought fully online; production DB
  schema reconciled; AI chat pointed at OpenAI.

---

## 1. Architecture at a glance

```
Browser (HTTPS)
   │
   ▼
nginx 1.24.0  ── serves static React build  (/…  → dist/public)
   │           └ reverse-proxies /api/  → 127.0.0.1:8080
   ▼
sccc-api (systemd)  ── Node/Express API on :8080  (WorkingDir /opt/sccc-it)
   │
   ▼
PostgreSQL  (localhost:5432, db "sccc_it")
   │
   ├── Microsoft Entra ID (SSO login, OIDC + PKCE)
   ├── OpenAI API (AI chat / status reports)
   ├── Zendesk (ticket sync / creation)
   └── Azure ARM (VM inventory sync — service principal)
```

Two moving parts run the app: **nginx** (front door + static files) and the
**`sccc-api`** systemd service (the backend). The React frontend is a static
build; there is no separate frontend server in production.

---

## 2. Server layout (paths)

| Path | What it is |
|---|---|
| `/opt/sccc-it/` | Deployed app root. `WorkingDirectory` of the systemd service. |
| `/opt/sccc-it/artifacts/api-server/dist/index.mjs` | Backend bundle (esbuild output) that systemd runs. |
| `/opt/sccc-it/artifacts/it-reporting/dist/public/` | Static frontend build that nginx serves. |
| `/opt/sccc-it/.env.production` | All runtime configuration & secrets (loaded by systemd). |
| `/etc/systemd/system/sccc-api.service` | Service definition. |
| nginx site config (under `/etc/nginx/`) | Static root + `/api/` proxy. |
| `~/Network-Insight-Hub/` | Source checkout used to **build** before copying to `/opt`. |

---

## 3. The `sccc-api` service (systemd)

Runs the backend as a managed service that restarts on failure and starts on boot.

```
ExecStart=/usr/bin/node --enable-source-maps artifacts/api-server/dist/index.mjs
WorkingDirectory=/opt/sccc-it
EnvironmentFile=/opt/sccc-it/.env.production
```

Common commands:

```bash
sudo systemctl restart sccc-api          # apply env/code changes
sudo systemctl status  sccc-api --no-pager
sudo journalctl -u sccc-api -n 40 --no-pager        # recent logs
sudo journalctl -u sccc-api -f                       # live tail
sudo systemctl reset-failed sccc-api     # clear crash-loop lockout, then restart
```

> **Important:** configuration in `.env.production` is only read **at process
> start**. Any env change requires `sudo systemctl restart sccc-api` to take
> effect.

---

## 4. nginx

nginx does two jobs:

1. **Serves the static frontend** from `/opt/sccc-it/artifacts/it-reporting/dist/public`.
2. **Reverse-proxies** all `/api/` requests to `http://127.0.0.1:8080`.

A **502 Bad Gateway** from nginx almost always means the backend is down —
check `sudo systemctl status sccc-api` and the journal (see
[Troubleshooting](#11-troubleshooting-playbook)).

TLS is terminated at the public HTTPS endpoint. **HTTPS is mandatory** — Entra
rejects non-HTTPS redirect URIs (except `localhost`), so the SSO callback only
works over `https://`.

---

## 5. Database (PostgreSQL)

- Local PostgreSQL, database `sccc_it`, connected via `DATABASE_URL` in
  `.env.production`.
- Schema is defined by Drizzle in the app source (`lib/db`).

### Schema reconciliation (self-hosted caveat)

Publishing/deploying does **not** automatically migrate this self-hosted
database. When the app code adds columns/tables, the live DB can drift behind and
queries fail with `column … does not exist`. Reconcile **additively and
idempotently** with direct SQL, e.g.:

```bash
DBURL=$(grep -m1 '^DATABASE_URL=' /opt/sccc-it/.env.production | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
psql "$DBURL" -c "\d users"          # inspect a table
psql "$DBURL" -c "ALTER TABLE users ADD COLUMN IF NOT EXISTS <col> <type>;"
```

**Known reconciliation for SSO:** legacy databases had
`users.password_hash NOT NULL` (from the pre-SSO era). SSO users have no local
password, so this must be relaxed or new SSO sign-ins (and the boot seeder) fail:

```bash
psql "$DBURL" -c "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;"
```

---

## 6. Environment configuration (`.env.production`)

All configuration lives in `/opt/sccc-it/.env.production`, loaded by systemd.
Values below are **names and purpose only** — real secrets are set in the file.

### Core

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. **Must be the very first token on its line — a stray leading character (e.g. `\`) makes the app fail with "DATABASE_URL must be set".** |
| `SESSION_SECRET` | Server session signing secret. |
| `NODE_ENV` | `production`. |
| `PORT` | `8080` (must match the nginx proxy target). |

### Microsoft Entra ID (SSO)

| Variable | Purpose |
|---|---|
| `ENTRA_TENANT_ID` | SCCC tenant id. |
| `ENTRA_CLIENT_ID` | App registration (client) id. |
| `ENTRA_CLIENT_SECRET` | App registration **secret Value** (not the Secret *ID*). |
| `ENTRA_REDIRECT_URI` | `https://sccc-itreporting.centralus.cloudapp.azure.com/api/auth/entra/callback` — must match the app registration exactly. |
| `ENTRA_ALLOWED_GROUP_IDS` | Entra **cloud** group Object Id(s) allowed to sign in (the IT / InfoTech group). Comma-separated for multiple. |
| `ENTRA_ALLOWED_APP_ROLES` | *(alternative gate, not currently used)* app-role values allowed in. |
| `ENTRA_ROLE_MAP_JSON` | *(optional)* override job-title/app-role → Hub-role mapping. |

### Integrations

| Variable | Purpose |
|---|---|
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API key used by AI chat / status reports. **This is the only key the app reads** — a plain `OPENAI_API_KEY` is ignored. |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | `https://api.openai.com/v1` (exactly — no trailing characters). |
| `ZENDESK_SUBDOMAIN` / `ZENDESK_EMAIL` / `ZENDESK_API_TOKEN` | Zendesk ticket sync & creation. |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_SUBSCRIPTION_ID` | Service-principal credentials for **Azure VM inventory sync**. The SP needs **Reader** at subscription scope. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | *(optional)* email-report delivery. Not configured yet. |
| `FORTIGATE_HOST` / `FORTIGATE_API_TOKEN` / `FORTIGATE_VDOM` / `FORTIGATE_WEBFILTER_PROFILE` / `FORTIGATE_VERIFY_SSL` | *(optional)* FortiGate web-filter whitelist. Reachable only on the SCCC network/VPN. |

> **Gotcha:** the AI base URL and keys must have **no trailing punctuation**. A
> stray `)` on the base-URL line caused requests to hit `/v1)/…` and return 404.

---

## 7. Authentication & SSO

### Microsoft Entra ID (primary)

- **Flow:** OIDC Authorization Code + PKCE (confidential client).
  `GET /api/auth/entra/login` → Microsoft → `GET /api/auth/entra/callback`
  (validates `state` cookie + `id_token`, calls Graph `/me`, checks the access
  gate, upserts the user, mints a one-time code) → SPA
  `/login?entra_code=…` → `POST /api/auth/entra/exchange` redeems the single-use
  code for `{user, token}`. **The bearer token never appears in a URL.**
- **Access gate (fails closed):** a user is allowed in only if their token
  `groups` claim contains one of `ENTRA_ALLOWED_GROUP_IDS` (or, if used, their
  `roles` claim matches `ENTRA_ALLOWED_APP_ROLES`). If **no** gate value is set,
  **all SSO sign-ins are denied**. A rejected user logs
  `Entra sign-in refused: not in IT group/role`.
- **Groups claim requirement:** the app registration's **Token configuration**
  must emit a **groups** claim (Security groups, format **Group ID**) on the
  **ID** token. The value in `ENTRA_ALLOWED_GROUP_IDS` must be the group's
  **Entra cloud Object Id** (from portal.azure.com → Entra ID → Groups), *not*
  the on-prem AD group name or the GUID shown in ADUC.
- **On-prem groups:** the IT group (`InfoTech`, on-prem `sccc.edu/Groups/IT`)
  only works as a gate if **Azure AD Connect** syncs it to Entra. If a group
  can't be found in Entra ID → Groups, it isn't synced — use the **App Role**
  gate instead.

### Break-glass local login (emergency only)

- `POST /api/auth/login` (bcrypt) still exists for emergency admin access when
  SSO is down, but **only** accounts flagged `is_break_glass` with a
  `password_hash` may use it. On boot, all non-break-glass password hashes are
  nulled so old credentials can't bypass the Entra gate.

### Sessions

- Bearer tokens are held in an **in-memory map** → **every restart invalidates
  all sessions**. After any `systemctl restart`, users must sign in again
  (symptom: previously-working pages start returning `401`).

---

## 8. Integrations summary

| Integration | Status | Notes |
|---|---|---|
| **Microsoft Entra ID SSO** | ✅ Live | Group-gated to IT. Client secret is the secret *Value*, not the ID. |
| **OpenAI (AI chat / reports)** | ✅ Configured | Uses `AI_INTEGRATIONS_OPENAI_*`; base URL `…/v1`. App calls model **`gpt-5.2`** — the key's account must have access to it. |
| **Zendesk** | ✅ Configured | Subdomain `sccc`; ticket sync + creation. |
| **Azure VM inventory** | ⚠️ Verify | Needs `AZURE_CLIENT_SECRET` set and SP granted **Reader** at subscription scope; sync returns 503 if unconfigured. |
| **SMTP email reports** | ⛔ Not configured | Optional; set `SMTP_*` to enable. |
| **FortiGate whitelist** | ⛔ Not configured | Optional; on-network/VPN only. |

---

## 9. Security posture

- **HTTPS everywhere.** Public endpoint is HTTPS; Entra redirect URI must be
  HTTPS.
- **SSO fails closed.** No access gate configured ⇒ no one gets in via SSO. Only
  members of the allowed IT group are admitted.
- **Login CSRF protection.** `/auth/entra/login` sets an httpOnly, SameSite=Lax
  `entra_state` cookie bound to a random `state`; the callback rejects mismatches.
- **Token never in URL.** Only a single-use, 60-second code is placed in the SPA
  redirect; it's exchanged server-side for the bearer token.
- **Local password login locked down.** Only break-glass accounts can use
  password login; all other password hashes are stripped at boot.
- **Least privilege for Azure.** The VM-sync service principal should hold
  **Reader** only, at subscription scope.
- **Role enforcement server-side.** CIO-only actions (user management, report
  finalization, deletions, exports to Zendesk) are guarded by `requireCIO`
  independent of the frontend.
- **AI guardrails.** The AI knowledge store rejects credential-like content and
  wraps injected memory in an anti-prompt-injection preamble; injection is
  size-capped.
- **Secrets are file-scoped.** All secrets live in `.env.production` (not in
  git). Restrict its permissions (`root`-owned, `chmod 600` recommended).

See `threat_model.md` in the repo root for the full asset/trust-boundary model.

---

## 10. Deploy / update procedure

Builds happen in the source checkout, then artifacts are copied to `/opt`:

```bash
cd ~/Network-Insight-Hub
git pull                                 # get latest code

# Frontend (static) — outputs to dist/public
BASE_PATH=/ pnpm --filter @workspace/it-reporting run build
sudo cp -r artifacts/it-reporting/dist/public/* \
  /opt/sccc-it/artifacts/it-reporting/dist/public/

# Backend (esbuild bundle) — outputs dist/index.mjs
pnpm --filter @workspace/api-server run build
sudo cp -r artifacts/api-server/dist/* /opt/sccc-it/artifacts/api-server/dist/

# Apply
sudo systemctl restart sccc-api
```

> If the UI or an API route looks stale after a change, the copied build is
> almost always the cause — a stale frontend build hid the Microsoft sign-in
> button, and a stale backend bundle caused `Cannot GET /api/auth/entra/login`.
> Rebuild **and** re-copy both, then restart.

---

## 11. Troubleshooting playbook

| Symptom | Likely cause | Fix |
|---|---|---|
| **502 Bad Gateway** | Backend crashed / not listening on :8080. | `systemctl status sccc-api`; read the journal for the real error; fix; `reset-failed` then restart. |
| `DATABASE_URL must be set` | Malformed `.env.production` first line (e.g. a leading `\`). | Ensure line reads exactly `DATABASE_URL=postgres://…`; restart. |
| `Start request repeated too quickly` | Crash-loop tripped systemd rate limit. | `sudo systemctl reset-failed sccc-api` then start; check journal for the underlying crash. |
| `column … does not exist` | Prod DB behind the schema. | Additive `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` (see §5). |
| `null value in column "password_hash"` at boot | Legacy `NOT NULL` on `password_hash`. | `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;` |
| `Cannot GET /api/auth/entra/login` | Stale backend bundle. | Rebuild backend, re-copy `dist`, restart. |
| No "Sign in with Microsoft" button | Stale frontend build **or** SSO not fully configured. | Rebuild/re-copy frontend; ensure OIDC config + a gate value are set. |
| `AADSTS7000215: Invalid client secret` | Pasted the secret **ID** (GUID) instead of the **Value**. | Recreate the secret, copy the Value into `ENTRA_CLIENT_SECRET`, restart. |
| `Entra sign-in refused: not in IT group/role` | Gate value wrong, or groups claim missing/not synced. | Confirm `ENTRA_ALLOWED_GROUP_IDS` = the IT group's Entra cloud Object Id; ensure the groups claim is emitted and the group is synced; else use App Role gate. |
| AI chat `404` | Bad `AI_INTEGRATIONS_OPENAI_BASE_URL` (stray char). | Set to exactly `https://api.openai.com/v1`; restart. |
| AI chat `401` on **all** API calls | Session invalidated by restart. | Sign out and back in (tokens are in-memory). |
| AI chat `401` from OpenAI only | Key rejected (revoked/mistyped/truncated). | Verify with a direct `curl …/v1/models`; fix the key. |
| AI chat `503` | AI not configured. | Set both `AI_INTEGRATIONS_OPENAI_API_KEY` and `…_BASE_URL`; restart. |

Quick key check (prints only an HTTP status, never the key):

```bash
KEY=$(grep -m1 '^AI_INTEGRATIONS_OPENAI_API_KEY=' /opt/sccc-it/.env.production | cut -d= -f2- | tr -d "\"'")
BASE=$(grep -m1 '^AI_INTEGRATIONS_OPENAI_BASE_URL=' /opt/sccc-it/.env.production | cut -d= -f2- | tr -d "\"'")
echo "base=[$BASE]"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$BASE/models" -H "Authorization: Bearer $KEY"
```

---

## 12. Secret rotation checklist

Rotate any secret that has been shared in plain text (chat, email, screenshots)
or is otherwise suspect. After rotating, update `.env.production` and
`sudo systemctl restart sccc-api`.

- [ ] **Entra client secret** (`ENTRA_CLIENT_SECRET`) — regenerate in the app
      registration; copy the **Value**.
- [ ] **OpenAI API key** (`AI_INTEGRATIONS_OPENAI_API_KEY`) — regenerate at
      platform.openai.com; revoke the old one.
- [ ] **Zendesk API token** (`ZENDESK_API_TOKEN`) — regenerate in Zendesk admin.
- [ ] **Azure SP secret** (`AZURE_CLIENT_SECRET`) — regenerate in the app
      registration.
- [ ] **Database password** (in `DATABASE_URL`) — rotate the Postgres role
      password and update the connection string.
- [ ] **`SESSION_SECRET`** — rotate if exposure is suspected (invalidates
      existing sessions).
- [ ] Confirm `.env.production` is `root`-owned and `chmod 600`.

---

## 13. Known gaps / follow-ups

- **Azure VM sync:** confirm `AZURE_CLIENT_SECRET` is set on the VM and the SP
  has Reader — otherwise the sync button returns 503 / auth errors.
- **AI model:** the app hardcodes `gpt-5.2`. If the OpenAI account lacks access,
  chat will error with "model does not exist" — the model can be made
  configurable via env if needed.
- **Group sync:** if the IT group isn't reliably synced to Entra, migrate the
  access gate to an **App Role** (`ENTRA_ALLOWED_APP_ROLES`) to remove the
  dependency on Azure AD Connect.
- **Email reports:** set `SMTP_*` to enable the CIO email-report feature.
- **Session durability:** bearer tokens are in-memory and reset on restart;
  consider a persistent session store if restarts become disruptive.
