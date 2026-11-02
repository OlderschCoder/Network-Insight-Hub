"""Explicit CIO-authorized operator pilot over existing SSH, not a team SSO bypass."""
from pathlib import Path
import argparse
import json
import shlex
import hashlib
import getpass
import paramiko
from deploy_poc import env, SOURCE, STATE


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--reset-current", action="store_true",
                        help="Owner-requested reset of the enrolled pilot; prompts without echo")
    args = parser.parse_args()
    if not args.apply:
        print("Plan only: change existing admin on AA151-CIO, verify, save, and refresh encrypted recovery. No other target is allowed.")
        return
    private = env(r"C:\Code\Aruba\.env")
    if private.get("Default_test_user") != "admin":
        raise RuntimeError("The supplied account does not match the approved pilot")
    replacement = (getpass.getpass("Requested replacement password (hidden): ")
                   if args.reset_current else private["Default_test_pass"])
    if not replacement or any(c in replacement for c in "\r\n\x00"):
        raise RuntimeError("A nonempty single-line replacement is required")
    ssh = paramiko.SSHClient()
    ssh.load_host_keys(str(Path.home() / ".ssh/known_hosts"))
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    ssh.connect("app-server2.centralus.cloudapp.azure.com", username="scccadmin",
                key_filename=r"C:\Code\Aruba\IT_Hub.pem", timeout=15)
    try:
        _, out, _ = ssh.exec_command("systemctl show fred-credential-poc -p WorkingDirectory --value", timeout=10)
        release = out.read().decode().strip()
        if not release.startswith("/home/scccadmin/apps/fred-credential-poc/releases/"):
            raise RuntimeError("Unexpected POC release")
        with ssh.open_sftp() as sftp:
            for filename in ("broker.py", "service.py", "aruba_adapter.py"):
                local = (SOURCE / filename).read_bytes().replace(b"\r\n", b"\n")
                remote = sftp.file(release + "/" + filename, "rb").read().replace(b"\r\n", b"\n")
                if hashlib.sha256(local).digest() != hashlib.sha256(remote).digest():
                    raise RuntimeError("POC source differs from deployment; stop before applying")
        # Resolve Mark's actual existing identity/role. Never manufacture a Hub
        # session or borrow another person's token. This operator run is separately
        # authorized by Mark in Codex and executed through his existing SSH access.
        node = r'''
const fs=require('fs');const {createRequire}=require('module');
const root='/home/scccadmin/apps/Network-Insight-Hub';
const requireApi=createRequire(root+'/artifacts/api-server/package.json');
const {Client}=requireApi('pg');
const line=fs.readFileSync(root+'/.env.production','utf8').split(/\r?\n/).find(x=>x.startsWith('DATABASE_URL='));
if(!line)throw Error('Database configuration missing');
let url=line.slice(line.indexOf('=')+1).trim();if((url[0]==='"'&&url.endsWith('"'))||(url[0]==="'"&&url.endsWith("'")))url=url.slice(1,-1);
(async()=>{const client=new Client({connectionString:url});await client.connect();
try{const result=await client.query('SELECT id,name,email,role,entra_object_id AS "entraObjectId",is_active AS "isActive",is_break_glass AS "isBreakGlass" FROM users WHERE lower(email)=lower($1)',['mark.bojeun@sccc.edu']);
if(result.rows.length!==1)throw Error('Owner identity is not unique');process.stdout.write(JSON.stringify(result.rows[0]));}
finally{await client.end();}})().catch(()=>{process.exitCode=1;});
'''
        script = f"""import sys,json,subprocess
sys.path.insert(0,{release!r})
from broker import Vault,unseal,seal,atomic,exclusive,now,authorize,event
from service import build,notifier,TARGET
vault=Vault({STATE!r})
config=unseal((vault.directory/'configuration.vault').read_bytes(),vault.key)
supplied=json.load(sys.stdin)
reset_current={args.reset_current!r}
if not reset_current:config['Default_test_pass']=supplied['password']
actor=json.loads(subprocess.check_output(['node','-e',{node!r}],timeout=20))
authorize(actor,owner=True)
actor['name']=actor['name']+' (CIO-authorized operator pilot)'
broker=build(vault.directory,config)
with exclusive(vault.directory/'vault.lock'):
 state=vault.read()
 if not reset_current and TARGET['ip'] in state['targets']:raise RuntimeError('Target already staged/enrolled; review before proceeding')
 if reset_current:
  record=state['targets'][TARGET['ip']]
  if record['state']!='ready' or record.get('checkout'):raise RuntimeError('Target is checked out or requires review; no change made')
  broker.adapter.verify(record,record['current'])
  record['pending']=supplied['password'];record['state']='reset-pending'
  event(state,actor,TARGET['ip'],'cio-requested-reset-staged')
 state.setdefault('operatorAuthorizations',[]).append({{'at':now(),'requestedById':actor['id'],'target':TARGET['ip'],'channel':'Existing administrator SSH; explicit CIO request in Codex','scope':'Owner-requested supplied password reset' if reset_current else 'Apply supplied initial password only; no checkout or generated reset'}})
 vault.save(state)
atomic(vault.directory/'configuration.vault',seal(config,vault.key))
if reset_current:
 result=broker._rotate(authorize(actor,owner=True),TARGET['ip'])
else:
 broker.stage(actor,TARGET,config['CURRENT_ADMIN_PASSWORD'],config['Default_test_pass'])
 result=broker.apply_staged(actor,TARGET['ip'])
broker.deliver(notifier(config))
result['recovery']=vault.safe_test()
result['notifications']=[{{'action':row['action'],'status':row['status']}} for row in vault.read()['outbox']]
print(json.dumps(result))
"""
        compile(script, "authorized-pilot", "exec")
        stdin, out, _ = ssh.exec_command(
            "/home/scccadmin/apps/fred-credential-poc/venv/bin/python -c " + shlex.quote(script), timeout=240)
        stdin.write(json.dumps({"password": replacement}))
        stdin.flush()
        stdin.channel.shutdown_write()
        result = out.read().decode()
        if out.channel.recv_exit_status():
            raise RuntimeError("Pilot did not complete. Review encrypted state before retrying; device output withheld.")
        print(result)
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
