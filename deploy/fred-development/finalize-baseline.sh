#!/usr/bin/env bash
set -euo pipefail
work=/var/lib/fred-development/workspace
stage=/home/ITADMIN/releases/fred-20261030-usability/stage
python3 - <<'PY'
import os,shutil
from pathlib import Path
stage=Path('/home/ITADMIN/releases/fred-20261030-usability/stage')
work=Path('/var/lib/fred-development/workspace')
for base,dirs,files in os.walk(stage/'artifacts/it-reporting'):
    dirs[:]=[d for d in dirs if d not in ['node_modules','dist'] and not d.startswith('.')]
    for name in files:
        source=Path(base)/name
        if source.is_symlink() or source.suffix.lower() not in ['.png','.jpg','.jpeg','.svg','.webp','.woff','.woff2','.ico']:continue
        target=work/source.relative_to(stage);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
PY
cp /opt/fred-development/acceptance/fred_development.test.ts "$work/artifacts/api-server/src/lib/"
git -c safe.directory="$work" -C "$work" add .
git -c safe.directory="$work" -C "$work" commit -m 'Complete initial production integration and protected acceptance baseline'
chown -R fred-code:fred-code "$work"
node --input-type=module - <<'JS'
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {editablePath} from '/opt/fred-development/policy.mjs';
const root='/var/lib/fred-development/workspace';
const files=execFileSync('git',['-c','safe.directory='+root,'-C',root,'ls-files'],{encoding:'utf8'}).trim().split('\n');
const protectedPaths=files.filter(f=>!editablePath(f)).map(f=>root+'/'+f);
for(const p of ['.git','node_modules','artifacts/api-server/node_modules','artifacts/it-reporting/node_modules','lib/db/node_modules','lib/api-client-react/node_modules','lib/api-zod/node_modules','lib/api-spec/node_modules'])if(fs.existsSync(root+'/'+p))protectedPaths.push(root+'/'+p);
fs.writeFileSync('/opt/fred-development/protected-paths.json',JSON.stringify(protectedPaths));
JS
