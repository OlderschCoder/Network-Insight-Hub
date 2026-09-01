# Shared IT Home

All authenticated IT staff use the same `/` homepage and operational context.
Role checks govern privileged actions rather than selecting a different page.

```mermaid
flowchart TD
    U[Authenticated IT user] --> H[Shared IT Home]
    H --> L[Learn]
    H --> M[My Work]
    H --> O[Operational status]
    H --> Z[Zendesk and team status]
    H --> R{Authorized CIO?}
    R -->|Yes| E[Enterprise Architecture action]
    R -->|No| S[Shared staff experience]
```

This keeps the information architecture consistent for Mark and the rest of the
team while preserving authorization boundaries for CIO-only capabilities.
