---
name: e2e testing (it-reporting Playwright)
description: How to run the committed Playwright e2e specs and authenticate test users in this repo.
---

# Playwright e2e in artifacts/it-reporting

Committed specs live in `artifacts/it-reporting/tests/*.spec.ts`; run via
`pnpm --filter @workspace/it-reporting exec playwright test`.

## Chromium binary
There is no Playwright browser cache by default. The system provides a Chromium
binary at env var `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`, and the playwright
config honors `CHROMIUM_EXECUTABLE_PATH`. Run with:
`CHROMIUM_EXECUTABLE_PATH="$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE" pnpm exec playwright test`.

## Authenticating a test user
**Why:** `POST /api/auth/register` now creates a *pending/inactive* account and
returns NO token (CIO-approval flow); login rejects inactive users. The older
`role-based-ui.spec.ts` still assumes register returns a token, so it is broken.
**How to apply:** register a fresh `@sccc.edu` user (registration is restricted
to that domain), flip `is_active=true` directly in Postgres via `DATABASE_URL`
(the `pg` Pool), then `POST /api/auth/login`. See `timeline-refresh.spec.ts` for
the working `registerActivateLogin` helper.

## Seeded accounts
The seeded CIO is NOT `cio@sccc.edu` (replit.md is stale here) — real seed rows
use actual staff names (e.g. `firstname.lastname@sccc.edu`) with unknown
passwords. Don't rely on documented seed credentials; create + activate your own
test user instead.

## Mocking external services
Zendesk-dependent UI flows are tested by mocking the endpoint at the network
layer with `page.route("**/api/zendesk/ticket/*/timeline", ...)`, avoiding live
Zendesk data and ticket-assignee authorization.
