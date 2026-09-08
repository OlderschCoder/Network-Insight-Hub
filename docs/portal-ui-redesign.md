# Insights portal UI architecture

The authenticated Insights experience uses a hub-and-spoke shell while preserving the existing API, authentication, authorization, reporting, network, Zendesk, monitoring, and Fred workflows.

## Routes

| Route              | App                | Purpose                                                           |
| ------------------ | ------------------ | ----------------------------------------------------------------- |
| `/`                | Home               | Cross-app command center with live summary data and Fred          |
| `/status`          | Status & Reporting | Existing dashboard data and actions in the new KPI layout         |
| `/network`         | IT Tools & Network | Existing network reference with a clearer tab/card structure      |
| `/support`         | Troubleshooting    | Live Zendesk activity and links to existing diagnostic workflows  |
| `/support/zendesk` | Troubleshooting    | Conversation Log monitor with shared, editable Fred approval drafts |
| `/quick-start`     | Troubleshooting    | Ten-minute orientation to navigation, daily work, Zendesk, and Fred |
| `/user-guide`      | Troubleshooting    | Full step-by-step platform guide                                  |

The other established routes remain unchanged. Role-aware category dropdowns
live in the global top menu. Each category title navigates to its landing page,
while its separate chevron opens the destination list.

## Behavior preservation

- Home, Status, and Troubleshooting consume generated React API hooks or the authenticated fetch helper.
- The Status quick-add action still opens the existing `QuickAddItemDialog`; report, review, and export actions route to the established workflows.
- The Troubleshooting page reads the existing Zendesk recent-activity endpoint and launches existing monitoring, network, incident, process, learning, telephony, and student-access routes. Its Zendesk Monitor refreshes the open queue and shared drafts every 15 seconds and the selected Conversation Log every 5 seconds. Fred can prepare one observation-only draft or work through up to 25 loaded open tickets, skipping pending, staff-last, internal-only, existing-draft, and escalation-only cases. Another staff member edits and approves every saved reply. Support-channel drafts can be approved and sent from Insights; Messaging drafts are copied into Zendesk Agent Workspace for the final human send on the current Suite Growth plan. Global supervisor switches can pause Fred's Zendesk actions or block public replies at the API without disabling confirmed human escalation.
- Fred remains the existing `/ai-report` experience. Home and Troubleshooting may prefill its composer through a URL prompt, but they do not create a second chat implementation.
- Fred now uses typed, confirmation-gated application tools for team to-dos, Zendesk tickets, Post-Incident Reviews, weekly logs, and CIO-only weekly status reports. Her live application-guidance tool reads the current seeded portal instructions. See [Fred application actions](fred-application-actions.md).
- Existing role checks remain in `ProtectedRoute` and the role-aware navigation configuration.
- Quick Start, Learn, Process Library, and User Guide are grouped under the
  Troubleshooting dropdown. The same Quick Start route is linked from the
  Support Center so training remains easy to find after the navigation redesign.

## Visual system

Portal color and status roles are defined as CSS custom properties in the frontend theme. The global top menu remains dark in both themes; the content theme can be switched from the top bar and is stored locally. Status indicators always pair color with a text label.
Light building cards and campus-map callouts use explicit dark foregrounds in
both themes; health color is carried by borders, icons, and status dots rather
than low-contrast text.

See [portal-ui-architecture.mmd](portal-ui-architecture.mmd) for the editable route and data-flow diagram.
See [quick-start-training-flow.mmd](quick-start-training-flow.mmd) for the
editable training and Fred-knowledge flow.
