#!/usr/bin/env python3
"""Isolated API-only build and guarded two-source-file release. No default mutation."""
import argparse,hashlib,json,os,re,shutil,stat,subprocess,time,urllib.request,urllib.error
from pathlib import Path
APP=Path('/home/scccadmin/apps/Network-Insight-Hub')
API=Path('artifacts/api-server');DIST=API/'dist'
PINS={str(API/'src/lib/building_diagnostics_enrollment.ts'):('b46157abd623fc40ec7675f68a21ca6b23872287c39227d7c2e8ca7c3e63133f','ed90e9f1aa46a1e2fcefe48518324650a9e1eb3d2fa10e2ba6e9571e02664519'),str(API/'src/routes/building_diagnostics_enrollment.ts'):('483e363140fff85437a03319273df96d4986481605542b73f7c8888c39fd1c4c','afd62e3ab1da4e495f986780a91e360916d44c29f66f395302922ba018650db5')}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def value_hash(v):return hashlib.sha256(v).hexdigest()
def meta(p):
 s=p.stat();return dict(uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode))
def regular(p):
 if p.is_symlink() or not p.is_file():raise RuntimeError('ExpectedRegularFile')
def tree(root):
 result={}
 for p in sorted(root.rglob('*')):
  if p.is_symlink():raise RuntimeError('UnexpectedArtifactSymlink')
  if p.is_file():result[p.relative_to(root).as_posix()]=digest(p)
 return result
def source_inputs():
 result={}
 for folder in [API/'src',Path('lib')]:
  for p in sorted((APP/folder).rglob('*')):
   if any(x in ['node_modules','.git'] for x in p.relative_to(APP).parts):continue
   if p.is_file() and p.suffix in ['.ts','.tsx','.js','.mjs','.json','.md','.svg']:
    regular(p);result[p.relative_to(APP).as_posix()]=digest(p)
 for relative in ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json',str(API/'package.json'),str(API/'build.mjs')]:
  p=APP/relative
  if p.exists():regular(p);result[relative]=digest(p)
 return result
def pid():return subprocess.check_output(['systemctl','show','sccc-api.service','-p','MainPID','--value'],text=True).strip()
def unit_hash():return value_hash(subprocess.check_output((['sudo','-n'] if os.geteuid()!=0 else [])+['systemctl','cat','sccc-api.service']))
def config_hashes():
 entries=subprocess.check_output(['systemctl','show','sccc-api.service','-p','EnvironmentFiles','--value'],text=True)
 paths=re.findall(r'(/[^\s]+) \(ignore_errors=(?:yes|no)\)',entries)
 if not paths:raise RuntimeError('AuthoritativeEnvironmentFilesUnavailable')
 if (APP/'.env').is_file():paths.append(str(APP/'.env'))
 result={}
 for path in paths:
  result[path]=digest(Path(path)) if os.geteuid()==0 else subprocess.check_output(['sudo','-n','sha256sum',path],text=True).split()[0]
 return result
def active_measurements():
 cmd=['sudo','-n','-u','postgres','psql','-X','-q','-A','-t']
 dbs=subprocess.check_output(cmd+['-d','postgres','-c','SELECT datname FROM pg_database WHERE NOT datistemplate;'],text=True).splitlines()
 for database in dbs:
  if database=='postgres':continue
  result=subprocess.run(cmd+['-d',database,'-c',"BEGIN READ ONLY; SELECT count(*) FROM building_diagnostics_jobs WHERE status='running' AND expires_at>now(); COMMIT;"],capture_output=True,text=True)
  if result.returncode==0:return int(next(s for s in result.stdout.splitlines() if s.isdigit()))
 raise RuntimeError('MeasurementGuardUnavailable')
def status(path,method='GET'):
 request=urllib.request.Request('http://127.0.0.1:8080'+path,data=b'{}' if method=='POST' else None,method=method,headers={'Content-Type':'application/json','Accept-Encoding':'identity'})
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 try:
  with opener.open(request,timeout=4) as response:return response.status
 except urllib.error.HTTPError as e:return e.code
