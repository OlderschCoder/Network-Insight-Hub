---
name: e2e testing (it-reporting Playwright)
description: How to run the committed Playwright e2e specs and authenticate test users in this repo.
---

# Playwright e2e in artifacts/it-reporting

Committed specs live in `artifacts/it-reporting/tests/*.spec.ts`; run via
`pnpm --filter @workspace/it-reporting exec playwright test`.

## Chromium binary
There is no Playwright browser cache by default. The system provides a Chromium
binary at env var `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`. `playwright.config.ts`
now auto-falls back to that env var when `CHROMIUM_EXECUTABLE_PATH` is unset, so
`pnpm --filter @workspace/it-reporting exec playwright test` works with no extra
env var or manual `playwright install`. Override with `CHROMIUM_EXECUTABLE_PATH`
only if you need a different binary.

Note: do NOT register this as a validation step via `setValidationCommand` in
this repo — it is the only `[workflows.workflow]` entry in `.replit`, so the
system makes it the `runButton` ("Project") and hijacks the Run button away from
the app. Run the suite directly instead.

## Authenticating a test user
**Why:** `POST /api/auth/register` creates a *pending/inactive* account and
returns NO token (CIO-approval flow); login rejects inactive users. Register
also ignores any `role` field and always inserts `helpdesk`.
**How to apply:** register a fresh `@sccc.edu` user (registration is restricted
to that domain), then UPDATE the row in Postgres via `DATABASE_URL` (the `pg`
Pool) to set BOTH `is_active=true` AND the desired `role`, then
`POST /api/auth/login`. Both `timeline-refresh.spec.ts` and
`role-based-ui.spec.ts` use this register→activate(+role)→login pattern.

## Navigation is a command palette, not a sidebar
**Why:** There is no persistent sidebar. The top bar is a `<header>` above
`<main>` holding "Quick Add" / "Ask AI" (the page body has a separate
"Quick Add Item" button, so scope to `header`). All page navigation lives in the
AppLauncher command-palette dialog, opened from the header "Menu — search or jump
to any page" button (or ⌘K). Group labels/items come from `src/config/nav.tsx`
("My Work", "Systems & Tools", "Reports & Records", CIO-only "Leadership &
Admin"); tiles are buttons, so assert by exact label text inside the dialog.
**How to apply:** for nav/role-visibility assertions, open the launcher and query
the `role="dialog"`, don't look for a sidebar/`aside`.

## Seeded accounts
The seeded CIO is NOT `cio@sccc.edu` (replit.md is stale here) — real seed rows
use actual staff names (e.g. `firstname.lastname@sccc.edu`) with unknown
passwords. Don't rely on documented seed credentials; create + activate your own
test user instead.

## Mocking external services
Zendesk-dependent UI flows are tested by mocking the endpoint at the network
layer with `page.route("**/api/zendesk/ticket/*/timeline", ...)`, avoiding live
Zendesk data and ticket-assignee authorization.
