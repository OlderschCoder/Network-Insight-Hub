# Deploy folder — copy-paste-free setup

Everything needed to configure and roll out the SCCC IT Reporting Hub on the
Azure VM, so we stop editing snippets by hand.

| File | What it does |
|---|---|
| `.env.production.template` | Full production config — every variable the app reads, non-secret IDs pre-filled, `<...>` placeholders for secrets only. |
| `configure-o365-sender.ps1` | Microsoft 365 (Exchange Online) setup for **Option A** email: dedicated sender mailbox + SMTP AUTH + "Send As" `itech@sccc.edu`. |
| `deploy.sh` | Build from source and roll out to `/opt/sccc-it`, then restart the service. |
| `noc_probe_agent.py` | Restricted probe used by FRED on `10.0.0.22`; supports bounded ping, TCP, and read-only LLDP/SNMP collection. |
| `configure_noc_probe_snmp.py` | Builds root-owned SNMPv3 profiles from the working local Telegraf configuration without printing credentials. |
| `sccc-noc-probe.env.template` | Root-only probe settings, including allowed target networks and collection limits. |

## 1. Configure the email sender (one time, in M365)

1. In the Microsoft 365 admin center, create a **licensed** user, e.g.
   `it-reporting@sccc.edu`, with a strong password (clear "must change at next
   sign-in").
2. Exclude that account from MFA / Security Defaults / Conditional Access (basic
   SMTP AUTH is blocked otherwise — see notes in the `.ps1`).
3. Run `configure-o365-sender.ps1` as an Exchange/Global admin to enable SMTP
   AUTH and grant "Send As" on `itech@sccc.edu`.

## 2. Write the environment file (on the VM)

```bash
sudo cp deploy/.env.production.template /opt/sccc-it/.env.production
sudo nano /opt/sccc-it/.env.production      # replace every <...> secret
sudo chown root:root /opt/sccc-it/.env.production
sudo chmod 600 /opt/sccc-it/.env.production
sudo systemctl restart sccc-api
```

`SMTP_USER` = the new sender's own address, `SMTP_PASS` = its password,
`SMTP_FROM=itech@sccc.edu` (delivered via the Send As grant).

## 3. Deploy code changes

```bash
SRC=~/Network-Insight-Hub ./deploy/deploy.sh
```

## Login fails right after "Sign in with Microsoft" (`relation "sessions" does not exist`)

The production database is missing schema changes that exist in the code
(the `sessions` table, and a nullable `users.password_hash`). Deploying the
current code applies these automatically on service start. To fix an
already-running instance immediately, without waiting for a rebuild:

```bash
psql "$DATABASE_URL" -f deploy/fix-login-schema.sql
# or, if you administer Postgres locally:
#   sudo -u postgres psql -d <db_name> -f deploy/fix-login-schema.sql
sudo systemctl restart sccc-api
```

The script is idempotent — safe to run even if the schema is already correct.

## Verify / troubleshoot

```bash
sudo systemctl status sccc-api --no-pager
sudo journalctl -u sccc-api -n 30 --no-pager | grep -iv 'systemd\['
```

- `535 5.7.139 Authentication unsuccessful` → SMTP AUTH still disabled on the
  sender, or MFA/Security Defaults blocking it.
- `5.7.60 ... send as this user` → the "Send As" grant on `itech` is missing or
  hasn't propagated yet.
- Full deployment/security reference: `docs/azure-vm-deployment-runbook.md`.

## FRED LLDP collector on 10.0.0.22

The collector is deliberately a typed API, not remote shell access. FRED sends
the management IPs of switches already present in Network Map. The probe runs
numeric-OID `snmpwalk` requests from `10.0.0.22`, and the Hub records confirmed
port-to-port links. Unknown LLDP neighbors are reported for review and are not
automatically added as trusted devices.

On `10.0.0.22`, install or update the probe once:

```bash
sudo apt-get update && sudo apt-get install -y snmp
scp scccadmin@10.0.0.44:/home/scccadmin/apps/Network-Insight-Hub/deploy/noc_probe_agent.py /tmp/noc_probe_agent.py
scp scccadmin@10.0.0.44:/home/scccadmin/apps/Network-Insight-Hub/deploy/configure_noc_probe_snmp.py /tmp/configure_noc_probe_snmp.py
sudo cp -a /opt/sccc-noc-probe/noc_probe_agent.py /opt/sccc-noc-probe/noc_probe_agent.py.pre-lldp
sudo python3 /tmp/configure_noc_probe_snmp.py
sudo install -o root -g root -m 0755 /tmp/noc_probe_agent.py /opt/sccc-noc-probe/noc_probe_agent.py
sudo systemctl restart sccc-noc-probe.service
curl -fsS http://10.0.0.22:9123/health
```

The configurator reads the SNMPv3 `authPriv` profiles already used by the local
Docker Telegraf collector and writes root-owned Net-SNMP profiles under
`/etc/sccc-noc-probe-snmp`. Secrets are not copied into the Hub, printed, or
passed on a command line. Keep `/etc/sccc-noc-probe.env` owned by root with mode
`600`. A ready collector reports `"lldpCollector": true`, `"snmpVersion": "3"`,
and the configured-target count from the health endpoint.

After switch configurations have been uploaded and the Network Map inventory
contains their management IPs, tell FRED:

> Run the approved LLDP collector from 10.0.0.22 against every configured
> switch. Record confirmed port-to-port links in Network Map. Do not create
> nodes for unmatched neighbors; list them for review. Report responding
> switches, failures, and links inserted or refreshed.