def boundaries():
 for path,method,expected in [('/api/healthz','GET',200),('/api/auth/entra/status','GET',200),('/api/building-diagnostics/overview','GET',401),('/api/building-probes/','GET',401),('/api/building-diagnostics/devices/bulk-enrollment','POST',401),('/api/building-diagnostics/devices/bulk-enrollment/worker/claim','POST',401)]:
  if status(path,method)!=expected:raise RuntimeError('HealthOrAuthenticationBoundaryChanged:'+path)
def write_json(path,value):
 with path.open('x') as h:json.dump(value,h,indent=2);h.flush();os.fsync(h.fileno())
def baseline():
 if active_measurements()!=0:raise RuntimeError('ActiveMeasurementRequiresQuietRestartWindow')
 return dict(inputs=source_inputs(),dist=tree(APP/DIST),pid=pid(),unit=unit_hash(),env=config_hashes(),frontendIndex=digest(APP/'artifacts/it-reporting/dist/public/index.html'),parents={str(p):meta(p) for p in [APP/API,APP/DIST.parent,*( (APP/r).parent for r in PINS)]},sourceMetadata={r:meta(APP/r) for r in PINS},distMetadata={'.':meta(APP/DIST),**{p.relative_to(APP/DIST).as_posix():meta(p) for p in sorted((APP/DIST).rglob('*'))}})
def prepare(release):
 if (release/'manifest.json').exists():raise RuntimeError('FreshReleaseRequired')
 boundaries();before=baseline()
 for r,(old,new) in PINS.items():
  if before['inputs'].get(r)!=old or digest(release/'overlay'/r)!=new:raise RuntimeError('ExactTwoSourceBaselineOrCandidateMismatch')
 candidate=release/'candidate';candidate.mkdir(mode=0o700)
 for r in before['inputs']:
  target=candidate/r;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(APP/r,target)
 for r in PINS:shutil.copy2(release/'overlay'/r,candidate/r)
 for r in ['node_modules',str(API/'node_modules')]:
  target=candidate/r;target.parent.mkdir(parents=True,exist_ok=True);target.symlink_to((APP/r).resolve(),target_is_directory=True)
 env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','LC_ALL','SHELL']};env['NODE_ENV']='production'
 with (release/'build.log').open('x') as log:subprocess.run(['node',str(candidate/API/'build.mjs')],cwd=candidate/API,env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=180)
 if baseline()!=before:raise RuntimeError('LiveChangedDuringIsolatedBuild')
 manifest=dict(schema='sccc.scoped-claim-release.v1',createdAtUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),baseline=before,candidateDist=tree(candidate/DIST),candidateSources={r:digest(candidate/r) for r in PINS},toolSha256=digest(Path(__file__)),productionChanged=False)
 write_json(release/'manifest.json',manifest)
 print(json.dumps(dict(status='PreparedNotApplied',release=str(release),sourceCount=2,pinnedInputs=len(before['inputs']),apiArtifacts=len(manifest['candidateDist']),pid=before['pid'],manifestSha256=digest(release/'manifest.json'))))
def load(release,manifest_sha):
 if digest(release/'manifest.json')!=manifest_sha:raise RuntimeError('FrozenManifestMismatch')
 m=json.loads((release/'manifest.json').read_text())
 if m['schema']!='sccc.scoped-claim-release.v1' or m['toolSha256']!=digest(Path(__file__)):raise RuntimeError('FrozenToolMismatch')
 if tree(release/'candidate'/DIST)!=m['candidateDist'] or any(digest(release/'candidate'/r)!=m['candidateSources'][r] for r in PINS):raise RuntimeError('FrozenCandidateDrift')
 return m
def setmeta(p,m):os.chown(p,m['uid'],m['gid']);os.chmod(p,m['mode'])
def replace(src,dst,m):
 tmp=dst.with_name(dst.name+'.scoped-claim-new')
 if tmp.exists() or tmp.is_symlink():raise RuntimeError('UnexpectedStagingFile')
 shutil.copy2(src,tmp);setmeta(tmp,m);os.replace(tmp,dst)
