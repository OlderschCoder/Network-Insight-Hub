#!/usr/bin/env python3
"""
collect-lldp.py
SSH to every switch in net_nodes, run LLDP/CDP neighbor commands,
save raw output to seeds/device-configs/<hostname>.sccc.edu

Usage:
  python3 scripts/collect-lldp.py --user admin --password SECRET
  python3 scripts/collect-lldp.py --user admin --password SECRET --host swa-a161
  python3 scripts/collect-lldp.py --user admin --password SECRET --dry-run

After collection, trigger the import:
  npx tsx artifacts/api-server/src/seeds/import_lldp.ts
  (or however the project imports LLDP data)

Dependencies:
  pip3 install paramiko psycopg2-binary --break-system-packages
"""

import argparse
import os
import sys
import time
import socket
import psycopg2
import paramiko
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

DB_DSN = "postgres://sccc:a-strong-password@localhost:5432/sccc_it"

# Output directory — same place the existing seeds live
SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR.parent / "artifacts/api-server/src/seeds/device-configs"

# How long to wait for a command to finish (seconds)
CMD_TIMEOUT = 8

# SSH connection timeout
CONNECT_TIMEOUT = 10

# ── Per-vendor commands ───────────────────────────────────────────────────────

def vendor_commands(vendor: str) -> list[str]:
    v = (vendor or "").lower()
    if "cisco" in v or "nexus" in v:
        return [
            "terminal length 0",
            "show lldp neighbors detail",
            "show cdp neighbors detail",
        ]
    elif "aruba" in v or "hp" in v or "hewlett" in v:
        return [
            "no page",               # disable paging on ArubaOS-CX
            "show lldp neighbors detail",
        ]
    elif "juniper" in v:
        return [
            "show lldp neighbors detail",
        ]
    else:
        # Generic fallback — try both
        return [
            "terminal length 0",
            "show lldp neighbors detail",
            "show cdp neighbors detail",
        ]

# ── SSH collection ────────────────────────────────────────────────────────────

def read_until_idle(chan, timeout: float) -> str:
    """Read from channel until no data arrives for ~1 second or timeout hits."""
    buf = b""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if chan.recv_ready():
            chunk = chan.recv(32768)
            if not chunk:
                break
            buf += chunk
            deadline = time.time() + 1.5  # extend on each receive
        else:
            time.sleep(0.1)
    return buf.decode("utf-8", errors="replace")


def collect_switch(hostname: str, vendor: str, ip: str, user: str, password: str) -> tuple[str, str | None]:
    """
    Returns (output, error_message).
    error_message is None on success.
    """
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        client.connect(
            ip,
            port=22,
            username=user,
            password=password,
            timeout=CONNECT_TIMEOUT,
            look_for_keys=True,    # try SSH keys first (if set up)
            allow_agent=True,
        )
    except (paramiko.AuthenticationException, paramiko.SSHException) as e:
        # Retry without keys (password only)
        try:
            client.connect(
                ip,
                port=22,
                username=user,
                password=password,
                timeout=CONNECT_TIMEOUT,
                look_for_keys=False,
                allow_agent=False,
            )
        except Exception as e2:
            return "", f"auth failed: {e2}"
    except socket.timeout:
        return "", "connection timed out"
    except Exception as e:
        return "", str(e)

    try:
        chan = client.invoke_shell(width=250, height=50)
        time.sleep(1.5)
        read_until_idle(chan, 3)  # drain banner/MOTD

        cmds = vendor_commands(vendor)
        output_parts = [f"=== {hostname}  ip={ip}  vendor={vendor} ===\n"]

        for cmd in cmds:
            chan.send(cmd + "\n")
            result = read_until_idle(chan, CMD_TIMEOUT)
            output_parts.append(f"\n--- {cmd} ---\n")
            output_parts.append(result)

        return "".join(output_parts), None

    except Exception as e:
        return "", f"shell error: {e}"
    finally:
        client.close()

# ── Database ──────────────────────────────────────────────────────────────────

def get_switches(hostname_filter: str | None) -> list[tuple]:
    conn = psycopg2.connect(DB_DSN)
    cur = conn.cursor()

    sql = """
        SELECT hostname, COALESCE(vendor, 'unknown'), mgmt_ip
        FROM net_nodes
        WHERE node_kind IN ('switch', 'router', 'firewall')
          AND mgmt_ip IS NOT NULL
          AND mgmt_ip NOT IN ('0.0.0.0', '')
          AND (status IS NULL OR status != 'offline')
        ORDER BY hostname
    """
    if hostname_filter:
        sql += " AND hostname = %s"
        cur.execute(sql, (hostname_filter,))
    else:
        cur.execute(sql)

    rows = cur.fetchall()
    conn.close()
    return rows

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Collect LLDP/CDP neighbors from all switches")
    parser.add_argument("--user",     required=True,  help="SSH username (same on all switches)")
    parser.add_argument("--password", required=True,  help="SSH password")
    parser.add_argument("--host",     default=None,   help="Single hostname to target (omit for all)")
    parser.add_argument("--dry-run",  action="store_true", help="List targets without connecting")
    args = parser.parse_args()

    switches = get_switches(args.host)
    if not switches:
        print("No switches found in net_nodes (check mgmt_ip values).")
        sys.exit(1)

    print(f"Targets: {len(switches)} switch(es)\n")

    if args.dry_run:
        for hostname, vendor, ip in switches:
            print(f"  {hostname:30s}  {ip:20s}  {vendor}")
        sys.exit(0)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    ok, failed = [], []

    for hostname, vendor, ip in switches:
        print(f"  {hostname} ({ip}) ...", end="", flush=True)

        output, err = collect_switch(hostname, vendor, ip, args.user, args.password)

        out_file = OUTPUT_DIR / f"{hostname}.sccc.edu"

        if err:
            print(f" FAILED — {err}")
            # Write an error marker so you can see which ones need attention
            out_file.write_text(f"# COLLECTION FAILED — {err}\n# hostname={hostname} ip={ip}\n")
            failed.append((hostname, ip, err))
        else:
            out_file.write_text(output)
            lines = output.count("\n")
            print(f" OK ({lines} lines → {out_file.name})")
            ok.append(hostname)

    print(f"\n{'='*50}")
    print(f"Done: {len(ok)} collected, {len(failed)} failed")

    if failed:
        print("\nFailed hosts:")
        for hostname, ip, err in failed:
            print(f"  {hostname:30s}  {ip:20s}  {err}")
        print("\nCommon causes: switch doesn't have SSH enabled, wrong IP in net_nodes,")
        print("firewall blocking port 22, or different credentials on that device.")

    if ok:
        print(f"\nFiles written to: {OUTPUT_DIR}")
        print("\nNext step — run the LLDP import:")
        print("  cd /opt/sccc-it")
        print("  npx tsx artifacts/api-server/src/seeds/import_device_configs.ts")


if __name__ == "__main__":
    main()
