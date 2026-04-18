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
- `entries` — id, userId, category, title, description, accomplishments, challenges, supportNeeded, ticketCount, weekOf, entryDate, tags, isSubmitted
- `reports` — id, weekOf, isFinalized, summary, finalizedAt, finalizedBy
- `risks` — id, userId, type (risk/issue/design), severity, status, title, description, mitigation
- `network_switches` — id, hostname, building, ipAddress, model, status, configFile, notes
- `vlans` — id, vlanId, name, description, building, type, subnet, gateway
- `after_action_reports` — id, userId, title, incidentDate, outcome, summary, timeline, whatWentWell, whatWentPoorly, actionItems

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

## Export Features

- DOCX export via `docx` npm package
- XLSX export via `exceljs` npm package
- Zendesk ticket creation

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
- `/after-action` — After-action reports list
- `/after-action/new` — New AAR form
- `/after-action/:id` — AAR detail
- `/admin` — User management (CIO only)
