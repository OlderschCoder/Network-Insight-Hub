"""Deploy only the isolated POC. No device password change occurs during deployment."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import json
import shlex
import sys
import paramiko

SOURCE = Path(__file__).resolve().parent
REMOTE = "/home/scccadmin/apps/fred-credential-poc"
STATE = "/home/scccadmin/.local/share/fred-credential-poc"


def env(path):
    result = {}
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            result[k.strip()] = v.strip().strip('"').strip("'")
    return result


def run(ssh, command, payload=None, timeout=240):
    stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    if payload is not None:
        stdin.write(payload)
        stdin.flush()
    stdin.channel.shutdown_write()
    out, err = stdout.read().decode(), stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if code:
        # Remote command diagnostics are intentionally withheld: an adapter or
        # package exception could contain credential material.
        raise RuntimeError("Deployment/preflight step failed (exit " + str(code) + ")")
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--deploy", action="store_true")
    args = parser.parse_args()
    if not args.deploy:
        print("Plan: isolated SSO-protected sidecar + page. Live adapter: AA151-CIO only. No credential changes during deployment.")
        return
    test = env(r"C:\Code\Aruba\.env")
    current = env(r"C:\Code\FredOps\local\.env")
    if test.get("Default_test_user") != "admin" or not test.get("Default_test_pass"):
        raise RuntimeError("The private test entries must contain the existing admin account and its proposed password")
    if current.get("SWITCH_USER_FALLBACK") != "admin" or not current.get("SWITCH_PASS_FALLBACK"):
        raise RuntimeError("Existing pilot login is unavailable")
    config = {k: test[k] for k in ("Default_test_user", "Default_test_pass", "NOC_User", "NOC_Pwrd")}
    config["CURRENT_ADMIN_PASSWORD"] = current["SWITCH_PASS_FALLBACK"]
    ssh = paramiko.SSHClient()
    ssh.load_system_host_keys()
    ssh.load_host_keys(str(Path.home() / ".ssh/known_hosts"))
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    ssh.connect("app-server2.centralus.cloudapp.azure.com", username="scccadmin",
                key_filename=r"C:\Code\Aruba\IT_Hub.pem", timeout=15)
    try:
        release = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        directory = REMOTE + "/releases/" + release
        bootstrap = f"""import pathlib,os,subprocess,json,urllib.request
os.umask(0o077)
root=pathlib.Path({REMOTE!r}); state=pathlib.Path({STATE!r}); release=pathlib.Path({directory!r})
root.mkdir(parents=True,exist_ok=True);os.chmod(root,0o755)
(root/'releases').mkdir(exist_ok=True);os.chmod(root/'releases',0o755)
release.mkdir();os.chmod(release,0o755)
state.mkdir(parents=True,exist_ok=True);os.chmod(state,0o700)
subprocess.run(['python3','-m','venv','--without-pip',str(root/'venv')],check=True,stdout=subprocess.DEVNULL)
if not (root/'pip.pyz').exists(): urllib.request.urlretrieve('https://bootstrap.pypa.io/pip/pip.pyz',root/'pip.pyz')
"""
        run(ssh, "python3 -c " + shlex.quote(bootstrap))
        sftp = ssh.open_sftp()
        for name in ("broker.py", "aruba_adapter.py", "service.py", "requirements.txt", "index.html", "recover_offline.py", "test_broker.py", "README.md"):
            sftp.put(str(SOURCE / name), directory + "/" + name)
            sftp.chmod(directory + "/" + name, 0o644)
        # Import only the two required existing trust anchors, never accept new keys.
        keys = paramiko.HostKeys(str(Path.home() / ".ssh/known_hosts"))
        with sftp.file("/home/scccadmin/.ssh/known_hosts") as stream:
            for line in stream.read().decode().splitlines():
                try:
                    entry = paramiko.hostkeys.HostKeyEntry.from_line(line)
                    if entry:
                        for hostname in entry.hostnames:
                            keys.add(hostname, entry.key.get_name(), entry.key)
                except Exception:
                    pass
        lines = []
        for host in ("10.0.0.22", "192.168.252.173"):
            known = keys.lookup(host)
            if not known:
                raise RuntimeError("An approved pilot/jump-host SSH trust anchor is missing")
            lines.extend(host + " " + kind + " " + key.get_base64() for kind, key in known.items())
        with sftp.file(STATE + "/known_hosts", "w") as stream:
            stream.write("\n".join(lines) + "\n")
        sftp.chmod(STATE + "/known_hosts", 0o600)
        sftp.close()
        run(ssh, REMOTE + "/venv/bin/python " + REMOTE + "/pip.pyz install --disable-pip-version-check -q -r " + directory + "/requirements.txt")
        run(ssh, "cd " + shlex.quote(directory) + " && " + REMOTE + "/venv/bin/python -m unittest -q test_broker.py")
        seed = f"""import sys,json,pathlib,os
