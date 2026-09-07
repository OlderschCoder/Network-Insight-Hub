# Shared IT Home

All authenticated IT staff use the same `/` command center. It presents the
three primary app contexts without changing their established authorization,
data, or operational behavior.

```mermaid
flowchart TD
    U[Authenticated IT user] --> H[Home command center]
    H --> S[Status and Reporting]
    H --> N[IT Tools and Network]
    H --> T[Troubleshooting]
    H --> F[Fred urgent-item greeting]
    S --> R{Authorized CIO?}
    R -->|Yes| E[Enterprise Architecture action]
    R -->|No| W[Shared reporting experience]
```

Live summary hooks drive the Home cards and Status dashboard. Troubleshooting
uses the existing Zendesk activity endpoint and established tool routes.
