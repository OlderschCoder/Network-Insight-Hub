#!/usr/bin/env python3
"""Guarded frontend-only follow-up. Never restarts API or modifies enrollment state."""
import ast
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import time
import urllib.request

library=Path(__file__).with_name('release-bulk-enrollment.py')
tree=ast.parse(library.read_text()); definitions=[]
for node in tree.body:
    if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='parser' for t in node.targets): break
    definitions.append(node)
base={};exec(compile(ast.Module(body=definitions,type_ignores=[]),str(library),'exec'),base)
APP=base['APP'];PUBLIC=base['PUBLIC'];UI=Path('artifacts/it-reporting/src/pages/network/building-diagnostics.tsx')
OLD='a47aee95fd303a11f0f297841ec77a997c26934b0712ce5ba3c93130d6894b80'
NEW='dbb2afeefa0a6f64de33fc57e566db7d683bef62677faf3c784af4670b9e189d'
digest=base['digest'];metadata=base['metadata'];replace=base['replace_file']
def pid(): return subprocess.check_output(['systemctl','show','sccc-api.service','-p','MainPID','--value'],text=True).strip()
def prepare(root):
    if digest(APP/UI)!=OLD or digest(root/'overlay.tsx')!=NEW: raise RuntimeError('Exact reviewed UI baseline/patch mismatch')
    inputs=base['inputs']();api=base['tree'](APP/base['API_DIST']);process=pid()
    candidate=root/'candidate';candidate.mkdir(mode=0o700)
    for relative in inputs:
        target=candidate/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(APP/relative,target)
    shutil.copy2(root/'overlay.tsx',candidate/UI)
    for relative in ['node_modules','artifacts/it-reporting/node_modules']: base['link_dependencies'](APP/relative,candidate/relative)
    public_source=APP/'artifacts/it-reporting/public'
    if public_source.is_dir(): (candidate/'artifacts/it-reporting/public').symlink_to(public_source,target_is_directory=True)
    env={k:v for k,v in os.environ.items() if k in {'PATH','HOME','LANG','LC_ALL','SHELL'}};env.update(NODE_ENV='production',BASE_PATH='/')
    with (root/'build.log').open('w') as log: subprocess.run(['node',str(candidate/'artifacts/it-reporting/node_modules/vite/bin/vite.js'),'build','--config',str(candidate/'artifacts/it-reporting/vite.config.ts'),'--manifest'],cwd=candidate/'artifacts/it-reporting',env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=240)
    if base['inputs']()!=inputs or base['tree'](APP/base['API_DIST'])!=api or pid()!=process: raise RuntimeError('Live source/API changed during frontend build')
    vite=json.loads((candidate/PUBLIC/'.vite/manifest.json').read_text());assets=set()
    for entry in vite.values(): assets.add(entry['file']);assets.update(entry.get('css',[]));assets.update(entry.get('assets',[]))
    if any(not a.startswith('assets/') or '..' in Path(a).parts for a in assets): raise RuntimeError('Unexpected generated asset')
    manifest={'sourceInputs':inputs,'api':api,'apiPid':process,'oldSource':OLD,'newSource':NEW,'oldIndex':digest(APP/PUBLIC/'index.html'),'newIndex':digest(candidate/PUBLIC/'index.html'),'sourceMetadata':metadata(APP/UI),'indexMetadata':metadata(APP/PUBLIC/'index.html'),'parentMetadata':{str(p.relative_to(APP)):metadata(p) for p in [(APP/UI).parent,APP/PUBLIC,APP/PUBLIC/'assets']},'assets':{a:digest(candidate/PUBLIC/a) for a in sorted(assets)}}
    (root/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({'prepared':str(root),'sourceInputsPinned':len(inputs),'apiRestartRequested':False,'productionChanged':False}))
def check(root,m):
    if base['inputs']()!=m['sourceInputs'] or base['tree'](APP/base['API_DIST'])!=m['api'] or pid()!=m['apiPid']: raise RuntimeError('Live source/API drift; stop before frontend update')
    if digest(APP/UI)!=OLD or digest(APP/PUBLIC/'index.html')!=m['oldIndex']: raise RuntimeError('Live frontend baseline drift')
    if metadata(APP/UI)!=m['sourceMetadata'] or metadata(APP/PUBLIC/'index.html')!=m['indexMetadata']: raise RuntimeError('Live frontend file ownership/mode drift')
    if digest(root/'candidate'/UI)!=NEW or digest(root/'candidate'/PUBLIC/'index.html')!=m['newIndex']: raise RuntimeError('Candidate drift')
    for relative,value in m['parentMetadata'].items():
        if metadata(APP/relative)!=value: raise RuntimeError('Live parent metadata drift')
    for asset,value in m['assets'].items():
        if digest(root/'candidate'/PUBLIC/asset)!=value or ((APP/PUBLIC/asset).exists() and digest(APP/PUBLIC/asset)!=value): raise RuntimeError('Generated asset drift/collision')
