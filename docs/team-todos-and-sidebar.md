# Top-menu categories and team to-dos

The authenticated portal uses category dropdowns in the top menu. Each category
title is a normal navigation link to that area's landing page; its separate
chevron opens the dropdown destinations. The old category dropdowns are no
longer rendered in a left sidebar.

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

Fred uses the same authorization boundary. `query_team_todos` returns only the
records the signed-in user may view. `manage_team_todo` creates, edits,
completes, or reassigns an exact to-do only after confirmation. Reassignment is
available only to Mark and Tracy.

To-dos support open, in-progress, and completed states; low, normal, high, and
urgent priorities; optional details; and an optional due date. The API returns
only active users as possible assignees.
