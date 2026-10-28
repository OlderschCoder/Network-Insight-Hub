#!/usr/bin/env python3
"""Guarded API/UI release for the disabled LibreSpeed V2 control plane.

Builds from an exact live-source baseline and preserves the existing service
policy. It does not install an endpoint agent, enable LibreSpeed, schedule a
measurement, or change the private collector.
"""
import argparse, ast, hashlib, json, os, pwd, runpy
from pathlib import Path

HERE = Path(__file__).resolve().parent
library = HERE / 'release-bulk-enrollment.py'
tree = ast.parse(library.read_text()); definitions = []
for node in tree.body:
    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'parser' for t in node.targets):
        break
    definitions.append(node)
base = {}; exec(compile(ast.Module(body=definitions, type_ignores=[]), str(library), 'exec'), base)
policy_tools = runpy.run_path(str(HERE / 'release-scoped-claim.py'))
APP = base['APP']; digest = base['digest']

EXPECTED = {
    'artifacts/api-server/src/lib/building_diagnostics.ts',
    'artifacts/api-server/src/lib/building_diagnostics_store.ts',
    'artifacts/api-server/src/routes/building_diagnostics.ts',
    'artifacts/api-server/src/lib/building_performance.ts',
    'artifacts/it-reporting/src/lib/diagnosticsEntry.ts',
    'artifacts/it-reporting/src/pages/network/building-diagnostics.tsx',
    'artifacts/it-reporting/src/pages/network/buildings.tsx',
}

def policy(quiet=True):
    if quiet and policy_tools['active_measurements']() != 0:
        raise RuntimeError('Wait for a quiet measurement window before restarting the API')
    return {'unit': policy_tools['unit_hash'](), 'environmentHashes': policy_tools['config_hashes']()}

def contract(release):
    data = json.loads((release / 'source-pins.json').read_text())
    if set(data) != EXPECTED:
        raise RuntimeError('Exactly the seven reviewed LibreSpeed API/UI paths are required')
    for relative, pins in data.items():
        if set(pins) != {'old', 'new'} or not all(isinstance(pins[key], str) and len(pins[key]) == 64 for key in ('old', 'new')):
            raise RuntimeError('Invalid reviewed source pins')
        if digest(release / 'overlay' / relative) != pins['new']:
            raise RuntimeError('Reviewed candidate source changed')
    base['SOURCE'] = sorted(EXPECTED)
    return data

def dependencies():
    names = ['release-librespeed-v2.py', 'release-bulk-enrollment.py', 'release-scoped-claim.py']
    return {name: digest(HERE / name) for name in names}

def prepare(release):
    pins = contract(release)
    for relative, value in pins.items():
        if digest(APP / relative) != value['old']:
            raise RuntimeError('Authoritative live source mismatch: ' + relative)
    before = policy(); pid = policy_tools['pid']()
    base['prepare'](release)
    if policy() != before or policy_tools['pid']() != pid:
        raise RuntimeError('Service policy or PID changed during isolated build')
    path = release / 'manifest.json'; manifest = json.loads(path.read_text())
    manifest.update(commit='fb7608b', purpose='Disabled per-interface LibreSpeed V2 control plane and honest building performance UI',
                    policy=before, apiPid=pid, publisherHashes=dependencies(),
                    sourcePinsHash=digest(release / 'source-pins.json'))
    path.write_text(json.dumps(manifest, indent=2))
    print(json.dumps({'status': 'PreparedNotApplied', 'manifestSha256': digest(path), 'productionChanged': False}))

def check(release, manifest_sha):
    contract(release)
    path = release / 'manifest.json'
    if not manifest_sha or digest(path) != manifest_sha.lower():
        raise RuntimeError('Frozen manifest hash required')
    manifest = json.loads(path.read_text())
    if manifest['publisherHashes'] != dependencies() or manifest['sourcePinsHash'] != digest(release / 'source-pins.json'):
        raise RuntimeError('Reviewed publisher or source pin contract changed')
    base['guard'](release, manifest); base['permission_preflight'](manifest)
    if policy() != manifest['policy'] or policy_tools['pid']() != manifest['apiPid']:
        raise RuntimeError('Service policy or process drift before deployment')
    return manifest

def verify_boundaries():
    for path, method in [('/overview', 'GET'), ('/agent/results', 'POST'), ('/measure', 'POST')]:
        if base['request_status']('/api/building-diagnostics' + path, method) != 401:
            raise RuntimeError('Diagnostics authentication boundary changed: ' + path)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'check', 'apply', 'rollback'])
    parser.add_argument('release', type=Path)
    parser.add_argument('--manifest-sha256')
    args = parser.parse_args(); release = args.release.resolve(); owner = pwd.getpwnam('scccadmin').pw_uid
    if release.parent != Path('/home/scccadmin') or not release.name.startswith('fred-librespeed-v2-release-') or release.is_symlink() or release.stat().st_uid != owner or os.geteuid() not in {0, owner}:
        raise RuntimeError('Reviewed private operator-owned release required')
    os.chmod(release, 0o700)
    if args.mode == 'prepare':
        return prepare(release)
    if args.mode == 'rollback':
        contract(release)
        if os.geteuid() != 0 or digest(release / 'manifest.json') != args.manifest_sha256:
            raise RuntimeError('Approved root and frozen manifest required')
        manifest = json.loads((release / 'manifest.json').read_text())
        if manifest['publisherHashes'] != dependencies() or manifest['sourcePinsHash'] != digest(release / 'source-pins.json') or policy() != manifest['policy']:
            raise RuntimeError('Rollback held: publisher, service policy or active measurements require review')
        base['restore'](release, manifest)
        return print(json.dumps({'status': 'RolledBackVerified'}))
    manifest = check(release, args.manifest_sha256)
    if args.mode == 'check':
        return print('Exact live source, artifact, policy, PID and candidate hashes match; no changes.')
    if os.geteuid() != 0:
        raise RuntimeError('Normal authorized sudo required')
    original_replace = base['replace_file']; original_restore = base['restore']; started = False
    def guarded_replace(source, destination, preserve=None):
        nonlocal started
        if not started:
            check(release, args.manifest_sha256); started = True
        return original_replace(source, destination, preserve)
    def guarded_restore(root, saved):
        if policy() != saved['policy']:
            raise RuntimeError('Rollback held: service policy drift requires operator review')
        return original_restore(root, saved)
    base['replace_file'] = guarded_replace; base['restore'] = guarded_restore
    base['apply'](release, manifest)
    try:
        verify_boundaries()
        if policy(quiet=False) != manifest['policy']:
            raise RuntimeError('Service policy changed unexpectedly')
    except Exception:
        base['restore'](release, manifest)
        raise
    print(json.dumps({'status': 'AppliedVerified', 'newApiPid': policy_tools['pid'](),
                      'sourceFiles': len(EXPECTED), 'libreSpeedEnabled': False,
                      'measurementsRequested': 0, 'agentsDeployed': 0}))

if __name__ == '__main__':
    main()
