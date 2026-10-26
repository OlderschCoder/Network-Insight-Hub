#!/usr/bin/env python3
"""Reviewed code-only pilot deployment. Default invocation is read-only."""
import argparse, hashlib, json, os, pathlib, re, subprocess, sys, tarfile, time
import urllib.error, urllib.request

BASE=pathlib.Path('/home/scccadmin/building-probe-pilot.q5v2xuvp')
LIVE=pathlib.Path('/home/scccadmin/apps/Network-Insight-Hub')
CANDIDATE=BASE/'candidate-v2'
ORIGIN='https://app-server2.centralus.cloudapp.azure.com'
MANIFEST_SHA='4a04db49c71ba264ce08671172be0f4753fce457f7c978f802418dcd2cf95e07'
FLAGS=('BUILDING_PROBES_ENABLED','BUILDING_PROBE_SCHEDULER_ENABLED','BUILDING_PROBE_THROUGHPUT_TARGET_READY','BUILDING_PROBE_CAPACITY_ENABLED')
DIST=('artifacts/api-server/dist','artifacts/it-reporting/dist/public')
ENV_FILES=(str(LIVE/'.env.production'),'/etc/sccc-building-diagnostics/api.env','/etc/sccc-api-secrets.env','/etc/sccc-api-webex.env')
SERVICE='sccc-api'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def require(condition,message):
 if not condition:raise RuntimeError(message)
def command(args,capture=False):
 p=subprocess.run(args,text=True,capture_output=True)
 require(p.returncode==0,'Command failed: '+args[0]+' '+(args[1] if len(args)>1 else ''))
 return p.stdout if capture else ''
def sudo(*args,capture=False):return command(['sudo','-n',*args],capture=capture)
def proc_environment():
 pid=command(['systemctl','show',SERVICE,'-p','MainPID','--value'],True).strip()
 require(pid.isdigit() and int(pid)>1,'API is not running')
 data=(pathlib.Path('/proc')/pid/'environ').read_bytes().decode()
 env=dict(x.split('=',1) for x in data.split('\0') if '=' in x)
 require(all(env.get(k,'false')=='false' for k in FLAGS),'A phase-one feature flag is not explicitly false or absent')
 return pid,env
def flag_guard():
 pid,_=proc_environment(); hashes={}
 # Read protected inputs through the already-authorized ordinary sudo path.
 # Their content is kept in memory, never returned, logged, or copied.
 for path in ENV_FILES:
  raw=pathlib.Path(path).read_text() if os.access(path,os.R_OK) else sudo('/usr/bin/cat',path,capture=True)
  hashes[path]=hashlib.sha256(raw.encode()).hexdigest()
  for line in raw.splitlines():
   match=re.match(r'^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$',line)
   if match and match[1] in FLAGS:
    value=match[2].strip().strip('"\'')
    require(value=='false','A persisted phase-one feature flag is not false')
 return {'pid':pid,'flags':{k:False for k in FLAGS},'environmentInputHashes':hashes}
def tree_files(root):
 return {str(p.relative_to(root)).replace('\\','/'):sha(p) for p in root.rglob('*') if p.is_file()}
def live_source_guard(manifest):
 require(sha(BASE/'live-source.tgz')==manifest['baseArchiveSha256'],'Original source archive changed')
 expected={}; roots=set(); directories=set()
 with tarfile.open(BASE/'live-source.tgz') as archive:
  for entry in archive:
   name=entry.name.removeprefix('./').rstrip('/')
   if entry.isdir():directories.add(name)
   elif entry.isfile():expected[name]=hashlib.sha256(archive.extractfile(entry).read()).hexdigest()
   else:require(False,'Unexpected nonregular baseline source entry')
 roots={d for d in directories if not any(d.startswith(p+'/') for p in directories if p!=d)}
 actual=set()
 for root in roots:
  for folder,children,files in os.walk(LIVE/root):
   children[:]=[n for n in children if n not in ('node_modules','dist','.git')]
   for name in files:
    if name.startswith('.env') or name.endswith(('.pem','.key','.p12','.pfx','.jks')):continue
    actual.add(str((pathlib.Path(folder)/name).relative_to(LIVE)))
 expected_under={p for p in expected if any(p.startswith(r+'/') for r in roots)}
 require(actual==expected_under,'Live source file set drifted since the reviewed snapshot')
 for relative,digest in expected.items():
  path=LIVE/relative
  require(path.is_file() and not path.is_symlink() and sha(path)==digest,'Live source hash drift: '+relative)
 for row in manifest['added']:require(not (LIVE/row['path']).exists(),'Feature addition already exists: '+row['path'])
 return len(expected)
