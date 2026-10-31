import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { editablePath } from './policy.mjs';
const [mode,id]=process.argv.slice(2);
if(!['publish','rollback'].includes(mode)||!/^[0-9a-f-]{36}$/.test(id||''))throw new Error('Invalid release request');
const release=`/var/lib/fred-development/control/releases/${id}`;
const production='/home/scccadmin/apps/Network-Insight-Hub';
const frontend='artifacts/it-reporting/dist/public',backend='artifacts/api-server/dist';
const copy=async(from,to)=>{await fs.mkdir(to,{recursive:true});await fs.cp(from,to,{recursive:true,force:true});};
const restart=()=>execFileSync('/usr/bin/systemctl',['restart','sccc-api'],{stdio:'inherit'});
async function healthy(){for(let i=0;i<15;i++){try{const r=await fetch('http://127.0.0.1:8080/api/healthz',{signal:AbortSignal.timeout(2000)});const body=await r.json();if(r.ok&&body.status==='ok')return true;}catch{}await new Promise(r=>setTimeout(r,2000));}return false;}
async function restore(){
  const sources=JSON.parse(await fs.readFile(`${release}/before/sources.json`,'utf8'));
  for(const entry of sources){
    if(!editablePath(entry.file))throw new Error('Protected source in rollback.');
    const target=path.join(production,entry.file);
    if(entry.existed)await fs.copyFile(path.join(release,'before/source',entry.file),target);
    else await fs.rm(target,{force:true});
  }
  await copy(`${release}/before/backend`,`${production}/${backend}`);await copy(`${release}/before/frontend`,`${production}/${frontend}`);restart();if(!await healthy())throw new Error('Rollback health failed; operator intervention required.');
}
if(mode==='rollback'){await restore();console.log('ROLLED_BACK');process.exit(0);}
const manifest=JSON.parse(await fs.readFile(`${release}/manifest.json`,'utf8'));
await fs.mkdir(`${release}/before`);
const sources=[];
for(const file of manifest.files){
  if(!editablePath(file))throw new Error('Protected source in release.');
  const target=path.join(production,file);
  const stat=await fs.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(stat&&!stat.isFile())throw new Error('Unsafe source destination.');
  sources.push({file,existed:!!stat});
  if(stat){const backup=path.join(release,'before/source',file);await fs.mkdir(path.dirname(backup),{recursive:true});await fs.copyFile(target,backup);}
}
await fs.writeFile(`${release}/before/sources.json`,JSON.stringify(sources));
await copy(`${production}/${frontend}`,`${release}/before/frontend`);
await copy(`${production}/${backend}`,`${release}/before/backend`);
try{
  await copy(`${release}/backend`,`${production}/${backend}`);
  await copy(`${release}/frontend/assets`,`${production}/${frontend}/assets`);
  await fs.copyFile(`${release}/frontend/index.html`,`${production}/${frontend}/index.html`);
  restart();if(!await healthy())throw new Error('New release did not pass health checks.');
  for(const file of manifest.files){if(!editablePath(file))throw new Error('Protected source in release.');const target=path.join(production,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(release,'source',file),target);}
  console.log('DEPLOYED_HEALTHY');
}catch(error){await restore();console.error(error.message);console.error('ROLLED_BACK');process.exit(1);}
