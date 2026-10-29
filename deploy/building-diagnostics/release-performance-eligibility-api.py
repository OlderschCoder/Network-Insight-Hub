#!/usr/bin/env python3
"""Guarded API-only publisher for enabled-fleet performance eligibility."""
import argparse, ast, json, os
from pathlib import Path

HERE = Path(__file__).resolve().parent
library = HERE / 'release-scoped-claim.py'
tree = ast.parse(library.read_text()); definitions = []
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name == 'main': break
    definitions.append(node)
base = {'__file__': str(Path(__file__).resolve())}
exec(compile(ast.Module(body=definitions, type_ignores=[]), str(library), 'exec'), base)

def load_pins(release):
    raw = json.loads((release / 'source-pins.json').read_text())
    expected = {
        'artifacts/api-server/src/lib/building_diagnostics.ts',
        'artifacts/api-server/src/lib/building_diagnostics_store.ts',
    }
    if set(raw) != expected:
        raise RuntimeError('Exactly the two reviewed API source paths are required')
    pins = {}
    for relative, values in raw.items():
        if set(values) != {'old', 'new'} or not all(isinstance(values[key], str) and len(values[key]) == 64 for key in ('old', 'new')):
            raise RuntimeError('Invalid reviewed source pins')
        if base['digest'](release / 'overlay' / relative) != values['new']:
            raise RuntimeError('Reviewed candidate source changed')
        pins[relative] = (values['old'], values['new'])
    base['PINS'] = pins

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'apply', 'rollback'])
    parser.add_argument('release', type=Path)
    parser.add_argument('--manifest-sha256')
    args = parser.parse_args(); release = args.release.resolve()
    if release.parent != Path('/home/scccadmin') or not release.name.startswith('fred-performance-eligibility-api-release-') or not release.is_dir() or release.is_symlink():
        raise RuntimeError('Approved private release path required')
    load_pins(release)
    if args.mode == 'prepare':
        base['prepare'](release); return
    if not args.manifest_sha256:
        raise RuntimeError('Frozen manifest hash required')
    manifest = base['load'](release, args.manifest_sha256.lower())
    if args.mode == 'apply':
        base['apply'](release, manifest)
    else:
        if os.geteuid() != 0: raise RuntimeError('Normal approved sudo required')
        base['restore'](release, manifest)
        print(json.dumps({'status': 'RolledBackVerified'}))

if __name__ == '__main__': main()