def artifact_guard(manifest):
 for row in manifest['modified']+manifest['added']:
  require(sha(CANDIDATE/row['path'])==row['after'],'Candidate source changed: '+row['path'])
 for relative,digest in manifest['artifacts'].items():require(sha(CANDIDATE/relative)==digest,'Candidate artifact changed: '+relative)
 for root in DIST:
  expected={p[len(root)+1:]:v for p,v in manifest['artifacts'].items() if p.startswith(root+'/')}
  require(tree_files(CANDIDATE/root)==expected,'Candidate artifact file set changed')
 require(sha(BASE/'live-rollback.tgz')==manifest['rollbackSha256'],'Rollback archive changed')
 original={}
 with tarfile.open(BASE/'live-rollback.tgz') as archive:
  for entry in archive:
   if entry.isfile() and any(entry.name.startswith(root+'/') for root in DIST):original[entry.name]=hashlib.sha256(archive.extractfile(entry).read()).hexdigest()
 for root in DIST:
  expected={p[len(root)+1:]:v for p,v in original.items() if p.startswith(root+'/')}
  require(tree_files(LIVE/root)==expected,'Live distribution changed since rollback backup')
 return original
def fetch(path):
 request=urllib.request.Request(ORIGIN+path,headers={'Cache-Control':'no-cache','Accept-Encoding':'identity'})
 try:
  with urllib.request.urlopen(request,timeout=12) as response:return response.status,response.read(8*1024*1024),response.headers.get('Content-Type','')
 except urllib.error.HTTPError as error:return error.code,error.read(8192),error.headers.get('Content-Type','')
def public_check(deployed=False):
 status,body,_=fetch('/api/auth/entra/status')
 require(status==200 and json.loads(body).get('loginOrigin')==ORIGIN,'Canonical Microsoft login read-back failed')
 require(fetch('/api/building-diagnostics/overview')[0]==401,'Existing generic diagnostics auth changed')
 require(fetch('/api/building-probes')[0]==(401 if deployed else 404),'Building Probe route/auth read-back failed')
 if deployed:require(fetch('/api/building-probes/agent/ping')[0]==503,'Building Probe is not disabled')
 status,body,_=fetch('/network/building-probes?phase1='+str(int(time.time())))
 require(status==200,'Public frontend route unavailable')
 expected=(CANDIDATE if deployed else LIVE)/'artifacts/it-reporting/dist/public/index.html'
 require(hashlib.sha256(body).hexdigest()==sha(expected),'Public frontend is not serving the expected paired distribution')
 require(fetch('/network/diagnostics')[0]==200,'Existing diagnostics frontend unavailable')
 health,body,_=fetch('/api/healthz')
 require(health==200 and json.loads(body).get('status')=='ok','API health read-back failed')
 return {'canonicalLogin':200,'genericAuth':401,'probeAuth':401 if deployed else 404,'probeDisabled':503 if deployed else None,'frontend':200,'health':200,'sslVerified':True}
def metadata_guard(env):
 # No DDL or ordinary writes. No connection values are included in output.
 code="""import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:10000,statement_timeout:10000});try{await c.connect();await c.query('BEGIN READ ONLY');const q=await c.query(\"SELECT x.name,to_regclass('public.'||x.name) IS NOT NULL AS present FROM unnest(ARRAY['building_probe_buildings','building_probes','building_probe_jobs','building_probe_slots','building_probe_campus_lease','building_probe_result_exports']) x(name)\");console.log(JSON.stringify(q.rows));await c.query('ROLLBACK');}catch{process.exitCode=1;}finally{await c.end();}"""
 require(bool(env.get('DATABASE_URL')),'Database read-only verification context unavailable')
 try:
  p=subprocess.run(['node','--input-type=module','-e',code],cwd=LIVE/'artifacts/api-server',env={**os.environ,'DATABASE_URL':env['DATABASE_URL']},capture_output=True,text=True,timeout=30)
 except subprocess.TimeoutExpired:
  raise RuntimeError('Read-only feature table check exceeded its 30-second limit') from None
 require(p.returncode==0,'Read-only feature table check failed')
 data=json.loads(p.stdout);require(len(data)==6 and all(not row['present'] for row in data),'Feature tables unexpectedly exist')
 return {row['name']:False for row in data}
def prepare_rollback_source(manifest):
 target=BASE/'phase1-original-sources'
 require(not target.exists(),'A previous apply attempt exists; inspect its record before reusing')
 target.mkdir(mode=0o700)
 wanted={row['path'] for row in manifest['modified']}
 with tarfile.open(BASE/'live-rollback.tgz') as archive:
  for entry in archive:
   if entry.name in wanted:archive.extract(entry,target,filter='data')
 for row in manifest['modified']:require(sha(target/row['path'])==row['before'],'Rollback source preimage invalid')
 return target
