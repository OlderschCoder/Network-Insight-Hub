# FortiGate inventory and port telemetry

Fred represents the Main and West FortiGates as `firewall` nodes, not as switches.

| Device | Management IP | Building | Expected model |
| --- | --- | --- | --- |
| FortigateA-Sccc | 192.168.1.1 | Hobble | FortiGate-1801F |
| WestCampus-Fortigate | 172.25.0.1 | West Campus | FortiGate-90G |

## What each Fred view means

- Network Nodes gets identity, device kind, role, and the node-detail UUID from `net_nodes`.
- Operational status and last-seen data remain sourced from the existing inventory and monitoring pipeline.
- Port Map lists switches, routers, and firewalls. A firewall with no imported interface rows is shown with an explicit “no telemetry” state; Fred never invents a faceplate.
- The snapshot banner describes the newest imported network-telemetry run, including switch or firewall collection. A snapshot older than 24 hours is labeled historical and must not be read as current device health.

## Enabling collection

SNMPv3 must be enabled independently on each FortiGate interface that receives requests from the collector at `10.0.0.22`. Use the existing collector SNMPv3 account and secrets; do not store them in source control or Fred notes. FortiGate polling must be read-only.

After the device-side access and collector target are configured, verify from the collector:

```bash
snmpwalk -v3 -l authPriv -u MonitorUser -a SHA -A '<AUTH_PASSWORD>' -x AES -X '<PRIV_PASSWORD>' 172.25.0.1 1.3.6.1.2.1.1
```

Use `192.168.1.1` for Main. A successful system walk proves SNMP reachability, not that Fred has imported interface rows. Confirm a new import run and then check Port Map for a current telemetry timestamp.

Do not change HA membership, fail over, reset tunnels, reboot, synchronize peers, or alter routing as part of telemetry onboarding.

## Complete collector configuration

The operator-held `C:\Code\Fred\telegraf.conf` is the protected 45-target working baseline. The central Fred operations catalog requires 52 canonical agents: 50 physical switches and both FortiGates. Reconciliation adds eleven missing physical-switch management addresses and retires four duplicate SVI polling aliases. The local deployment gate must pass before the candidate can be uploaded.

Each IP must occur exactly once. Keep the site/vendor-specific blocks separate so Telegraf does not double-write interface metrics. The configuration contains operational secrets and must not be committed to source control. Deploy it with `C:\Code\Fred\telegraf-deployment\Deploy-TelegrafConfig.ps1`, which backs up the remote working file, tests an isolated candidate, verifies the Compose services, and automatically restores the backup after a failed promotion.

## Inventory normalization

Run the normalization script in dry-run mode first, then apply it with the production `DATABASE_URL` already loaded into the environment:

```bash
node scripts/apply-fortigate-inventory.mjs
node scripts/apply-fortigate-inventory.mjs --apply
```

The apply path requires both devices to exist in both inventory tables, saves before/after evidence under `backups/`, and updates only the two rows selected by management IP.
