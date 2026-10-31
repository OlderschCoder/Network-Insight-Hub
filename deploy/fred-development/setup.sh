#!/usr/bin/env bash
set -euo pipefail
prod=/home/scccadmin/apps/Network-Insight-Hub
stage=/home/ITADMIN/releases/fred-20261030-usability/stage
work=/var/lib/fred-development/workspace
if [ -d "$work/.git" ]; then echo 'Workspace already initialized; refusing to replace it.'; exit 1; fi
mkdir -p /etc/sysusers.d
printf 'u fred-code - "Fred isolated builder" /var/lib/fred-development /usr/sbin/nologin\n' > /etc/sysusers.d/fred-code.conf
systemd-sysusers /etc/sysusers.d/fred-code.conf
mkdir -p "$work" /var/lib/fred-development/control
chmod 700 /var/lib/fred-development/control
python3 - <<'PY'
import os, shutil
from pathlib import Path
stage=Path('/home/ITADMIN/releases/fred-20261030-usability/stage')
work=Path('/var/lib/fred-development/workspace')
extensions={'.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.css','.html','.yaml','.yml','.md','.png','.jpg','.jpeg','.svg','.webp','.woff','.woff2','.ico'}
for folder in ['artifacts','lib','scripts']:
    for base,dirs,files in os.walk(stage/folder,followlinks=False):
        dirs[:]=[d for d in dirs if d not in ['node_modules','dist','data','exports','device-configs'] and not d.startswith('.') and '.pre-' not in d]
        for name in files:
            source=Path(base)/name
            if source.is_symlink() or source.suffix not in extensions or name.startswith('.env') or '.before-' in name: continue
            target=work/source.relative_to(stage);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
for name in ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json','.npmrc']:
    if (stage/name).exists():shutil.copyfile(stage/name,work/name)
assets=Path('/home/scccadmin/apps/Network-Insight-Hub/attached_assets')
for source in assets.rglob('*'):
    if source.is_file() and not source.is_symlink() and source.suffix.lower() in ['.png','.jpg','.jpeg','.svg','.webp','.woff','.woff2','.ico']:
        target=work/'attached_assets'/source.relative_to(assets);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
PY
cp -a "$prod/node_modules" "$work/node_modules"
for folder in artifacts/api-server artifacts/it-reporting lib/db lib/api-client-react lib/api-zod lib/api-spec; do
  if [ -d "$prod/$folder/node_modules" ]; then cp -a "$prod/$folder/node_modules" "$work/$folder/node_modules"; fi
done
cp /opt/fred-development/acceptance/*.test.ts "$work/artifacts/api-server/src/lib/"
cp /opt/fred-development/acceptance/fred_app_catalog.test.ts "$work/artifacts/api-server/src/lib/"
printf 'node_modules/\ndist/\n.env*\n*.tsbuildinfo\n*.log\n*.fred-tmp\n' > "$work/.gitignore"
git -C "$work" init -b fred-development
git -C "$work" config user.name 'Fred Development Controller'
git -C "$work" config user.email 'fred-development@localhost'
git -C "$work" add .
git -C "$work" commit -m 'Production source baseline after Fred usability and development integration'
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
echo WORKSPACE_READY
