# Sidebar navigation and team to-dos

The authenticated portal opens on four Home workspaces: Status & Reporting, IT
Tools & Network, IT Apps, and Troubleshooting. Inner pages use a fixed,
role-aware sidebar for detailed destinations. The workspace switcher at the top
of that sidebar keeps all four modes—including Apps—directly reachable.

Sidebar groups include Status & Reporting, Campus Technology,
Troubleshooting, My Work, IT Apps, and CIO-only Administration. Home
application-card titles are also links, so the title and the existing footer
action lead to the same route.

## To-do permissions

Outstanding assignments live in `team_todos`; they do not use `log_items`.
`log_items` remains the completed-work source for weekly-report aggregation.

| User                           | View                     | Create     | Edit/complete/delete | Reassign |
| ------------------------------ | ------------------------ | ---------- | -------------------- | -------- |
| Account with Manage Todos      | Every active team member | For anyone | Any to-do            | Yes      |
| Other authenticated user       | Own assignments only     | For self   | Own to-dos only      | No       |

Authorization is enforced by `/api/todos`, not only by the interface. The
`users.can_manage_todos` capability is the explicit permission; CIO accounts
also qualify. Authorization never depends on a display-name or job-title match.

Fred uses the same authorization boundary. `query_team_todos` returns only the
records the signed-in user may view. `manage_team_todo` creates, edits,
completes, or reassigns an exact to-do only after confirmation. Team-wide
management and reassignment require the same Manage Todos capability.

To-dos support open, in-progress, and completed states; low, normal, high, and
urgent priorities; optional details; and an optional due date. The API returns
only active users as possible assignees.
