import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { editablePath, shaPattern } from './policy.mjs';
const exec = promisify(execFile);
const workspace = '/var/lib/fred-development/workspace';
const control = '/var/lib/fred-development/control';
const socket = '/run/fred-development/control.sock';
const digest = text => createHash('sha256').update(text).digest('hex');
let running = false;
let latest = null;
let releaseState = null;
let lock = Promise.resolve();
const git = async args => (await exec('/usr/bin/git', ['-c','safe.directory='+workspace,'-c','core.hooksPath=/dev/null',...args], { cwd:workspace, maxBuffer:2_000_000 })).stdout;
const audit = async entry => fs.appendFile(`${control}/audit.jsonl`, JSON.stringify({at:new Date().toISOString(),...entry})+'\n', {mode:0o600});

async function safeFile(name, create = false) {
  if (!editablePath(name)) throw new Error('Path is outside the editable application boundary.');
  let current = workspace;
  const parts = name.split('/');
  for (let i=0;i<parts.length;i++) {
    current = path.join(current,parts[i]);
    const stat = await fs.lstat(current).catch(e => {if(e.code!=='ENOENT') throw e; return null;});
    if (stat?.isSymbolicLink()) throw new Error('Symlinks are not allowed.');
    if (!stat && i < parts.length-1) {
      if (!create) throw new Error('Directory does not exist.');
      await fs.mkdir(current, {mode:0o755});
      await fs.chown(current, (await fs.stat(workspace)).uid, (await fs.stat(workspace)).gid);
    }
    if (stat && i<parts.length-1 && !stat.isDirectory()) throw new Error('Invalid parent directory.');
    if (stat && i===parts.length-1 && (!stat.isFile() || stat.nlink !== 1)) throw new Error('Only ordinary unlinked files are editable.');
  }
  return current;
}
async function sourceHash() {
  const names = (await git(['ls-files','--cached','--others','--exclude-standard','-z'])).split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const name of names) {
    const file=path.join(workspace,name);const stat=await fs.lstat(file).catch(()=>null);
    if(stat?.isSymbolicLink()) throw new Error('Source contains a symlink.');
    hash.update(name+'\0');hash.update(stat?.isFile()?await fs.readFile(file):'DELETED');
  }
  return hash.digest('hex');
}
async function startValidation(actor) {
  if(running) throw new Error('Validation is already running.');
  const revision=await sourceHash();const id=randomUUID();
  latest={id,revision,status:'running',startedAt:new Date().toISOString(),actor};running=true;
  await fs.writeFile(`${control}/latest.json`,JSON.stringify(latest));
  const protectedPaths=JSON.parse(await fs.readFile('/opt/fred-development/protected-paths.json','utf8'));
  const args=['--quiet','--wait','--collect',`--unit=fred-validation-${id}`,'-p','StandardOutput=journal','-p','StandardError=journal',
    '-p','User=fred-code','-p','Group=fred-code','-p','NoNewPrivileges=yes','-p','PrivateNetwork=yes',
    '-p','PrivateTmp=yes','-p','TemporaryFileSystem=/run:ro','-p','PrivateDevices=yes','-p','ProtectHome=yes','-p','ProtectSystem=strict','-p','ProtectProc=invisible',
    '-p','ProtectKernelTunables=yes','-p','ProtectKernelModules=yes','-p','ProtectControlGroups=yes',
    '-p','RestrictSUIDSGID=yes','-p','CapabilityBoundingSet=','-p','RestrictAddressFamilies=AF_UNIX',
    '-p','MemoryMax=3G','-p','CPUQuota=150%','-p','RuntimeMaxSec=600','-p','TasksMax=128',
    '-p',`ReadWritePaths=${workspace}`,'-p',`ReadOnlyPaths=${protectedPaths.join(' ')}`,
    '-p',`InaccessiblePaths=${control} /etc/sccc-api-secrets.env /etc/sccc-api-webex.env`,
    '/usr/bin/node','/opt/fred-development/run-validation.mjs'];
  await audit({actor,action:'validate',id,revision});
  const child=spawn('/usr/bin/systemd-run',args,{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}});
  let log='';const collect=data=>{log=(log+data.toString()).slice(-60000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
  let finished=false;
  const finish=async(code,error)=>{
    if(finished)return;finished=true;
    try {
      log = (await exec('/usr/bin/journalctl',['-u',`fred-validation-${id}`,'--no-pager','-n','160','-o','cat'],{maxBuffer:100000})).stdout.slice(-60000);
      const unchanged=(await sourceHash())===revision;
      latest={...latest,status:code===0&&unchanged?'passed':'failed',exitCode:code,sourceUnchanged:unchanged,finishedAt:new Date().toISOString(),log:error||log};
      await fs.writeFile(`${control}/latest.json`,JSON.stringify(latest));await audit({actor,action:'validation-result',id,status:latest.status});
    } catch(e) {latest={...latest,status:'failed',log:'Unable to verify source after validation.'};await fs.writeFile(`${control}/latest.json`,JSON.stringify(latest));}
    finally {running=false;}
  };
  child.on('error',error=>void finish(-1,error.message));child.on('close',code=>void finish(code));
  return latest;
}


async function safeTree(directory) {
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);const stat=await fs.lstat(file);
    if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))throw new Error('Build output contains unsafe file types.');
    if(stat.isDirectory())await safeTree(file);
  }
}
async function publishRelease(actor, revision, rollback=false) {
  if(running)throw new Error('Another operation is running.');
  let id=releaseState?.id;
  if(rollback){if(releaseState?.status!=='deployed')throw new Error('No deployed release to roll back.');}
  else {
    if(!latest||latest.status!=='passed'||revision!==latest.revision||revision!==await sourceHash())throw new Error('Exact current validated revision required.');
    id=latest.id;
    const files=[...new Set(((await git(['diff','--name-only']))+'\n'+await git(['ls-files','--others','--exclude-standard'])).split('\n').filter(Boolean))];
    if(!files.length)throw new Error('No source changes to deploy.');
    if(files.some(file=>!editablePath(file)))throw new Error('Release includes a protected source path.');
    const dest=`${control}/releases/${id}`;
    await fs.mkdir(`${control}/releases`,{recursive:true,mode:0o700});
    await fs.mkdir(dest,{mode:0o700});
    for(const [from,to] of [['artifacts/it-reporting/dist/public','frontend'],['artifacts/api-server/dist','backend']]){
      await safeTree(`${workspace}/${from}`);await fs.cp(`${workspace}/${from}`,`${dest}/${to}`,{recursive:true});
    }
    for(const file of files){await safeFile(file);await fs.mkdir(path.dirname(`${dest}/source/${file}`),{recursive:true});await fs.copyFile(`${workspace}/${file}`,`${dest}/source/${file}`);}
    await fs.writeFile(`${dest}/manifest.json`,JSON.stringify({id,revision,actor,files},null,2));
  }
  running=true;releaseState={id,revision:revision||releaseState.revision,status:rollback?'rolling_back':'deploying',actor,startedAt:new Date().toISOString()};
  await fs.writeFile(`${control}/release-state.json`,JSON.stringify(releaseState));
  await audit({actor,action:rollback?'rollback':'publish',id,revision});
  const command=['--quiet','--wait','--pipe','--collect',`--unit=fred-publish-${randomUUID()}`,'-p','User=root','-p','ProtectSystem=strict','-p','NoNewPrivileges=yes','-p','CapabilityBoundingSet=CAP_DAC_OVERRIDE CAP_FOWNER','-p','PrivateTmp=yes','-p',`ReadWritePaths=${control} /home/scccadmin/apps/Network-Insight-Hub`,'-p','RuntimeMaxSec=120','/usr/bin/node','/opt/fred-development/publish.mjs',rollback?'rollback':'publish',id];
  const child=spawn('/usr/bin/systemd-run',command,{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}});let log='';let done=false;
  const collect=data=>{log=(log+data.toString()).slice(-12000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
  const finish=async code=>{if(done)return;done=true;releaseState={...releaseState,status:code===0?(rollback?'rolled_back':'deployed'):'failed',log,finishedAt:new Date().toISOString()};await fs.writeFile(`${control}/release-state.json`,JSON.stringify(releaseState));await audit({actor,action:'release-result',id,status:releaseState.status});running=false;};
  child.on('error',error=>{log+=error.message;void finish(-1);});child.on('close',code=>void finish(code));
  return releaseState;
}

async function action(input) {
  const actor=String(input.actor||'').slice(0,120);if(!actor)throw new Error('Authenticated actor required.');
  if(input.action==='status')return {release:releaseState,workspace,mode:'autonomous application editing and sandboxed validation',production:'CIO approves exact validated revisions in the Development tab',running,latest};
  if(running && !['status'].includes(input.action))throw new Error('Wait for validation to finish before editing or inspecting the workspace.');
  if(input.action==='publish')return publishRelease(actor,input.revision);
  if(input.action==='rollback')return publishRelease(actor,null,true);
  if(input.action==='list') {
    const prefix=String(input.path||'');if(prefix.includes('..')||prefix.length>300)throw new Error('Invalid prefix.');
    const names=(await git(['ls-files','--cached','--others','--exclude-standard'])).split('\n').filter(name=>editablePath(name)&&name.startsWith(prefix));
    return {files:names.slice(0,300),total:names.length,truncated:names.length>300};
  }
  if(input.action==='read') {
    const file=await safeFile(input.path);const text=await fs.readFile(file,'utf8');if(text.length>1_000_000)throw new Error('File too large.');
    const start=Math.max(1,Number(input.startLine)||1),end=Math.min(start+499,Number(input.endLine)||start+199);const lines=text.split('\n');
    return {path:input.path,sha256:digest(text),totalLines:lines.length,startLine:start,content:lines.slice(start-1,end).join('\n')};
  }
  if(['write','replace'].includes(input.action)) {
    const file=await safeFile(input.path,true);const before=await fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(before!==null && (!shaPattern.test(input.expectedSha256||'')||digest(before)!==input.expectedSha256))throw new Error('File changed. Read it again and supply its current sha256.');
    if(before===null && input.expectedSha256)throw new Error('New file must not have an expected hash.');
    let after=input.content;
    if(input.action==='replace') {
      if(before===null||typeof input.find!=='string'||!input.find||typeof input.replacement!=='string')throw new Error('Replacement requires existing file, exact find text and replacement.');
      if(before.split(input.find).length!==2)throw new Error('Find text must match exactly once.');
      after=before.replace(input.find,()=>input.replacement);
    }
    if(typeof after!=='string'||after.length>250000||after.includes('\0'))throw new Error('Content must be text up to 250000 characters.');
    const temporary=file+'.fred-tmp';await fs.writeFile(temporary,after,{flag:'wx',mode:0o644});
    const owner=await fs.stat(workspace);await fs.chown(temporary,owner.uid,owner.gid);await fs.rename(temporary,file);
    await audit({actor,action:input.action,path:input.path,before:before===null?null:digest(before),after:digest(after)});
    latest=null;await fs.writeFile(`${control}/latest.json`,'null');
    return {saved:true,path:input.path,sha256:digest(after),productionChanged:false};
  }
  if(input.action==='diff') {
    const untracked=await git(['ls-files','--others','--exclude-standard']);
    let diff=(await git(['diff','--no-ext-diff','--stat']))+'\n'+await git(['diff','--no-ext-diff']);
    for(const file of untracked.split('\n').filter(Boolean))diff+='\nNEW FILE: '+file+'\n'+await fs.readFile(await safeFile(file),'utf8');
    if(diff.length>300000)throw new Error('Changes exceed the review limit. Split this into smaller releases.');
    return {diff,untracked};
  }
  if(input.action==='validate')return startValidation(actor);
  if(input.action==='prepare_release') {
    if(!latest||latest.status!=='passed'||latest.revision!==await sourceHash())throw new Error('Current source must pass independent validation first.');
    const manifest={...latest,log:undefined,requestedBy:actor,summary:String(input.summary||'').slice(0,2000),requiresOperatorApproval:true};
    await fs.writeFile(`${control}/release-${latest.id}.json`,JSON.stringify(manifest,null,2));
    await audit({actor,action:'prepare_release',id:latest.id});return manifest;
  }
  throw new Error('Unsupported action.');
}
await fs.mkdir(control,{recursive:true,mode:0o700});
latest=JSON.parse(await fs.readFile(`${control}/latest.json`,'utf8').catch(()=>'null'));
releaseState=JSON.parse(await fs.readFile(`${control}/release-state.json`,'utf8').catch(()=>'null'));
if(latest?.status==='running')latest={...latest,status:'interrupted'};
await fs.mkdir(path.dirname(socket),{recursive:true});await fs.unlink(socket).catch(e=>{if(e.code!=='ENOENT')throw e;});
const server=http.createServer(async(req,res)=>{
  try {
    if(req.method!=='POST'||req.url!=='/action')throw new Error('Unsupported endpoint.');
    let body='';for await(const chunk of req){body+=chunk;if(body.length>350000)throw new Error('Request too large.');}
    const input=JSON.parse(body);const task=lock.then(()=>action(input));lock=task.catch(()=>{});const result=await task;
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
server.requestTimeout=30000;server.listen(socket,async()=>{const {stdout}=await exec('/usr/bin/id',['-g','scccadmin']);await fs.chown(socket,0,Number(stdout.trim()));await fs.chmod(socket,0o660);});
