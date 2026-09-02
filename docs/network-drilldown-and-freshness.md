# Network drill-down and evidence freshness

The network experience follows the way technicians narrow an incident:

```mermaid
flowchart TD
    C[Campus map] --> B[Building container]
    B --> BP[Building Port Map]
    B --> S[Selected switch]
    S --> SP[Switch Port Map landing view]
    SP --> P[Port evidence and connected peer]
    P --> L[Detailed link records]
```

Visualizer building containers are sized from their current children. Saved
positions remain useful, but historical container dimensions are ignored so a
new switch or VLAN cannot render outside its building boundary.

Fred receives freshness metadata whenever she queries the Network Map overview:

```mermaid
flowchart LR
    T[Telemetry JSON collector] --> TP[(Port telemetry timestamps)]
    C[Configuration import] --> CP[(Config timestamps and backups)]
    TP --> F[Network freshness assessment]
    CP --> F
    F --> A[Current, stale, or never collected per device]
    A --> Fred[Fred identifies the exact devices to update]
```

- Telemetry becomes stale after 36 hours because the expected collection is
  nightly.
- Configuration evidence becomes stale after 90 days and should also be
  refreshed immediately after an approved configuration change.
- Missing evidence is reported as `never_collected` or `not_imported`; it is
  never interpreted as a healthy or known-good device.

## Telemetry run history and delta

The JSON import previews every physical interface against its preceding stored
telemetry observation. Applying the import records the collector `run_id`,
timestamps, failed targets, aggregate counts, affected devices, and individual
operational, administrative, native-VLAN, description, newly observed, and
missing-port changes.

```mermaid
flowchart LR
    C[Python SSH collector] --> J[Aggregate JSON with run ID]
    J --> P[Network Map preview]
    P --> D[Compare with preceding port observations]
    D --> A[Apply successful switch records]
    A --> R[Persist telemetry run and per-port delta]
    R --> U[Last Check Telemetry Changes]
    R --> F[Fred Network Map evidence]
```

An observed up/down delta is historical evidence, not an outage declaration.
Fred must cross-check Monitoring or an approved live probe when a user asks
whether a service or port is currently operational.