def restore(root,m):
    if digest(APP/UI) not in {OLD,NEW} or digest(APP/PUBLIC/'index.html') not in {m['oldIndex'],m['newIndex']}: raise RuntimeError('Intervening frontend change; manual review required')
    if digest(root/'backup/source.tsx')!=OLD or digest(root/'backup/index.html')!=m['oldIndex']: raise RuntimeError('Backup validation failed before rollback writes')
    replace(root/'backup/source.tsx',APP/UI,m['sourceMetadata']);replace(root/'backup/index.html',APP/PUBLIC/'index.html',m['indexMetadata'])
    if digest(APP/UI)!=OLD or digest(APP/PUBLIC/'index.html')!=m['oldIndex']: raise RuntimeError('Frontend rollback read-back failed')
def apply(root,m):
    if os.geteuid()!=0: raise RuntimeError('Frontend apply requires approved sudo/root before writes')
    check(root,m);backup=root/'backup';backup.mkdir(mode=0o700)
    shutil.copy2(APP/UI,backup/'source.tsx');shutil.copy2(APP/PUBLIC/'index.html',backup/'index.html')
    (backup/'metadata.json').write_text(json.dumps({k:v for k,v in m.items() if 'Metadata' in k},indent=2));changed=False
    try:
        replace(root/'candidate'/UI,APP/UI,m['sourceMetadata']);changed=True
        for asset in m['assets']:
            if not (APP/PUBLIC/asset).exists(): replace(root/'candidate'/PUBLIC/asset,APP/PUBLIC/asset)
        replace(root/'candidate'/PUBLIC/'index.html',APP/PUBLIC/'index.html',m['indexMetadata'])
        for origin in ['https://insights.sccc.edu','https://app-server2.centralus.cloudapp.azure.com']:
            with urllib.request.urlopen(origin+'/network/diagnostics?sso=1&uiRelease='+root.name,timeout=20) as response:
                if response.status!=200 or hashlib.sha256(response.read()).hexdigest()!=m['newIndex']: raise RuntimeError('Served frontend hash mismatch')
        if digest(APP/UI)!=NEW or base['tree'](APP/base['API_DIST'])!=m['api'] or pid()!=m['apiPid']: raise RuntimeError('Frontend/API isolation read-back failed')
        for asset,value in m['assets'].items():
            if digest(APP/PUBLIC/asset)!=value: raise RuntimeError('Installed generated asset hash mismatch')
        if metadata(APP/UI)!=m['sourceMetadata'] or metadata(APP/PUBLIC/'index.html')!=m['indexMetadata']: raise RuntimeError('Frontend metadata changed')
        (root/'applied.json').write_text(json.dumps({'appliedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'apiPidUnchanged':pid(),'apiRestartRequested':False,'enrollmentStateChanged':False},indent=2))
        print('Frontend-only update passed both-origin/hash checks; API PID unchanged; no enrollment/measurement operation.')
    except Exception:
        if changed: restore(root,m)
        raise
parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['prepare','check','apply','rollback']);parser.add_argument('root');args=parser.parse_args()
root=Path(args.root).resolve();owner=pwd.getpwnam('scccadmin').pw_uid
if root.parent!=Path('/home/scccadmin') or not root.name.startswith('fred-bulk-ui-refresh-') or root.stat().st_uid!=owner or os.geteuid() not in {0,owner}: raise RuntimeError('Reviewed operator-owned private frontend release required')
if args.mode=='prepare': prepare(root)
else:
    m=json.loads((root/'manifest.json').read_text())
    if args.mode=='check': check(root,m);print('Exact frontend/source/API baseline hashes and PID match; no changes')
    elif args.mode=='apply': apply(root,m)
    else:
        if os.geteuid()!=0: raise RuntimeError('Rollback requires approved sudo/root')
        restore(root,m)
