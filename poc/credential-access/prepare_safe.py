"""Copy encrypted recovery artifacts. Use --print-envelope only in a private local console."""
from pathlib import Path
import argparse
import json
import os
import shlex
import shutil
import subprocess
import paramiko

STATE = "/home/scccadmin/.local/share/fred-credential-poc"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--print-envelope", action="store_true")
    args = parser.parse_args()
    destination = args.destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        identity = subprocess.check_output(["whoami"], text=True).strip()
        subprocess.run(["icacls", str(destination), "/inheritance:r", "/grant:r",
                        identity + ":(OI)(CI)F", "*S-1-5-18:(OI)(CI)F",
                        "*S-1-5-32-544:(OI)(CI)F"], check=True, stdout=subprocess.DEVNULL)
    ssh = paramiko.SSHClient()
    ssh.load_host_keys(str(Path.home() / ".ssh/known_hosts"))
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    ssh.connect("app-server2.centralus.cloudapp.azure.com", username="scccadmin",
                key_filename=r"C:\Code\Aruba\IT_Hub.pem", timeout=15)
    try:
        with ssh.open_sftp() as sftp:
            package = sftp.file(STATE + "/safe.recovery.json", "rb").read()
            private = sftp.file(STATE + "/recovery-private.pem", "rb").read()
        (destination / "safe.recovery.json").write_bytes(package)
        (destination / "recovery-private.pem").write_bytes(private)
        root = Path(__file__).resolve().parent
        for name in ("recover_offline.py", "README.md", "requirements.txt"):
            shutil.copy2(root / name, destination / name)
        document = json.loads(package)
        print("Encrypted safe kit copied. Version:", document["version"], "Created:", document["createdAt"])
        print("Prepare and test the recovery laptop offline; refresh this physical copy after rotations.")
        if args.print_envelope:
            # Never invoke this option in Codex, a transcript, or a recording.
            script = f"""import sys
sys.path.insert(0,'/home/scccadmin/apps/fred-credential-poc/releases/'+sys.argv[1])
from broker import Vault,unseal
vault=Vault({STATE!r})
sys.stdout.write(unseal((vault.directory/'recovery-unlock.vault').read_bytes(),vault.key)['unlock'])
"""
            _, out, _ = ssh.exec_command("systemctl show fred-credential-poc -p WorkingDirectory --value", timeout=10)
            release = out.read().decode().strip().rsplit("/", 1)[-1]
            if not release or not all(c in "0123456789TZ" for c in release):
                raise RuntimeError("Unexpected POC release path")
            _, out, _ = ssh.exec_command("python3 -c " + shlex.quote(script) + " " + shlex.quote(release), timeout=10)
            password = out.read().decode()
            if not password:
                raise RuntimeError("Recovery unlock unavailable")
            print("\nFOR THE SEALED ENVELOPE — KEEP OFF CHAT AND EMAIL\n")
            print(password)
            input("\nRecord this privately, then press Enter to close this console.")
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