def installed_guard(manifest):
 for row in manifest['modified']+manifest['added']:
  require(sha(LIVE/row['path'])==row['after'],'Installed source verification failed')
 for root in DIST:
  expected={p[len(root)+1:]:v for p,v in manifest['artifacts'].items() if p.startswith(root+'/')}
  require(tree_files(LIVE/root)==expected,'Installed distribution verification failed')
def rollback(manifest,original,saved,moved):
 sudo('/bin/systemctl','stop',SERVICE)
 for row in manifest['modified']:
  sudo('/usr/bin/install','-D','-o','root','-g','root','-m','0644',str(original/row['path']),str(LIVE/row['path']))
 for root in reversed(moved):
  destination=LIVE/root; failed=destination.with_name(destination.name+'.probe-phase1-failed')
  if destination.exists():sudo('/usr/bin/mv','--',str(destination),str(failed))
  sudo('/usr/bin/mv','--',str(saved[root]),str(destination))
 for row in manifest['modified']:require(sha(LIVE/row['path'])==row['before'],'Rollback source verification failed')
 sudo('/bin/systemctl','restart',SERVICE)
 for _ in range(30):
  try:flag_guard();public_check(False);return
  except Exception:time.sleep(1)
 raise RuntimeError('Rollback service read-back failed; inspect service directly')
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');parser.add_argument('--reviewed-script-sha256')
 args=parser.parse_args()
 os.umask(0o077)
 require(sha(BASE/'verified-candidate-manifest.json')==MANIFEST_SHA,'Reviewed manifest hash changed')
 manifest=json.loads((BASE/'verified-candidate-manifest.json').read_text())
 require(len(manifest['modified'])==4 and len(manifest['added'])==18,'Unexpected source scope')
 initial=flag_guard();source_count=live_source_guard(manifest);artifact_guard(manifest)
 _,env=proc_environment();tables=metadata_guard(env);ingress=public_check(False)
 state={'phase':'read-only preflight','sourceFilesVerified':source_count,'runtimeIntegrations':3,'navigationTestChanges':1,'featureAdditions':18,'flags':initial['flags'],'featureTables':tables,'publicReadback':ingress,'liveMutation':False}
 if not args.apply:
  print(json.dumps(state,indent=2));return
 require(args.reviewed_script_sha256==sha(pathlib.Path(__file__)),'Reviewed apply-script hash is required')
 original=prepare_rollback_source(manifest)
 saved={root:(LIVE/root).with_name((LIVE/root).name+'.probe-phase1-before') for root in DIST}
 pending={root:(LIVE/root).with_name((LIVE/root).name+'.probe-phase1-new') for root in DIST}
 for root in DIST:
  failed=(LIVE/root).with_name((LIVE/root).name+'.probe-phase1-failed')
  require(not saved[root].exists() and not pending[root].exists() and not failed.exists(),'Distribution staging path already exists')
  sudo('/usr/bin/cp','-a','--',str(CANDIDATE/root),str(pending[root]))
 # Refresh every source/config/artifact guard immediately before the stop/swap.
 live_source_guard(manifest);artifact_guard(manifest)
 require(flag_guard()['environmentInputHashes']==initial['environmentInputHashes'],'Environment input changed during staging')
 moved=[]; stopped=False
 try:
  sudo('/bin/systemctl','stop',SERVICE);stopped=True
  for row in manifest['modified']+manifest['added']:
   sudo('/usr/bin/install','-D','-o','root','-g','root','-m','0644',str(CANDIDATE/row['path']),str(LIVE/row['path']))
  for root in DIST:
   sudo('/usr/bin/mv','--',str(LIVE/root),str(saved[root]));moved.append(root)
   sudo('/usr/bin/mv','--',str(pending[root]),str(LIVE/root))
  installed_guard(manifest)
  sudo('/bin/systemctl','restart',SERVICE)
  last=None
  for _ in range(30):
   try:
    current=flag_guard();require(current['pid']!=initial['pid'],'Service PID did not change')
    readback=public_check(True);_,env=proc_environment();metadata_guard(env);last=None;break
   except Exception as error:last=error;time.sleep(1)
  if last:raise last
  state.update({'phase':'phase-one applied and read back','liveMutation':True,'newPid':current['pid'],'publicReadback':readback,'rollbackArchive':str(BASE/'live-rollback.tgz'),'flags':current['flags']})
  (BASE/'phase1-applied.json').write_text(json.dumps(state,indent=2)+'\n')
  print(json.dumps(state,indent=2))
 except Exception:
  if stopped:rollback(manifest,original,saved,moved)
  raise RuntimeError('Phase-one verification failed; original paired distributions and source preimages restored. Feature additions remain inert.')
if __name__=='__main__':
 try:main()
 except Exception as error:
  # Our errors contain fixed descriptions/paths only; never emit SQL/env/raw tool output.
  print(json.dumps({'status':'stopped','reason':str(error),'liveMutation':'--apply' in sys.argv}),file=sys.stderr);sys.exit(1)
