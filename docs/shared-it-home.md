# Shared IT Home

All authenticated IT staff use the same `/` command center. It presents the
four first-class workspaces without changing their established authorization,
data, or operational behavior. Apps is a peer of Status, Network, and
Troubleshooting—not a utility hidden below them.

```mermaid
flowchart TD
    U[Authenticated IT user] --> H[Home command center]
    H --> S[Status and Reporting]
    H --> N[IT Tools and Network]
    H --> A[IT Apps and App Directory]
    H --> T[Troubleshooting]
    H --> F[Fred urgent-item greeting]
    S --> R{Authorized CIO?}
    R -->|Yes| E[Enterprise Architecture action]
    R -->|No| W[Shared reporting experience]
```

Live summary hooks drive the Home cards and Status dashboard. IT Apps reuses
the existing directory, internal routes, and approved external links.
Troubleshooting uses the existing Zendesk activity endpoint and established
tool routes. The inner-page workspace switcher keeps Apps directly reachable
in every mode.
