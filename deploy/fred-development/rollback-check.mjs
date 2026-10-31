import http from 'node:http';
const result=await new Promise((resolve,reject)=>{
  const request=http.request({socketPath:'/run/fred-development/control.sock',method:'POST',path:'/action',headers:{'Content-Type':'application/json'}},response=>{
    let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>response.statusCode===200?resolve(text):reject(new Error(text)));
  });request.on('error',reject);request.end(JSON.stringify({action:'rollback',actor:'authorized-deployment-recovery-check'}));
});
console.log(result);
