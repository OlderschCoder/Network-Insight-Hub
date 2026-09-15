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

## Building health colors

The Buildings page, the shared Monitoring map, and Fred use the same
fail-closed connectivity evidence:

- **Green** means every monitored switch assigned to the building has a fresh
  online observation.
- **Amber** means one or more switches are degraded, down, or missing evidence,
  but a complete building outage has not been proved.
- **Red** means an operator-enabled, explicitly designated main/anchor switch is
  down and complete Webex evidence confirms every assigned physical phone is
  offline. Disabled anchor candidates and a building's only switch are never
  silently promoted to the main switch.
- **Unknown** means there is no usable fresh switch evidence. Inventory values
  and missing phone results are never guessed into an operational state.

A completed NOC probe takes priority over Influx. Influx can fill in only when
its latest observation is no more than 90 seconds old, preventing an old “up”
heartbeat from hiding a fresh negative probe. Phone corroboration is complete
only when every building assignment maps to a returned physical phone; laptops,
room video devices, partial pages, and unmatched owners cannot prove “all
phones down.”

Phone assignments use the current authoritative building names before applying
the narrow legacy-alias map. This keeps exact locations such as Student Living G
and Tech Building A separate while still translating older combined labels such
as Student Living A&B to Mansions. Concurrent map, card, and Fred requests share
one in-flight Webex read and a short cache, so a page refresh does not multiply
the same tenant-wide device crawl.

The unauthenticated building-summary endpoint publishes only the building name,
display counts, health color, and whether Influx is configured. Phone counts,
assignment completeness, observation timestamps, and main-switch evidence stay
behind authenticated routes. This lets the public campus map show status without
exposing the operational evidence Fred and IT staff use to make that decision.

## Shared campus-map layout

Buildings and Monitoring render the same `CampusStatusMap` component and read
the same persisted `/api/network/buildings/map-layout` records. Layout reads are
served with `Cache-Control: no-store`; each open view refreshes on focus, tab
visibility, a save/reset notification, and a 30-second safety interval. Editing
remains in Buildings, while Monitoring is a live consumer of that canonical
saved layout. Monitoring also derives its **Campus Map Green** count and overall
status from that same loaded layout, so a hidden marker is not counted as an
active map exception. Mark and Tracy, as CIO users, open **Edit Map** on the Buildings
page to move markers and use the **Building visibility** controls. **Save Map**
persists both position and visibility; other roles can read the map but cannot
change this operational view.

The write contract accepts both the short built-in marker codes and URL-encoded
`CUSTOM:<building name>` identifiers up to 200 characters, so newly
administered buildings can be positioned, hidden, and restored without losing
their stable identity. Visibility uses metadata rows in the existing
`network_layout_positions` table, avoiding a production schema dependency. The
reader also translates legacy `building-hidden:<building name>` rows. Resetting
the layout removes saved positions and visibility metadata, so every default
marker becomes visible again. Visibility omitted by an older cached editor is
treated as "leave the current setting alone"; only an explicit `true` or
`false` changes a marker's visibility.

`Mansions` is a default visible marker (`MAN`). Its observed switch pair is
`SWA-SLAB` (`192.168.2.176`) and `SWA-SLCDE` (`192.168.2.177`); these assignments
remain separate from Student Living Center. See
[shared-campus-map-flow.mmd](shared-campus-map-flow.mmd).
