# Insights portal UI architecture

The authenticated Insights experience uses a hub-and-spoke shell while preserving the existing API, authentication, authorization, reporting, network, Zendesk, monitoring, and Fred workflows.

## Routes

| Route      | App                | Purpose                                                          |
| ---------- | ------------------ | ---------------------------------------------------------------- |
| `/`        | Home               | Cross-app command center with live summary data and Fred         |
| `/status`  | Status & Reporting | Existing dashboard data and actions in the new KPI layout        |
| `/network` | IT Tools & Network | Existing network reference with a clearer tab/card structure     |
| `/support` | Troubleshooting    | Live Zendesk activity and links to existing diagnostic workflows |

The other established routes remain unchanged. The sidebar mode switcher is a fast context jump, not a replacement for role-aware navigation.

## Behavior preservation

- Home, Status, and Troubleshooting consume generated React API hooks or the authenticated fetch helper.
- The Status quick-add action still opens the existing `QuickAddItemDialog`; report, review, and export actions route to the established workflows.
- The Troubleshooting page reads the existing Zendesk recent-activity endpoint and launches existing monitoring, network, incident, process, learning, telephony, and student-access routes.
- Fred remains the existing `/ai-report` experience. Home and Troubleshooting may prefill its composer through a URL prompt, but they do not create a second chat implementation.
- Fred now uses typed, confirmation-gated application tools for Zendesk tickets, Post-Incident Reviews, weekly logs, and CIO-only weekly status reports. Her live application-guidance tool reads the current seeded portal instructions. See [Fred application actions](fred-application-actions.md).
- Existing role checks remain in `ProtectedRoute` and the role-aware navigation configuration.

## Visual system

Portal color and status roles are defined as CSS custom properties in the frontend theme. The sidebar remains dark in both themes; the content theme can be switched from the top bar and is stored locally. Status indicators always pair color with a text label.

See [portal-ui-architecture.mmd](portal-ui-architecture.mmd) for the editable route and data-flow diagram.
