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

- `users` — id, name, email, passwordHash, role (cio/helpdesk/network/security/network_engineer/security_engineer/staff), department, isActive
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
- `POST /export/report/:id/zendesk`, `/export/entry/:id/zendesk`

## Auth

- Email/password with bcrypt
- Bearer token sessions (in-memory Map — tokens reset on server restart)
- `requireAuth` middleware, `requireCIO` for CIO-only routes

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

- `/login` — Email/password login
- `/register` — New user registration
- `/` — Dashboard with summary stats
- `/entries` — Log entries list with search
- `/entries/new` — New log entry form
- `/entries/:id` — Entry detail
- `/reports` — Weekly reports list
- `/reports/:id` — Report detail with finalize/export actions
- `/risks` — Risks, issues, design suggestions
- `/risks/new` — New risk/issue form
- `/network` — Network reference (switches + VLANs) with search tabs
- `/network/tools` — Network Tools: FortiGate website whitelist (network-admin roles only; nav item hidden for others)
- `/it-apps` — Embeds the external unified project view (apps built for IT) in a sandboxed iframe
- `/after-action` — After-action reports list
- `/after-action/new` — New AAR form
- `/after-action/:id` — AAR detail
- `/admin` — User management (CIO only)