sys.path.insert(0,{directory!r})
from broker import Vault,atomic,seal
from service import build,load_env,TARGET
state=pathlib.Path({STATE!r}); vault=Vault(state);vault.initialize_recovery()
config=json.load(sys.stdin)
live=load_env('/home/scccadmin/apps/Network-Insight-Hub/.env.production')
for name in ('SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','SMTP_FROM'):
 if live.get(name):config[name]=live[name]
broker=build(state,config)
broker.adapter.verify(TARGET,config['CURRENT_ADMIN_PASSWORD'])
atomic(state/'configuration.vault',seal(config,vault.key))
print(json.dumps({{'pilotOldLoginVerified':True,'smtpConfigured':all(config.get(k) for k in ('SMTP_HOST','SMTP_USER','SMTP_PASS')),'recovery':vault.safe_test()}}))
"""
        print(run(ssh, REMOTE + "/venv/bin/python -c " + shlex.quote(seed), json.dumps(config)))
        deploy = f"""from pathlib import Path
import os,subprocess,shutil
root=Path({REMOTE!r});release=Path({directory!r});backup=root/'backups'/{release!r}
backup.mkdir(parents=True);os.chmod(backup,0o700)
snippet='''\n    location = /credential-poc/ {{ return 302 /credential-poc; }}
    location = /credential-poc {{
        alias {directory}/index.html;
        default_type text/html;
        add_header Cache-Control "no-store" always;
        add_header Content-Security-Policy "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" always;
    }}
    location ^~ /api/fred-credentials-poc/ {{
        proxy_pass http://127.0.0.1:9137;
        proxy_read_timeout 180s;
        access_log off;
    }}
'''
files=[('/etc/nginx/sites-enabled/appserver2','server_name app-server2.centralus.cloudapp.azure.com;'),('/etc/nginx/sites-available/sccc-public-subdomains','server_name insights.sccc.edu itinsights.sccc.edu;')]
originals=[]
for filename,anchor in files:
 path=Path(filename);text=path.read_text()
 if 'location = /credential-poc' in text: raise RuntimeError('Existing POC deployment requires explicit review')
 start=text.index(anchor);position=text.index('location /api/ {{',start)
 originals.append((path,text));shutil.copy2(path,backup/path.name)
 path.write_text(text[:position]+snippet+'\\n    '+text[position:])
unit=Path('/etc/systemd/system/fred-credential-poc.service')
if unit.exists(): raise RuntimeError('POC unit already exists')
unit.write_text('''[Unit]
Description=Fred credential-access single-switch POC
After=network-online.target sccc-api.service
[Service]
User=scccadmin
WorkingDirectory={directory}
Environment=FRED_POC_STATE={STATE}
ExecStart={REMOTE}/venv/bin/python {directory}/service.py
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths={STATE}
UMask=0077
[Install]
WantedBy=multi-user.target
''')
try:
 subprocess.run(['nginx','-t'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['systemctl','daemon-reload'],check=True)
 subprocess.run(['systemctl','start','fred-credential-poc'],check=True)
 subprocess.run(['systemctl','is-active','--quiet','fred-credential-poc'],check=True)
 subprocess.run(['systemctl','reload','nginx'],check=True)
except Exception:
 for path,text in originals:path.write_text(text)
 subprocess.run(['nginx','-t'],check=True)
 subprocess.run(['systemctl','reload','nginx'],check=True)
 raise
print('POC deployed; no device credential changed. Nginx backup: '+str(backup))
"""
        # No credentials appear in this script or command. sudo changes only the
        # two backed-up nginx files and the new dedicated systemd unit.
        compile(deploy, "remote-poc-deployment", "exec")
        print(run(ssh, "sudo python3 -c " + shlex.quote(deploy)))
    finally:
        ssh.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(str(error))
