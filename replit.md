# SCCC IT Department Reporting Platform

## Overview

Internal weekly reporting platform for Seward County Community College IT Department (~5 users). Users submit daily log entries consolidated into weekly reports; CIO has full access to aggregate reports, finalization, and user management.

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite, shadcn/ui, Tailwind CSS, TanStack Query, Wouter

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Packages

- `lib/api-spec` — OpenAPI YAML spec + Orval codegen config
- `lib/api-client-react` — Generated TanStack Query hooks + custom-fetch (auth token injection)
- `lib/db` — Drizzle schema + DB client
- `artifacts/api-server` — Express API backend
- `artifacts/it-reporting` — React frontend (Vite)

## DB Schema Tables

- `sessions` — token (PK), userId (FK → users.id, ON DELETE CASCADE), createdAt, expiresAt. Persistent bearer-token store so logins survive restarts; ensured idempotently at boot.
- `users` — id, name, email, passwordHash (nullable — SSO users have none), jobTitle, entraObjectId (unique), role (cio/helpdesk/network/security/network_engineer/security_engineer/staff), department, isActive, isBreakGlass (only break-glass accounts may use local password login)
- `entries` — id, userId, category, title, description, accomplishments, challenges, supportNeeded, ticketCount, weekOf, entryDate, tags, isSubmitted (one weekly log per user per week, enforced by unique `(user_id, week_of)`; POST /api/entries upserts on this key)
- `log_items` — id, userId, itemDate, weekOf, title, category, notes, weeklyEntryId (nullable). Standalone items added throughout the week; rolled into the weekly log when the user generates one. After saving a weekly log, all matching items for that user+week are stamped with `weekly_entry_id` so historical logs stay stable when items are later edited.
- `reports` — id, weekOf, isFinalized, summary, finalizedAt, finalizedBy
- `risks` — id, userId, type (risk/issue/design), severity, status, title, description, mitigation
- `network_switches` — id, hostname, building, ipAddress, model, status, configFile, notes
- `vlans` — id, vlanId, name, description, building, type, subnet, gateway
- `network_layout_positions` — nodeId (PK), x, y, width, height, updatedAt, updatedBy. Shared React Flow positions for the network diagram (one row per node, last writer wins).
- `azure_vms` — id, name, resourceGroup, subscription, location, size, os, privateIp, publicIp, vnet, subnet, status, purpose, notes, owner, createdBy
- `after_action_reports` — id, userId, title, incidentDate, outcome, summary, timeline, whatWentWell, whatWentPoorly, actionItems
- `projects` — id, title, description, status, progress (0-100), targetDate, newEstimatedDate, attachments (json), progressLog (json), pendingDecisions (json), strategicObjectiveIds (json), createdBy
- `project_assignees` — projectId + userId composite PK
- `ai_knowledge` — id, category (organization/environment/network/wireless/azure/identity/applications/endpoints/monitoring/security/helpdesk/general), title, content, source (seed/manual/ai), isActive, updatedBy, timestamps. Persistent AI memory: all active entries are injected into every AI prompt (status report generate, status-report chat, network AI chat). Seeded with 33 sections from the SCCC Helpdesk AI Knowledge Base doc.
- `cio_shadow_notes` — id, weekOf (nullable), category, content, status (open/approved/dismissed), source (ai/manual), createdBy (FK → users.id), timestamps. **CIO-only private "shadow memory"**: a staging area of AI/CIO observations surfaced at reporting time. Never modifies any report or deliverable and is visible only to the CIO. The AI persists notes here via the `save_shadow_note` tool (CIO sessions only); the CIO reviews/approves/dismisses/promotes them on the "CIO Insights" tab. Table + index ensured idempotently at boot in `ensure_schema.ts`.

## API Routes

