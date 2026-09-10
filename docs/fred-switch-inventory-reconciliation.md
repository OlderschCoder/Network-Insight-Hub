# Fred switch inventory reconciliation

Fred stores a switch's campus grouping separately from its precise physical label. The `building` value drives building cards, map grouping, and health summaries. The `location` value preserves the operator-supplied label, including a switch name in parentheses.

The complete physical-switch reconciliation is maintained by `scripts/reconcile-fred-canonical-switches.mjs`. It reads the central device catalog and the collector inventory, then makes every monitoring-required physical switch resolvable by one canonical hostname and management IP in both `net_nodes` and `network_switches`.

The two tables deliberately serve different consumers:

- `net_nodes` powers Fred's topology, Network Map, and grounded AI context.
- `network_switches` powers the switch inventory and the native NOC monitoring dashboard.

The native NOC dashboard joins current live observations onto `network_switches`. A physical switch without a current observation remains visible with `unknown` status; a failed live probe remains `down`. Inventory presence is never presented as proof of reachability.

The nine September 10, 2026 assignments remain maintained by `scripts/ensure-fred-switch-inventory.mjs`. All nine are physical Aruba access switches. Those operator-supplied labels are authoritative locations. For the other switches, the complete reconciliation preserves a richer existing location and uses the collector location only when inserting a missing record or filling a blank value.

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

## Complete inventory preview

Run the script without `--apply`. It reads both inventories, matches rows by canonical IP or normalized hostname, and reports inserts, updates, and identity conflicts without changing the database.

```bash
node --env-file=.env.production scripts/reconcile-fred-canonical-switches.mjs \
  --catalog /path/to/devices.csv \
  --collector-inventory /path/to/all-switches.csv
```

The catalog must contain exactly 49 `monitoring_required=true` switch rows. The collector inventory must contain each corresponding enabled IP once. Duplicate or split IP/hostname identities stop the run.

## Complete inventory apply

After reviewing a conflict-free preview, apply the same inputs:

```bash
node --env-file=.env.production scripts/reconcile-fred-canonical-switches.mjs \
  --catalog /path/to/devices.csv \
  --collector-inventory /path/to/all-switches.csv \
  --apply
```

The apply path writes before-and-after evidence under `backups/fred-canonical-switches-<timestamp>/`, preserves row IDs when an SVI or legacy address must move to the canonical management IP, inserts genuinely missing records with `unknown` status, rolls back on any failed change, and validates all 49 switches in both tables after commit. It never deletes aliases or historical rows. The evidence directory can contain internal inventory details and must not be committed.

When the deployed application directory is read-only to the operator, stage the script in a writable directory and set `FRED_APP_ROOT` plus `FRED_INVENTORY_BACKUP_ROOT`. The script still loads Fred's installed `pg` package from the application root while keeping evidence in the operator-owned backup directory.

## Exact location correction

Use the narrower nine-switch script when reconciling only the operator-approved September 10 location labels. Run a read-only preview first from the deployed application root:

```bash
node --env-file=.env.production scripts/ensure-fred-switch-inventory.mjs
```

Apply the transaction only after all nine IPs appear once in both inventories:

```bash
node --env-file=.env.production scripts/ensure-fred-switch-inventory.mjs --apply
```

The narrow apply path writes before-and-after evidence under `backups/fred-switch-inventory-<timestamp>/`, aborts when either table is missing or duplicates an IP, rolls back on any failed update, and validates every building, location, role, vendor, and node type after commit.

See [fred-switch-inventory-flow.mmd](fred-switch-inventory-flow.mmd) for the data flow.
