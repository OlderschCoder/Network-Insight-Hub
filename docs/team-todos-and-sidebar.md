# Categorized sidebar and team to-dos

The authenticated portal sidebar uses category dropdowns. The category title is
a normal navigation link to that area's landing page; its chevron independently
expands or collapses the child destinations. Open/closed state remains local to
the browser.

The categories are Status & Reporting, Campus Technology, Troubleshooting, My
Work, IT Apps, and CIO-only Administration. Home application-card titles are
also links, so the title and the existing footer action lead to the same route.

## To-do permissions

Outstanding assignments live in `team_todos`; they do not use `log_items`.
`log_items` remains the completed-work source for weekly-report aggregation.

| User                     | View                     | Create     | Edit/complete/delete | Reassign |
| ------------------------ | ------------------------ | ---------- | -------------------- | -------- |
| Mark or Tracy            | Every active team member | For anyone | Any to-do            | Yes      |
| Other authenticated user | Own assignments only     | For self   | Own to-dos only      | No       |

Authorization is enforced by `/api/todos`, not only by the interface. The
`users.can_manage_todos` capability is initialized for CIO accounts and Tracy's
exact SCCC account during the idempotent startup migration. Authorization never
depends on a display-name match.

To-dos support open, in-progress, and completed states; low, normal, high, and
urgent priorities; optional details; and an optional due date. The API returns
only active users as possible assignees.
