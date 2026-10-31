import http from 'node:http';
const call=input=>new Promise((resolve,reject)=>{
  const request=http.request({socketPath:'/run/fred-development/control.sock',method:'POST',path:'/action',headers:{'Content-Type':'application/json'}},response=>{
    let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>response.statusCode===200?resolve(JSON.parse(text)):reject(new Error(text)));
  });request.on('error',reject);request.end(JSON.stringify({...input,actor:'authorized-deployment-recovery-check'}));
});
const initial=await call({action:'status'});
if(initial.release?.status!=='rolled_back')throw new Error('Successful rollback required before restore test');
const run=await call({action:'validate'});
for(let attempt=0;attempt<90;attempt++){
  await new Promise(resolve=>setTimeout(resolve,2000));
  const state=await call({action:'status'});
  if(state.latest?.id===run.id&&state.latest.status!=='running'){
    if(state.latest.status!=='passed')throw new Error('Validation failed');
    const release=await call({action:'publish',revision:state.latest.revision});
    console.log('RESTORE_STARTED',release.id);process.exit(0);
  }
}
throw new Error('Validation timed out');
