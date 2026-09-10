# Fred switch inventory reconciliation

Fred stores a switch's campus grouping separately from its precise physical label. The `building` value drives building cards, map grouping, and health summaries. The `location` value preserves the operator-supplied label, including a switch name in parentheses.

The nine September 10, 2026 assignments are maintained by `scripts/ensure-fred-switch-inventory.mjs`. All nine are physical Aruba access switches. The reconciliation updates both `net_nodes` and `network_switches` in one transaction so Fred's Network Map, inventory, building summaries, and AI context agree.

| Management IP    | Building group     | Exact location label                        |
| ---------------- | ------------------ | ------------------------------------------- |
| `172.25.0.2`     | West Campus        | West Campus (SW-WestCampus-1)               |
| `172.25.0.3`     | West Campus        | West Campus Truck Driving (SW-WestCampus-2) |
| `172.25.0.11`    | West Campus        | West ALC ALC-B                              |
| `172.25.0.92`    | West Campus        | West Reception (SW-Reception)               |
| `192.168.2.26`   | Student Union      | Student Union Cafeteria (SW-Cafe)           |
| `192.168.2.50`   | Student Activities | Student Activities Gym Instant Replay       |
| `192.168.2.194`  | Student Activities | Student Activities (SW-SA208)               |
| `192.168.2.200`  | Student Union      | Student Union (SWA-SU121)                   |
| `192.168.252.46` | Student Activities | Student Union Gym 208 (SUGymCam)            |

## Safe execution

Run a read-only preview first from the deployed application root:

```bash
node --env-file=.env.production scripts/ensure-fred-switch-inventory.mjs
```

Apply the transaction only after all nine IPs appear once in both inventories:

```bash
node --env-file=.env.production scripts/ensure-fred-switch-inventory.mjs --apply
```

The apply path writes before-and-after evidence under `backups/fred-switch-inventory-<timestamp>/`, aborts when either table is missing or duplicates an IP, rolls back on any failed update, and validates every building, location, role, vendor, and node type after commit. The evidence directory can contain internal inventory details and must not be committed.

When the deployed application directory is read-only to the operator, stage the script in a writable directory and set `FRED_APP_ROOT` plus `FRED_INVENTORY_BACKUP_ROOT`. The script still loads Fred's installed `pg` package from the application root while keeping evidence in the operator-owned backup directory.

See [fred-switch-inventory-flow.mmd](fred-switch-inventory-flow.mmd) for the data flow.
