# Campus Operations navigation

The sidebar leads with the systems staff use to understand and narrow an active
campus issue. `Status` is the shared IT Home at `/`.

```mermaid
flowchart TD
    S[Status] --> B[Buildings]
    B --> N[Network Map]
    N --> M[Monitoring]
    M --> P[Cisco Webex Phones]
    P --> A[Azure]
```

The sequence supports a consistent operational investigation: establish overall
state, identify the affected building, inspect its physical network, validate
live telemetry, check voice/E911 service, and then follow cloud dependencies.

The sidebar then moves from operational awareness into personal work and the
applications staff use to act on that work. IT Apps is intentionally adjacent to
My Work rather than buried beneath infrastructure records.

```mermaid
flowchart LR
    C[Campus Operations] --> W[My Work]
    W --> I[IT Apps]
    I --> D[App Directory]
    I --> B[Banner]
    I --> H[High School Students]
    I --> O[Operations]
    O --> N[Infrastructure]
    N --> L[Service / Learn]
```
