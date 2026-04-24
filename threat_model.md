# Threat Model

## Project Overview

SCCC IT Department Reporting Platform is an internal web application for a small IT team to record weekly work, incidents, risks, network changes, and projects, then aggregate that data into executive reports and exports. The production system is a pnpm workspace with an Express 5 API in `artifacts/api-server`, a React + Vite SPA in `artifacts/it-reporting`, and a shared PostgreSQL/Drizzle data layer in `lib/db`.

Production scope for this scan is limited to the API server, the reporting frontend, shared libraries they import, deployment/config files that can expose production secrets, and supporting integrations such as Zendesk, SMTP, and OpenAI. `artifacts/mockup-sandbox` is a development-only sandbox and should be ignored unless later evidence shows it is reachable in production.

## Assets

- **User accounts and sessions** — employee identities, password hashes, bearer session tokens, and role assignments. Compromise would allow impersonation or escalation to CIO privileges.
- **Internal reporting data** — weekly entries, log items, reports, after-action reviews, risks, projects, process documents, and maintenance history. These records contain sensitive internal operations and security information.
- **Infrastructure inventory** — switch records, VLANs, network layout positions, Azure VM inventory, and related notes. Exposure would reveal internal network topology and asset details.
- **Integration credentials and secrets** — database credentials, Zendesk API credentials, SMTP credentials, OpenAI keys, and any other deployment secrets. Compromise would enable unauthorized third-party access or data exfiltration.
- **Generated exports and outbound messages** — PDF/DOCX/XLSX exports, emailed reports, and Zendesk submissions. These outputs may contain sensitive internal data and must be scoped to authorized users.

## Trust Boundaries

- **Browser to API** — the React SPA and any direct API clients send untrusted input to `/api/*`. The server must authenticate and authorize every sensitive operation.
- **API to PostgreSQL** — the API has broad access to the shared database. Injection or missing row-level authorization at this boundary could expose the full dataset.
- **API to external services** — the server talks to Zendesk, SMTP providers, and AI providers with privileged credentials. Outbound requests and payload construction must not leak secrets or permit misuse.
- **Public to authenticated** — `/api/auth/register`, `/api/auth/login`, and `/api/healthz` are public; nearly everything else is meant to require authentication.
- **Authenticated to CIO/admin** — CIO-only routes guard user management, report finalization, exports to Zendesk, project administration, and some destructive actions. This role boundary must be enforced server-side.
- **Production to dev-only tooling** — `artifacts/mockup-sandbox` and local-only developer conveniences are out of scope unless proven reachable from deployed production paths.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/it-reporting/src/main.tsx`, `artifacts/it-reporting/src/App.tsx`
- **Highest-risk code areas:** `artifacts/api-server/src/routes/auth.ts`, route files under `artifacts/api-server/src/routes/`, export/email/Zendesk helpers in `artifacts/api-server/src/lib/` and related routes, shared DB schema in `lib/db/src/`
- **Public surface:** `/api/healthz`, `/api/auth/register`, `/api/auth/login`
- **Authenticated surface:** most `/api/*` routes for entries, reports, projects, risks, network data, exports, dashboard, Zendesk, processes, and Azure VMs
- **Admin surface:** CIO-only actions in users, reports, projects, strategic objectives, selected export/email actions, and some layout deletion endpoints
- **Usually ignore unless proven reachable:** `artifacts/mockup-sandbox/**`

## Threat Categories

### Spoofing

The application uses email/password login with server-side bearer-token sessions stored in memory and client-side token storage in the SPA. The API must only mint sessions for legitimate users, reject forged or expired credentials, and ensure public registration cannot be abused to create privileged accounts.

### Tampering

Users can create and update reports, entries, risks, projects, network inventory, maintenance logs, and other operational records. The API must validate all input and enforce ownership or role checks server-side so users cannot alter other users’ data, protected inventory, or CIO-managed records.

### Information Disclosure

This platform stores sensitive internal operational data, network topology, Azure VM details, and after-action/security reporting. API responses, export routes, email generation, logs, and third-party integrations must not reveal data outside the authenticated user’s scope, and secrets must never be committed to source files or exposed through responses.

### Denial of Service

Public authentication endpoints and authenticated export/integration routes can trigger relatively expensive work such as password verification, report generation, email delivery, Zendesk calls, and AI-assisted processing. The production system should avoid unauthenticated access to expensive operations and should bound requests that could consume disproportionate CPU, memory, or third-party quota.

### Elevation of Privilege

The most important risk in this project is movement from ordinary staff privileges to CIO/admin capabilities or unauthorized access to other users’ internal data. Every route that reads or mutates user-scoped data must enforce server-side ownership checks, and every privileged function must verify CIO role membership independent of frontend state.
