#!/usr/bin/env python3
"""
collect-lldp-local.py
Run this on a CAMPUS machine that can reach the switches directly.

Usage:
  python collect-lldp-local.py --user admin --password SECRET
  python collect-lldp-local.py --user admin --password SECRET --host swa-a161

Reads switch list from: switches.csv (same folder as this script)
Saves output to:        lldp-output\  (same folder as this script)

After collection, copy the lldp-output\ folder to the appserver and run:
  cp lldp-output/* /opt/sccc-it/artifacts/api-server/src/seeds/device-configs/
  npx tsx artifacts/api-server/src/seeds/import_device_configs.ts

Dependencies (run once):
  pip install paramiko
"""

import argparse, sys, time, socket, csv
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CSV_FILE   = SCRIPT_DIR / "switches.csv"
OUTPUT_DIR = SCRIPT_DIR / "lldp-output"
CMD_TIMEOUT     = 10
CONNECT_TIMEOUT = 12

try:
    import paramiko
except ImportError:
    print("Missing dependency. Run:  pip install paramiko")
    sys.exit(1)


def vendor_commands(vendor):
    v = (vendor or "").lower()
    if "cisco" in v or "nexus" in v:
        return ["terminal length 0", "show lldp neighbors detail", "show cdp neighbors detail"]
    elif "aruba" in v or "hp" in v:
        return ["no page", "show lldp neighbors detail"]
    elif "fortinet" in v or "forti" in v:
        return ["get system status", "diagnose lldp neighbor-summary"]
    else:
        return ["terminal length 0", "show lldp neighbors detail", "show cdp neighbors detail"]


def read_until_idle(chan, timeout):
    buf = b""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if chan.recv_ready():
            chunk = chan.recv(32768)
            if not chunk:
                break
            buf += chunk
            deadline = time.time() + 1.5
        else:
            time.sleep(0.1)
    return buf.decode("utf-8", errors="replace")


def collect_switch(hostname, vendor, ip, user, password):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(ip, port=22, username=user, password=password,
                       timeout=CONNECT_TIMEOUT, look_for_keys=False, allow_agent=False)
        chan = client.invoke_shell(width=250, height=50)
        time.sleep(1.5)
        read_until_idle(chan, 3)  # drain banner

        cmds = vendor_commands(vendor)
        parts = [f"=== {hostname}  ip={ip}  vendor={vendor} ===\n"]
        for cmd in cmds:
            chan.send(cmd + "\n")
            result = read_until_idle(chan, CMD_TIMEOUT)
            parts.append(f"\n--- {cmd} ---\n")
            parts.append(result)
        return "".join(parts), None

    except socket.timeout:
        return "", "connection timed out"
    except paramiko.AuthenticationException:
        return "", "authentication failed — check credentials"
    except Exception as e:
        return "", str(e)
    finally:
        client.close()


def load_switches(hostname_filter):
    if not CSV_FILE.exists():
        print(f"ERROR: {CSV_FILE} not found.")
        print("Create it with columns: hostname,ip,vendor")
        sys.exit(1)

    rows = []
    with open(CSV_FILE, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ip = row["ip"].strip()
            hostname = row["hostname"].strip()
            if ip in ("TBD", "0.0.0.0", "", "10.0.0.0"):
                continue  # skip placeholders
            if hostname_filter and hostname != hostname_filter:
                continue
            rows.append((hostname, row["vendor"].strip(), ip))
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user",     required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--host",     default=None)
    parser.add_argument("--dry-run",  action="store_true")
    args = parser.parse_args()

    switches = load_switches(args.host)
    if not switches:
        print("No valid switches found in switches.csv")
        sys.exit(1)

    print(f"Targets: {len(switches)} switch(es)\n")

    if args.dry_run:
        for hostname, vendor, ip in switches:
            print(f"  {hostname:35s}  {ip:20s}  {vendor}")
        sys.exit(0)

    OUTPUT_DIR.mkdir(exist_ok=True)
    ok, failed = [], []

    for hostname, vendor, ip in switches:
        print(f"  {hostname} ({ip}) ...", end="", flush=True)
        output, err = collect_switch(hostname, vendor, ip, args.user, args.password)
        out_file = OUTPUT_DIR / f"{hostname}.sccc.edu"
        if err:
            print(f" FAILED — {err}")
            out_file.write_text(f"# COLLECTION FAILED — {err}\n# hostname={hostname} ip={ip}\n")
            failed.append((hostname, ip, err))
        else:
            out_file.write_text(output)
            print(f" OK ({output.count(chr(10))} lines)")
            ok.append(hostname)

    print(f"\nDone: {len(ok)} collected, {len(failed)} failed")
    if failed:
        print("\nFailed:")
        for h, ip, err in failed:
            print(f"  {h:35s}  {ip:20s}  {err}")

    if ok:
        print(f"\nOutput saved to: {OUTPUT_DIR.resolve()}")
        print("\nNext — copy to appserver and import:")
        print("  scp lldp-output/* itadmin@52.238.214.132:/opt/sccc-it/artifacts/api-server/src/seeds/device-configs/")
        print("  ssh itadmin@52.238.214.132")
        print("  cd /opt/sccc-it && npx tsx artifacts/api-server/src/seeds/import_device_configs.ts")


if __name__ == "__main__":
    main()
