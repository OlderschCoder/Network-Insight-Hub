# Weekly-report submission policy

## Purpose

The explicit **Save Draft**, **Submit Weekly Log**, and **Return to Draft**
controls became authoritative at `2026-09-14T17:30:00Z`. Before that release,
the user interface offered only **Save Weekly Log**, while the database's
`is_submitted` field defaulted to false. Treating every false legacy value as a
draft would remove previously visible staff work from historical reports.

Insights therefore uses one eligibility rule everywhere a department report or
submission status is calculated:

- `is_submitted = true` is eligible, regardless of update time.
- An unsubmitted weekly log whose `updated_at` is before the cutover remains
  eligible as a grandfathered legacy log.
- An unsubmitted weekly log whose `updated_at` is at or after the cutover is a
  draft and is excluded.
- An invalid or missing `updated_at` fails closed unless the log is explicitly
  submitted.

The rule is implemented by
`artifacts/api-server/src/lib/weekly_report_entry_policy.ts`. It is shared by:

- weekly-report aggregate/preview and finalization counts;
- PDF, DOCX, and spreadsheet report exports;
- report attachments sent by email;
- report publication to Zendesk;
- home/dashboard submission status; and
- Fred's CIO weekly red-flag analysis.

The report editor also receives a complete submission checklist for the active
reporting roster. The checklist includes people with no weekly-log row, not
only contributors returned by the entries query. Missing people are named near
the top of the report and distinguished as **No weekly log** or **Draft not
submitted**, so a missing CIO contribution cannot quietly blend into a lower
contributor count.

Completed-work items follow their owner's weekly-log eligibility. Items owned by
a user whose weekly log is still a draft are excluded from the report editor and
all outputs. A previously saved `selected_item_ids` list may narrow eligible
items, but it cannot re-include an item belonging to a draft user. Individual
work views remain unchanged.

No legacy data is backfilled or rewritten. If someone opens a grandfathered log
and chooses **Return to Draft** (or otherwise saves it as a draft), the write
sets `is_submitted = false` and refreshes `updated_at`; the log then leaves every
department-report output. Choosing **Submit Weekly Log** sets
`is_submitted = true` and includes it again.

## Zendesk solved tickets

Weekly report exports query Zendesk by the ticket's solved timestamp using the
half-open interval `[weekOf, weekOf + 7 days)`. They do not use `updated_at`, so
a later comment or ticket edit cannot move solved work into or out of its actual
reporting week. The API applies the same bounded solved-date query to the report
editor and exported files.

The report editor's headline **Zendesk Tickets Solved** metric, its export
preview, its per-assignee ticket section, and the exported document all use
that same group-wide Zendesk result. The headline is not the sum of ticket IDs
attached to submitted weekly logs; that narrower value can omit a teammate who
has not submitted a log and must not masquerade as the department total. While
the Zendesk request is loading or unavailable, the editor shows an unknown
value instead of a misleading zero.

Zendesk pagination is complete-or-error. Every `next_page` must remain on the
configured tenant's exact HTTPS `/api/v2/` origin, repeated pages and the page
limit fail closed, and agent credentials are never forwarded to another host or
non-API path. A failed or incomplete page therefore produces an unavailable
report response rather than a partial count that looks authoritative.

## Verification

Run the focused policy and solved-window tests:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/lib/weekly_report_entry_policy.test.ts \
  src/lib/zendesk_solved_window.test.ts \
  src/lib/zendesk_report_tickets.test.ts

pnpm --filter @workspace/it-reporting exec vitest run --config vitest.config.ts \
  src/lib/weekly_report_overview.test.ts
```
