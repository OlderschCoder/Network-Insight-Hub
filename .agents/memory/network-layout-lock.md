---
name: Network diagram shared-layout lock
description: Why the topology edit lock must be enforced server-side, not just in the UI.
---

The shared network topology diagram (`/network` visualize) is edited by multiple
users writing to one shared `network_layout_positions` table. It uses a
short-TTL advisory edit lock (`network_layout_lock`, singleton id=1).

**Rule:** An advisory lock polled client-side is NOT enough to prevent clobbering.
`PUT /api/network/layout` must itself reject writes (409 `LAYOUT_LOCKED`) when
another user holds a live lock. `resetLayout` must snapshot + delete inside a
single DB transaction.

**Why:** A client can begin a drag on stale (up-to-20s-old) poll state and still
issue a save after another user acquired the lock; without a server check the
conflicting write lands. A non-transactional reset can wipe a concurrent write
before it's captured in the snapshot, making restore lossy. Both gaps were caught
in code review and closed.

**How to apply:** Any new mutation of the shared layout must call
`getLockStatus` and 409 when `locked && !heldByMe`. Keep snapshot-then-delete /
snapshot-restore operations transactional.
