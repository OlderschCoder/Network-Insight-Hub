# Building-first network support flow

The default support journey begins with the affected place rather than requiring
staff to know a hostname, VLAN, or port before they start. Existing topology and
port evidence remain available at progressively deeper levels.

```mermaid
flowchart LR
    M[Campus status map] -->|select marker| B[Building detail]
    M --> A[Health-sorted building cards]
    A -->|select building| B
    B --> C[Switches and monitored devices]
    B --> D[VLANs and subnets]
    B --> G[Building-scoped physical Port Map]
    C -->|select switch| E[Node detail]
    E --> F[Links and upstream path]
    E --> G
    F --> H[Core / firewall evidence]

    classDef start fill:#ecfdf5,stroke:#22c55e,color:#14532d;
    classDef expert fill:#eff6ff,stroke:#3b82f6,color:#1e3a8a;
    class A,M start;
    class E,F,G,H expert;
```

## Interaction rule

Building cards and campus-map markers use a normal single selection. This keeps
the flow usable with a mouse, keyboard, touch display, and assistive technology.
The Port Map is preserved without simplification because its port-level evidence
is valuable during engineering work.
