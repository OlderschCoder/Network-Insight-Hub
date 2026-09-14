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

## Verification

Run the focused policy and solved-window tests:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/lib/weekly_report_entry_policy.test.ts \
  src/lib/zendesk_solved_window.test.ts
```