def restore(release,m):
 b=m['baseline'];backup=release/'backup'
 if tree(backup/'dist')!=b['dist'] or any(digest(backup/r)!=PINS[r][0] for r in PINS):raise RuntimeError('OriginalBackupDrift')
 current=tree(APP/DIST) if (APP/DIST).is_dir() else None
 if current not in [None,b['dist'],m['candidateDist']]:raise RuntimeError('UnrelatedLiveBundleRequiresManualReview')
 for r in PINS:
  if digest(APP/r) not in PINS[r]:raise RuntimeError('UnrelatedSourceRequiresManualReview')
 if current!=b['dist']:
  failed=release/'failed-dist'
  if failed.exists():raise RuntimeError('UnexpectedRollbackArtifact')
  if current is not None:os.replace(APP/DIST,failed)
  shutil.copytree(backup/'dist',APP/DIST)
  for r,md in b['distMetadata'].items():setmeta(APP/DIST/r,md)
 for r in PINS:replace(backup/r,APP/r,b['sourceMetadata'][r])
 subprocess.run(['systemctl','restart','sccc-api.service'],check=True,timeout=35)
 wait_health();boundaries()
 if tree(APP/DIST)!=b['dist'] or any(digest(APP/r)!=PINS[r][0] for r in PINS):raise RuntimeError('RollbackReadbackMismatch')
def wait_health():
 for _ in range(15):
  try:
   if status('/api/healthz')==200:return
  except OSError:pass
  time.sleep(1)
 raise RuntimeError('RestartHealthDidNotRecover')
def apply(release,m):
 if os.geteuid()!=0:raise RuntimeError('NormalApprovedSudoRequired')
 boundaries()
 if baseline()!=m['baseline']:raise RuntimeError('LiveSourceArtifactPidMetadataOrPolicyDrift')
 backup=release/'backup';backup.mkdir(mode=0o700)
 for r in PINS:
  target=backup/r;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(APP/r,target)
 shutil.copytree(APP/DIST,backup/'dist')
 b=m['baseline'];candidate=release/'candidate';staged=APP/API/'dist.scoped-claim-new';old=release/'before-dist-live'
 if staged.exists() or old.exists():raise RuntimeError('UnexpectedReleaseStaging')
 shutil.copytree(candidate/DIST,staged)
 rootmd=b['distMetadata']['.']
 for p in [staged,*sorted(staged.rglob('*'))]:setmeta(p,b['distMetadata'].get(p.relative_to(staged).as_posix(),{**rootmd,'mode':0o755 if p.is_dir() else 0o644}))
 mutated=False
 try:
  # Recheck after backup; a separate deployment or policy change must stop this release.
  if baseline()!=b:raise RuntimeError('LiveDriftBeforeCommit')
  mutated=True
  for r in PINS:replace(candidate/r,APP/r,b['sourceMetadata'][r])
  os.replace(APP/DIST,old);os.replace(staged,APP/DIST)
  subprocess.run(['systemctl','restart','sccc-api.service'],check=True,timeout=35)
  wait_health();boundaries()
  if tree(APP/DIST)!=m['candidateDist'] or any(digest(APP/r)!=PINS[r][1] for r in PINS):raise RuntimeError('AppliedFileReadbackMismatch')
  if unit_hash()!=b['unit'] or config_hashes()!=b['env'] or digest(APP/'artifacts/it-reporting/dist/public/index.html')!=b['frontendIndex']:raise RuntimeError('RuntimePolicyOrFrontendDrift')
  result=dict(status='AppliedVerified',atUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),pidBefore=b['pid'],pidAfter=pid(),sourceFiles=2,frontendChanged=False,credentialsChanged=False,queuesClaimed=0)
  write_json(release/'apply-receipt.json',result);print(json.dumps(result))
 except Exception:
  if mutated:restore(release,m)
  raise
def main():
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['prepare','apply','rollback']);p.add_argument('release',type=Path);p.add_argument('--manifest-sha256');a=p.parse_args()
 release=a.release.resolve()
 if release.parent!=Path('/home/scccadmin') or not release.name.startswith('diagnostics-scoped-claim-release-') or not release.is_dir() or release.is_symlink():raise RuntimeError('ApprovedPrivateReleasePathRequired')
 if a.mode=='prepare':prepare(release)
 else:
  if not a.manifest_sha256:raise RuntimeError('FrozenManifestHashRequired')
  m=load(release,a.manifest_sha256.lower())
  if a.mode=='apply':apply(release,m)
  else:
   if os.geteuid()!=0:raise RuntimeError('NormalApprovedSudoRequired')
   restore(release,m);print(json.dumps(dict(status='RolledBackVerified')))
if __name__=='__main__':main()