All routes under `/api/`:
- `POST /auth/register` — register user
- `POST /auth/login` — login, returns Bearer token
- `GET /auth/me` — current user info
- `POST /auth/logout`
- `GET/PUT /users` — user management (CIO only)
- `GET/POST /entries` — daily log entries
- `GET/POST/PUT /reports` — weekly reports; `POST /reports/:id/finalize` (CIO)
- `GET/POST/PUT /risks` — risks, issues, design suggestions
- `GET /network/switches`, `GET /network/vlans` — network reference
- `GET/POST /network/whitelist` — FortiGate web-filter website whitelist (network-admin: cio/network/network_engineer). GET returns config status + current entries; POST adds a URL (defaults action `exempt`). 503 `FORTIGATE_NOT_CONFIGURED` if unset, 502 on FortiGate API/reachability error
- `GET/PUT /network/layout` — saved React Flow node positions (PUT auth, DELETE CIO-only)
- `DELETE /reports/:id` — delete a report (CIO)
- `GET /reports/:id/tickets` — Zendesk-resolved tickets for the report's week
- `GET/POST/PATCH/DELETE /projects` — project CRUD with assignees, attachments, decisions, progress log
- `GET/POST/PATCH/DELETE /azure-vms` — Azure VM inventory (write ops CIO-only)
- `POST /azure-vms/sync` — pull live VM inventory from Azure (CIO only); upserts on `azureResourceId`, preserves manual fields (purpose/notes/owner), flags missing azure rows `status='deleted'`; 503 `AZURE_NOT_CONFIGURED` if unset
- `GET/POST/PUT /after-action` — after-action reports
- `GET /dashboard/summary`, `/activity`, `/week-status`
- `GET /export/report/:id/docx`, `/export/report/:id/xlsx`
- `GET/POST/PATCH/DELETE /cio-shadow-notes` (all CIO-only) — CIO private shadow-memory CRUD. GET filters by `weekOf`/`status` and joins createdBy→user name; PATCH updates content/category/status (open|approved|dismissed); server-side secret-pattern gate rejects credential-like content on create/update.
- `POST /status-report/red-flags` (CIO) — AI scans a week's tasks, entries, risks, incidents, and projects and returns structured `flags[]` plus three ready-to-use formats: `narrative` (Markdown to paste into the report), `riskEntry` (`{type:'issue',severity,title,description}` derived server-side from the flags, ready to POST to /risks), and `alertNote` (concise at-a-glance text). Read-only — never writes; the CIO promotes outputs. 503 if AI unconfigured.
- `GET/POST /ai-knowledge`, `PATCH /ai-knowledge/:id` (auth), `DELETE /ai-knowledge/:id` (CIO) — AI persistent memory CRUD. Server-side secret-pattern gate rejects credential-like content (also enforced in the AI `save_memory` tool). Context loader caps injection at 60k chars and wraps entries in an anti-prompt-injection preamble (`artifacts/api-server/src/lib/ai_knowledge.ts`). AI chats use `runChatWithMemory` (tool loop, max 3 rounds) and return `{reply, savedMemories, createdTasks, networkUpdates, savedShadowNotes}`. Tools the AI can call: `save_memory` (persist a durable fact), `create_task` (capture the signed-in user's work into their weekly `log_items`), `save_shadow_note` (CIO sessions only — persist a private observation into `cio_shadow_notes`, secret-guarded), and — gated to network-admin roles (cio/network/network_engineer) — `upsert_switch` (match by hostname) and `upsert_vlan` (match by numeric vlanId) to keep the switch/VLAN inventory current from chat (partial updates only; create requires the NOT NULL fields). Both chat routes (`/status-report/chat`, `/network/ai-chat`) pass `userRole`; the frontend toasts created tasks (with Undo), network inventory changes, and saved shadow notes. Both chat routes now load a **broadened read-only context** (entries/risks/AARs/projects/strategic objectives/recent tasks/switches/vlans, all with ids — secrets and user credential columns excluded) and instruct the AI to cite sources as in-app Markdown links (e.g. `/risks`, `/after-action/<id>`, `/entries/<id>`, `/projects`, `/network`); the frontend `MarkdownMessage` intercepts root-relative links and navigates via wouter instead of opening a new tab.
- `POST /export/report/:id/zendesk`, `/export/entry/:id/zendesk`

## Auth

- **Primary: Microsoft Entra ID (Azure AD) SSO** — OIDC Authorization Code + PKCE (confidential client). "Sign in with Microsoft" on the login page. Flow: `GET /api/auth/entra/login` (starts PKCE, redirects to Microsoft) → `GET /api/auth/entra/callback` (validates id_token, calls Graph `/me`, gates on IT group/app-role, upserts the user, mints a bearer token, redirects to the SPA `/login?entra_code=<one-time>`) → `POST /api/auth/entra/exchange` (SPA redeems the single-use, 60s code for `{user, token}`). The token is never placed in a URL — only the one-time code is. Public self-registration (`POST /auth/register`) has been removed.
- **Break-glass local login (break-glass accounts only)** — `POST /api/auth/login` (bcrypt) is retained for emergency admin access when SSO is down. Only accounts flagged `is_break_glass` (and with a `passwordHash`) can use it — every other user, including legacy pre-SSO accounts, is rejected and must use Microsoft sign-in. Seed via `BREAKGLASS_EMAIL` / `BREAKGLASS_PASSWORD` env (idempotent startup seeder in `lib/seed_breakglass.ts`; ensures a `cio` role, break-glass-flagged account). On boot, after seeding, `stripNonBreakGlassPasswords()` nulls `password_hash` + reset tokens for all non-break-glass rows so old credentials can't bypass the Entra gate. Forgot/reset-password endpoints are likewise limited to break-glass accounts.
- **Account linking** — Entra identities match an existing row by `entra_object_id`, then by email, so prior history stays attached. New people are created on first sign-in with a role from the title/app-role mapping; existing accounts keep their current role (manual/CIO overrides preserved) and only refresh name/title/object-id.
- **Role mapping** — default job-title-keyword → Hub-role map lives in `lib/entra.ts` (`mapEntraToHubRole`); override/extend via `ENTRA_ROLE_MAP_JSON` (JSON object of keyword-or-app-role → hub role). Applied only on first sign-in. CIO can still override any user's role on the Admin page.
- **Access gate (fail closed)** — `ENTRA_ALLOWED_GROUP_IDS` (group object-ids, via the token `groups` claim) and/or `ENTRA_ALLOWED_APP_ROLES` (app-role values, via the `roles` claim); satisfying either allows entry. If **neither** is set, all SSO sign-ins are **denied** (an error is logged) — an IT membership gate is mandatory. `/auth/entra/status` reports `configured:false` unless both the OIDC client config and a gate value are set, so the login page won't offer a dead-end sign-in.
- **Login CSRF protection** — `/auth/entra/login` sets an httpOnly, SameSite=Lax `entra_state` cookie (path `/api/auth/entra`, `secure` in production) bound to the random `state`; the callback rejects the response unless the returned `state` matches the cookie. Requires `cookie-parser` (registered in `app.ts`).
- Bearer token sessions are persisted in the `sessions` DB table (token PK, user_id FK cascade, created_at, expires_at) so logins survive an API-server restart/redeploy. Expired rows are swept lazily on read and by a periodic cleanup timer. On boot, `ensureSchema()` (`lib/ensure_schema.ts`) idempotently reconciles known self-hosted schema drift: `CREATE TABLE IF NOT EXISTS "sessions"` (+ indexes) and `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL` (SSO users have no local password). `deploy/fix-login-schema.sql` applies the same fixes to an already-running instance without a rebuild.
- `requireAuth` middleware, `requireCIO` for CIO-only routes

### Entra app-registration setup (operator note)

- Register a **Web** app in the SCCC Entra tenant (or reuse the SCCCACR registration). Add redirect URI `https://<hub-host>/api/auth/entra/callback` (must match `ENTRA_REDIRECT_URI` exactly). **HTTPS is mandatory** — Entra rejects non-HTTPS redirect URIs except `localhost`, so plain `http://<ip>` will not work.
- Delegated Microsoft Graph permissions: `openid`, `profile`, `email`, `User.Read`.
- **Required:** configure at least one access-gate value (SSO fails closed without it). Add an **App Role** (and assign users) for `ENTRA_ALLOWED_APP_ROLES`, or configure the token `groups` claim and set `ENTRA_ALLOWED_GROUP_IDS`.
- Env vars: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_REDIRECT_URI`, **at least one of** `ENTRA_ALLOWED_GROUP_IDS` / `ENTRA_ALLOWED_APP_ROLES` (required — SSO fails closed without a gate), optional `ENTRA_ROLE_MAP_JSON`, `ENTRA_POST_LOGIN_REDIRECT` (override the SPA landing URL). These are **separate** from the `AZURE_*` service-principal secrets used for VM inventory.

## Seeded Data

- CIO: `cio@sccc.edu` / `Admin1234!`
- Help Desk: `helpdesk@sccc.edu` / `Staff1234!`
- Network Engineer: `neteng@sccc.edu` / `Staff1234!`
- Security Engineer: `security@sccc.edu` / `Staff1234!`
- 33 network switches from SCCC inventory
- 27 VLANs from SCCC network documentation

## Integrations

- Zendesk: `ZENDESK_SUBDOMAIN=sccc`, `ZENDESK_EMAIL=admin@sccc.edu`, `ZENDESK_API_TOKEN` (secret)
- Zendesk ticket creation via `/export/report/:id/zendesk` and `/export/entry/:id/zendesk`
- Azure: service principal (client-credentials) → ARM. Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SUBSCRIPTION_ID`. SP needs **Reader** at subscription scope. Client lives in `artifacts/api-server/src/lib/azure.ts`; "Sync from Azure" button on the Azure VMs page calls `POST /api/azure-vms/sync`.
- FortiGate: REST API v2 (Bearer token) web-filter URL whitelist. Config env: `FORTIGATE_HOST` (e.g. 192.168.1.1), `FORTIGATE_API_TOKEN` (secret; create a REST API Admin token in FortiGate — a login password is not used), optional `FORTIGATE_VDOM` (default `root`), `FORTIGATE_WEBFILTER_PROFILE` (default `default`), `FORTIGATE_VERIFY_SSL` (default off; set `true` in production with trusted certs). Client lives in `artifacts/api-server/src/lib/fortigate.ts`; "Network Tools" page calls `POST /api/network/whitelist`. **Reachability:** the FortiGate is a private IP, so the API server can only reach it when running on the SCCC network/VPN — off-network calls return 502. Scope is REST webfilter only (no SSH ssl-exempt automation from the original script).

## Export Features

- DOCX export via `docx` npm package
- XLSX export via `exceljs` npm package (multi-sheet: Summary, Weekly Logs, Tasks, Tickets Resolved, Projects, Post-Incident Reviews, Network Maintenance, Goal Progress, Open Risks)
- PDF export via `pdfkit`
- Zendesk ticket creation
- Email Report (CIO): POST `/api/reports/:id/email` sends a PDF or DOCX attachment via SMTP. Requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Returns 503 with EMAIL_NOT_CONFIGURED if missing.
- Shared report builders live in `artifacts/api-server/src/lib/report_export.ts` (used by both export routes and email route).
- Report editor opt-ins persisted on `reports` table: `selectedAfterActionIds`, `selectedMaintenanceIds`, `includeGoalProgress`, `includeOpenRisks`, `emailRecipients`, `lastEmailedAt`.
- Week-scoped extras endpoint: GET `/api/reports/:id/extras` (CIO) returns this week's PIRs, maintenance windows, and a goal-progress snapshot for the report editor cards.

## Frontend Pages

- `/login` — "Sign in with Microsoft" (Entra SSO) primary, with a secondary break-glass email/password form; also handles the SSO callback landing (`?entra_code` / `?entra_error`). Public self-registration removed.
- `/` — Dashboard with summary stats
- `/entries` — Log entries list with search
- `/entries/new` — New log entry form
- `/entries/:id` — Entry detail
- `/reports` — Weekly reports list
- `/reports/:id` — Report detail with finalize/export actions
- `/risks` — Risks, issues, design suggestions
- `/risks/new` — New risk/issue form
- `/network` — Network reference (switches + VLANs) with search tabs
- `/network/tools` — Network Tools (network-admin roles only; nav item hidden for others). Tabbed: FortiGate website whitelist (live API) + client-side PowerShell script generators (Install Printer, Add Laptop, Remove Equipment) that produce copy/download `.ps1` files to run on the target Windows machine (no server execution)
- `/it-apps` — Embeds the external unified project view (apps built for IT) in a sandboxed iframe
- `/after-action` — After-action reports list
- `/after-action/new` — New AAR form
- `/after-action/:id` — AAR detail
- `/admin` — User management (CIO only)
- AI Assistant page (`/ai-report`) tabs: **Status Report** (CIO), **Ask AI** (all), **CIO Insights** (CIO), **AI Memory** (all). Ask AI: each assistant message has a "Capture" button opening a dialog that promotes the excerpt into a My Tasks item (`/log-items`), a Risk/Issue (`/risks`), or a Post-Incident Review (`/after-action`), auto-appending attribution provenance; citation links in AI replies navigate in-app. **CIO Insights** (CIO-only, `cio-insights-tab.tsx`): a week picker, the "Weekly AI Red Flags" generator (calls `/status-report/red-flags`, renders flags + the three formats with one-click Create-risk / Save-alert-to-shadow-memory / Copy actions), and a "Shadow Memory" staging list (add/approve/dismiss/reopen/delete notes, plus "Capture" to promote a note into a tracked record). **AI Memory** tab (all users): search/filter/add/edit/toggle memories, CIO-only delete; chat toasts when the AI saves a memory or shadow note.

## User Preferences

- **Delivery style:** Prefer complete, copy-paste-ready files and runnable scripts over piecemeal snippets/inline edits. Deployment/config assets live in `deploy/` (`.env.production.template`, `configure-o365-sender.ps1`, `deploy.sh`). When config or setup changes, update those files rather than sending fragments to hand-edit.
- **Email sending (self-hosted):** `itech@sccc.edu` is a passwordless service account; send report email via a dedicated licensed sender mailbox (e.g. `it-reporting@sccc.edu`) with SMTP AUTH + "Send As" on `itech` (Option A). `SMTP_FROM=itech@sccc.edu`, `SMTP_USER`=the sender. Azure VM blocks outbound port 25, so only authenticated submission on 587 works.
