# Building management

Fred treats buildings as operational groupings shared by the Network Map, switch inventory, VLAN inventory, and campus-status map.

## Editing buildings

Authenticated users can:

- create a building from **Network > Buildings > Add Building**;
- rename a building from **Manage Buildings** or its detail page;
- move a device from the device table by choosing **Move** and entering an existing or new building;
- move a VLAN from the VLAN table;
- show or hide a building on the campus map without removing it from inventory;
- delete a building only after all map nodes, switch-inventory records, and VLANs have moved elsewhere.

The Buildings page keeps the campus map and status cards prominent. Use the **Manage Buildings** button in the page header to open the rename, remove, and map-visibility controls in a dialog; the management table does not occupy permanent space above the map.

A device move updates both `net_nodes` and `network_switches` in one transaction. If the destination is new, Fred creates its building-master record automatically. This prevents the Network Map and live-health summary from disagreeing about the device's building.

Map visibility is stored separately from building existence. Hidden buildings remain available in search, detail pages, reports, and switch/VLAN assignment lists. New buildings receive a movable campus-map marker by default; hide it when the site should remain inventory-only. Removing a built-in empty building writes a tombstone so it does not quietly reappear from the default list, and adding it again restores it.

Campus-map positions support the encoded identifiers used by user-created buildings, including names longer than the legacy 20-character overlay-code limit.

## Mansions

`Mansions` is an authoritative building and is visible on the campus map. Its switches are:

| Hostname | Management IP | Location |
| --- | --- | --- |
| `SWA-SLAB` | `192.168.2.176` | Student Living AB |
| `SWA-SLCDE` | `192.168.2.177` | Student Living DE |

`SWA-SLC151` remains in Student Living Center.

## Student-area authority

The former `Student Union / Student Activities` grouping is retired. The authoritative assignments are:

| Building | Switches |
| --- | --- |
| Student Union | `SWA-SU121`, `SW-Cafe` |
| Student Activities | `SW-SA208`, `SUGymCam`, `SW-SA208-Replay` |

Hostname-aware canonicalization keeps these assignments separate even when older telemetry contains the combined label. The combined building is omitted from the map after its node, switch, and VLAN counts reach zero.

## One-time reconciliation

Run the reconciliation in preview mode first:

```bash
node --env-file=.env.production scripts/apply-student-building-split.mjs
```

Apply only after reviewing the five-row plan:

```bash
node --env-file=.env.production scripts/apply-student-building-split.mjs --apply
```

The script writes before-and-after evidence under `backups/student-building-split-<timestamp>/`, updates both inventories transactionally, creates missing map nodes from switch inventory, and removes the obsolete building-master marker only when the combined building is empty.

The Mansions reconciliation uses the same dry-run/apply pattern:

```bash
node --env-file=.env.production scripts/apply-mansions-building.mjs
node --env-file=.env.production scripts/apply-mansions-building.mjs --apply
```

See [building-management-flow.mmd](building-management-flow.mmd) for the data flow.
