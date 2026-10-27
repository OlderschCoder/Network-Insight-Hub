#!/usr/bin/env python3
"""Prepare a source-only isolated build; apply/rollback only with an explicit mode."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time
import urllib.error
import urllib.request

APP = Path('/home/scccadmin/apps/Network-Insight-Hub')
API_DIST = Path('artifacts/api-server/dist')
PUBLIC = Path('artifacts/it-reporting/dist/public')
SOURCE = [
 'artifacts/api-server/src/lib/building_diagnostics_enrollment.ts',
 'artifacts/api-server/src/routes/building_diagnostics_enrollment.ts',
 'artifacts/api-server/src/routes/building_diagnostics.ts',
 'artifacts/api-server/src/lib/building_diagnostics_store.ts',
 'artifacts/it-reporting/src/pages/network/building-diagnostics.tsx',
]
EXTENSIONS = {'.ts', '.tsx', '.mjs', '.js', '.json', '.css', '.md', '.html', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico'}

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def regular(path, root):
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
        raise RuntimeError('Expected a regular file within the approved tree: ' + str(path))

def tree(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_file():
            regular(path, root)
            result[path.relative_to(root).as_posix()] = digest(path)
        elif path.is_symlink():
            raise RuntimeError('Artifact symlink refused: ' + str(path))
    return result

def metadata(path):
    value=path.stat()
    return {'uid':value.st_uid,'gid':value.st_gid,'mode':stat.S_IMODE(value.st_mode)}

def metadata_tree(root):
    return {'.':metadata(root),**{p.relative_to(root).as_posix():metadata(p) for p in sorted(root.rglob('*'))}}

def set_metadata(path,value):
    current=path.stat()
    if (current.st_uid,current.st_gid)!=(value['uid'],value['gid']): os.chown(path,value['uid'],value['gid'])
    os.chmod(path,value['mode'])

def add_metadata(manifest,candidate):
    manifest['oldSourceMetadata']={r:metadata(APP/r) if (APP/r).exists() else None for r in SOURCE}
    manifest['parentMetadata']={str(p.relative_to(APP)):metadata(p) for p in {*( (APP/r).parent for r in SOURCE),APP/API_DIST.parent,APP/PUBLIC,APP/PUBLIC/'assets'}}
    manifest['oldApiMetadata']=metadata_tree(APP/API_DIST)
    manifest['oldIndexMetadata']=metadata(APP/PUBLIC/'index.html')
    root_meta=manifest['oldApiMetadata']['.']
    manifest['newApiMetadata']={r:manifest['oldApiMetadata'].get(r,{'uid':root_meta['uid'],'gid':root_meta['gid'],'mode':0o755 if (candidate/API_DIST/r).is_dir() else 0o644}) for r in metadata_tree(candidate/API_DIST)}
    manifest['requiresEuid']=0

def permission_preflight(manifest,require_root=False):
    if require_root and os.geteuid()!=0: raise RuntimeError('Apply/rollback requires approved sudo/root euid=0; no live writes attempted')
    for relative,value in manifest['parentMetadata'].items():
        path=APP/relative
        if path.is_symlink() or not path.is_dir() or metadata(path)!=value: raise RuntimeError('Live parent ownership/mode drift; no permission changes allowed')
    for relative,value in manifest['oldSourceMetadata'].items():
        if value is not None and metadata(APP/relative)!=value: raise RuntimeError('Live source ownership/mode drift')
    if metadata_tree(APP/API_DIST)!=manifest['oldApiMetadata'] or metadata(APP/PUBLIC/'index.html')!=manifest['oldIndexMetadata']: raise RuntimeError('Live artifact ownership/mode drift')

def reuse_candidate(release,prior):
    manifest=json.loads((prior/'manifest.json').read_text())
    guard(prior,manifest)
    candidate=release/'candidate';candidate.mkdir(mode=0o700)
    shutil.copytree(prior/'candidate'/API_DIST,candidate/API_DIST)
    for relative in [*SOURCE,str(PUBLIC/'index.html'),*(str(PUBLIC/a) for a in manifest['assets'])]:
        target=candidate/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(prior/'candidate'/relative,target)
    add_metadata(manifest,candidate)
    manifest['reusedFrom']=str(prior);manifest['priorManifestSha256']=digest(prior/'manifest.json');manifest['preparedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    (release/'manifest.json').write_text(json.dumps(manifest,indent=2))
    shutil.copy2(prior/'build.log',release/'build.log')
    guard(release,manifest);permission_preflight(manifest)
    print(json.dumps({'prepared':str(release),'immutableCandidateReused':True,'requiresEuid':0,'productionChanged':False}))

def inputs():
    paths = []
    for folder in ['artifacts/api-server/src', 'artifacts/it-reporting/src', 'lib']:
        paths.extend(p for p in (APP / folder).rglob('*') if p.is_file() and p.suffix in EXTENSIONS and not any(part.startswith('.') for part in p.relative_to(APP).parts))
    for name in ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json', 'artifacts/api-server/package.json', 'artifacts/api-server/build.mjs', 'artifacts/it-reporting/package.json', 'artifacts/it-reporting/vite.config.ts', 'artifacts/it-reporting/index.html']:
        if (APP / name).is_file(): paths.append(APP / name)
    # Pin the static source assets actually referenced by the frontend; never copy unrelated attachments or data exports.
    for source in list(paths):
        if source.suffix not in {'.ts', '.tsx', '.css'}: continue
        for asset in re.findall(r'@assets/([^\s\"\'\)]+)', source.read_text(errors='strict')):
            asset = asset.split('?')[0]
            if '*' in asset: raise RuntimeError('Review wildcard asset input before release')
            if (APP / 'attached_assets' / asset).is_file(): paths.append(APP / 'attached_assets' / asset)
    result = {}
    for path in set(paths):
        if any(part in {'device-configs', 'node_modules', 'dist'} for part in path.relative_to(APP).parts): continue
        regular(path, APP)
        result[path.relative_to(APP).as_posix()] = digest(path)
    return dict(sorted(result.items()))

def link_dependencies(source, destination):
    destination.mkdir(parents=True)
    for entry in source.iterdir():
        if entry.name.startswith(('.vite', '.cache', '.pnpm-task-run-state')): continue
        (destination / entry.name).symlink_to(entry.resolve(), target_is_directory=entry.is_dir())

def request_status(path, method='GET'):
    data = b'{}' if method == 'POST' else None
    request = urllib.request.Request('http://127.0.0.1:8080' + path, data=data, method=method, headers={'Content-Type': 'application/json', 'Accept-Encoding': 'identity'})
    try:
        with urllib.request.urlopen(request, timeout=3) as response: return response.status
    except urllib.error.HTTPError as error: return error.code

def boundary_check(include_bulk=True):
    expected = {'/api/healthz': 200, '/api/auth/entra/status': 200, '/api/building-diagnostics/overview': 401, '/api/building-probes/': 401}
    for path, status in expected.items():
        if request_status(path) != status: raise RuntimeError('Existing health/auth boundary failed: ' + path)
    if include_bulk:
        if request_status('/api/building-diagnostics/devices/bulk-enrollment', 'POST') != 401: raise RuntimeError('Bulk user-session boundary failed')
        if request_status('/api/building-diagnostics/devices/bulk-enrollment/worker/claim', 'POST') != 401: raise RuntimeError('Bulk private-worker boundary failed')

def replace_file(source, destination, preserve=None):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.bulk-release-new')
    if temporary.exists() or temporary.is_symlink(): raise RuntimeError('Unexpected replacement staging file: ' + str(temporary))
    target_metadata=preserve or (metadata(destination) if destination.exists() else {**metadata(destination.parent),'mode':0o644})
    shutil.copy2(source, temporary)
    set_metadata(temporary,target_metadata)
    os.replace(temporary, destination)

def prepare(release):
    candidate = release / 'candidate'
    candidate.mkdir(mode=0o700)
    before = inputs()
    for relative in before:
        destination = candidate / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(APP / relative, destination)
    for relative in SOURCE:
        overlay = release / 'overlay' / relative
        regular(overlay, release / 'overlay')
        destination = candidate / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(overlay, destination)
    for relative in ['node_modules', 'artifacts/api-server/node_modules', 'artifacts/it-reporting/node_modules']:
        link_dependencies(APP / relative, candidate / relative)
    public_source = APP / 'artifacts/it-reporting/public'
    if public_source.is_dir(): (candidate / 'artifacts/it-reporting/public').symlink_to(public_source, target_is_directory=True)
    environment = {key: value for key, value in os.environ.items() if key in {'PATH', 'HOME', 'LANG', 'LC_ALL', 'SHELL'}}
    environment.update(NODE_ENV='production', BASE_PATH='/')
    with (release / 'build.log').open('w') as log:
        subprocess.run(['node', str(candidate / 'artifacts/api-server/build.mjs')], cwd=candidate / 'artifacts/api-server', env=environment, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=180)
        subprocess.run(['node', str(candidate / 'artifacts/it-reporting/node_modules/vite/bin/vite.js'), 'build', '--config', str(candidate / 'artifacts/it-reporting/vite.config.ts'), '--manifest'], cwd=candidate / 'artifacts/it-reporting', env=environment, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=240)
    if inputs() != before: raise RuntimeError('Live source drifted during isolated build; review and prepare again')
    vite = json.loads((candidate / PUBLIC / '.vite/manifest.json').read_text())
    assets = set()
    for entry in vite.values():
        assets.add(entry['file']); assets.update(entry.get('css', [])); assets.update(entry.get('assets', []))
    for asset in assets:
        if not asset.startswith('assets/') or '..' in Path(asset).parts: raise RuntimeError('Unexpected Vite generated asset')
        regular(candidate / PUBLIC / asset, candidate / PUBLIC)
    if request_status('/api/healthz') != 200: raise RuntimeError('Live API is not healthy before release preparation')
    manifest = {'commit': '8354ebcf25c66101e5eda066e689435ede1a6ed5', 'preparedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'sourceInputs': before,
      'oldSources': {r: digest(APP/r) if (APP/r).exists() else None for r in SOURCE}, 'newSources': {r: digest(candidate/r) for r in SOURCE},
      'oldApi': tree(APP/API_DIST), 'newApi': tree(candidate/API_DIST), 'oldIndex': digest(APP/PUBLIC/'index.html'), 'newIndex': digest(candidate/PUBLIC/'index.html'),
      'assets': {a: digest(candidate/PUBLIC/a) for a in sorted(assets)}, 'productionChanged': False}
    add_metadata(manifest,candidate)
    (release / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps({'prepared': str(release), 'sourceInputsPinned': len(before), 'apiArtifacts': len(manifest['newApi']), 'generatedFrontendAssets': len(assets), 'productionChanged': False}))

def guard(release, manifest):
    if inputs() != manifest['sourceInputs']: raise RuntimeError('Live source/hash drift: stop before deployment')
    if tree(APP/API_DIST) != manifest['oldApi'] or digest(APP/PUBLIC/'index.html') != manifest['oldIndex']: raise RuntimeError('Live artifact/hash drift: stop before deployment')
    candidate = release/'candidate'
    if tree(candidate/API_DIST) != manifest['newApi'] or digest(candidate/PUBLIC/'index.html') != manifest['newIndex']: raise RuntimeError('Candidate artifact drift')
    for relative, value in manifest['newSources'].items():
        if digest(candidate/relative) != value: raise RuntimeError('Candidate source drift')
        if (digest(APP/relative) if (APP/relative).exists() else None) != manifest['oldSources'][relative]: raise RuntimeError('Live affected-source drift')
    for asset, value in manifest['assets'].items():
        if digest(candidate/PUBLIC/asset) != value: raise RuntimeError('Candidate asset drift')
        if (APP/PUBLIC/asset).exists() and digest(APP/PUBLIC/asset) != value: raise RuntimeError('Generated asset collision')

def restore(release, manifest):
    backup = release/'backup'
    current_api = tree(APP/API_DIST) if (APP/API_DIST).is_dir() else None
    if current_api not in (None, manifest['oldApi'], manifest['newApi']): raise RuntimeError('API changed outside this release; manual rollback review required')
    if digest(APP/PUBLIC/'index.html') not in {manifest['oldIndex'],manifest['newIndex']}: raise RuntimeError('Frontend changed outside this release; manual rollback review required')
    for relative, previous in manifest['oldSources'].items():
        current=digest(APP/relative) if (APP/relative).exists() else None
        if current not in {previous,manifest['newSources'][relative]}: raise RuntimeError('Affected source changed outside this release; manual rollback review required')
        if previous is not None:
            regular(backup/'source'/relative, backup)
            if digest(backup/'source'/relative)!=previous: raise RuntimeError('Original source backup hash mismatch; no rollback files changed')
    regular(backup/'index.html', backup)
    if digest(backup/'index.html')!=manifest['oldIndex']: raise RuntimeError('Original frontend backup hash mismatch; no rollback files changed')
    old = release/'api-original'
    if current_api!=manifest['oldApi'] and not old.is_dir(): raise RuntimeError('Original API backup is required; no rollback files changed')
    if old.is_dir() and tree(old)!=manifest['oldApi']: raise RuntimeError('Original API backup hash mismatch; no rollback files changed')
    for relative, previous in manifest['oldSources'].items():
        if previous is None:
            if (APP/relative).exists():
                if digest(APP/relative) != manifest['newSources'][relative]: raise RuntimeError('Source changed after apply; manual rollback review required')
                (APP/relative).unlink()
        else: replace_file(backup/'source'/relative, APP/relative, manifest.get('oldSourceMetadata',{}).get(relative))
    replace_file(backup/'index.html', APP/PUBLIC/'index.html', manifest.get('oldIndexMetadata'))
    if old.is_dir() and current_api!=manifest['oldApi']:
        displaced = release/'api-replaced-during-rollback'
        if (APP/API_DIST).is_dir(): os.replace(APP/API_DIST, displaced)
        os.replace(old, APP/API_DIST)
    subprocess.run(['sudo', '-n', 'systemctl', 'restart', 'sccc-api.service'], check=True, timeout=45)
    for attempt in range(15):
        try: boundary_check(include_bulk=False); break
        except (RuntimeError,urllib.error.URLError):
            if attempt==14: raise RuntimeError('Rollback API health/auth failed; retained backups need operator review')
            time.sleep(1)
    if tree(APP/API_DIST)!=manifest['oldApi'] or digest(APP/PUBLIC/'index.html')!=manifest['oldIndex']: raise RuntimeError('Rollback artifact hash read-back failed')
    for relative, previous in manifest['oldSources'].items():
        if (digest(APP/relative) if (APP/relative).exists() else None)!=previous: raise RuntimeError('Rollback source hash read-back failed')
    if 'oldApiMetadata' in manifest: permission_preflight(manifest)

def apply(release, manifest):
    guard(release, manifest)
    permission_preflight(manifest,require_root=True)
    subprocess.run(['sudo', '-n', 'true'], check=True)
    backup = release/'backup'; backup.mkdir(mode=0o700)
    for relative, previous in manifest['oldSources'].items():
        if previous is not None:
            destination=backup/'source'/relative; destination.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(APP/relative,destination)
    shutil.copy2(APP/PUBLIC/'index.html',backup/'index.html')
    (backup/'metadata.json').write_text(json.dumps({key:value for key,value in manifest.items() if 'Metadata' in key},indent=2))
    staged = release/'api-staged'; shutil.copytree(release/'candidate'/API_DIST,staged)
    for relative,value in manifest['newApiMetadata'].items(): set_metadata(staged/relative,value)
    mutated=False
    try:
        for relative in SOURCE:
            replace_file(release/'candidate'/relative,APP/relative)
            mutated=True
        os.replace(APP/API_DIST,release/'api-original')
        os.replace(staged,APP/API_DIST)
        subprocess.run(['sudo','-n','systemctl','restart','sccc-api.service'],check=True,timeout=45)
        for attempt in range(15):
            try: boundary_check(); break
            except (RuntimeError,urllib.error.URLError):
                if attempt==14: raise
                time.sleep(1)
        for asset in manifest['assets']:
            if not (APP/PUBLIC/asset).exists(): replace_file(release/'candidate'/PUBLIC/asset,APP/PUBLIC/asset)
        replace_file(release/'candidate'/PUBLIC/'index.html',APP/PUBLIC/'index.html')
        with urllib.request.urlopen('https://insights.sccc.edu/network/diagnostics?sso=1&bulkRelease='+release.name,timeout=20) as response:
            if response.status!=200 or hashlib.sha256(response.read()).hexdigest()!=manifest['newIndex']: raise RuntimeError('Canonical diagnostics URL did not serve the prepared frontend')
        if tree(APP/API_DIST)!=manifest['newApi']: raise RuntimeError('Installed API artifact hash read-back failed')
        for relative, value in manifest['newSources'].items():
            if digest(APP/relative)!=value: raise RuntimeError('Installed affected-source hash read-back failed')
        for asset, value in manifest['assets'].items():
            if digest(APP/PUBLIC/asset)!=value: raise RuntimeError('Installed generated-asset hash read-back failed')
        if metadata_tree(APP/API_DIST)!=manifest['newApiMetadata'] or metadata(APP/PUBLIC/'index.html')!=manifest['oldIndexMetadata']: raise RuntimeError('Installed artifact ownership/mode read-back failed')
        for relative,value in manifest['oldSourceMetadata'].items():
            if value is not None and metadata(APP/relative)!=value: raise RuntimeError('Installed source ownership/mode read-back failed')
        (release/'applied.json').write_text(json.dumps({'appliedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'health':'passed','enrollmentRequestsCreated':0,'endpointChanges':False},indent=2))
        print('Applied code only; health/auth/frontend/hash checks passed. No enrollment, endpoint activation, GPO or measurement was requested.')
    except Exception:
        if mutated: restore(release,manifest)
        else: print('No live target was mutated; rollback and service restart were not attempted.')
        raise

parser=argparse.ArgumentParser()
parser.add_argument('mode',choices=['prepare','reuse','check','apply','rollback'])
parser.add_argument('release')
parser.add_argument('--reuse-from')
args=parser.parse_args()
release=Path(args.release).resolve()
import pwd
owner=pwd.getpwnam('scccadmin').pw_uid
if release.parent!=Path('/home/scccadmin') or not release.name.startswith('fred-bulk-enrollment-release-') or not release.is_dir() or release.stat().st_uid!=owner or os.geteuid() not in {owner,0}: raise RuntimeError('Expected reviewed scccadmin-owned release and operator/root execution')
os.chmod(release,0o700)
if args.mode=='prepare': prepare(release)
elif args.mode=='reuse':
    prior=Path(args.reuse_from).resolve()
    if prior.parent!=Path('/home/scccadmin') or not prior.name.startswith('fred-bulk-enrollment-release-') or prior.stat().st_uid!=owner: raise RuntimeError('Invalid reviewed prior release')
    reuse_candidate(release,prior)
else:
    manifest=json.loads((release/'manifest.json').read_text())
    if args.mode=='check': guard(release,manifest); permission_preflight(manifest); print('Exact hashes and original ownership/modes match; apply requires sudo/root euid=0; no production changes.')
    elif args.mode=='apply': apply(release,manifest)
    else:
        if os.geteuid()!=0: raise RuntimeError('Rollback requires approved sudo/root euid=0; no live writes attempted')
        restore(release,manifest)
