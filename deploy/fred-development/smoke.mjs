import http from 'node:http';
import assert from 'node:assert/strict';
function call(input){return new Promise((resolve,reject)=>{const req=http.request({socketPath:'/run/fred-development/control.sock',path:'/action',method:'POST',headers:{'Content-Type':'application/json'}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});req.on('error',reject);req.end(JSON.stringify({...input,actor:'deployment-validation'}));});}
const status=await call({action:'status'});assert.equal(status.status,200);
const list=await call({action:'list',path:'artifacts/it-reporting/src/pages/ai-report/'});assert.ok(list.data.files.length>0);
const read=await call({action:'read',path:'artifacts/it-reporting/src/pages/ai-report/index.tsx',startLine:1,endLine:10});assert.equal(read.status,200);assert.equal(read.data.sha256.length,64);
for(const p of ['../outside.ts','artifacts/api-server/src/routes/auth.ts','artifacts/api-server/src/lib/fred_development.ts'])assert.equal((await call({action:'write',path:p,content:'denied'})).status,400);
assert.equal((await call({action:'replace',path:'artifacts/it-reporting/src/pages/ai-report/index.tsx',expectedSha256:'0'.repeat(64),find:'abc',replacement:'def'})).status,400);
console.log('CONTROLLER_READ_AND_WRITE_BOUNDARIES_PASSED');
const run=await call({action:'validate'});assert.equal(run.status,200);console.log('VALIDATION_STARTED',run.data.id);
