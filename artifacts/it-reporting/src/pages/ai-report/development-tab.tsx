import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/authFetch";

export function DevelopmentTab() {
  const [state,setState]=useState<any>(null),[diff,setDiff]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[reviewed,setReviewed]=useState(false);
  const base=`${import.meta.env.BASE_URL}api/fred-development`;
  const load=async()=>{
    try{const response=await authFetch(`${base}/status`);const data=await response.json();if(!response.ok)throw new Error(data.error);setState(data);setError("");
      if(!data.running){const r=await authFetch(`${base}/diff`);const d=await r.json();if(!r.ok)throw new Error(d.error||"Unable to load changes for review");setDiff(`${d.diff||""}\nNew files:\n${d.untracked||"none"}`);}
    }catch(e){setError(e instanceof Error?e.message:"Unable to load development workspace");}
  };
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),10000);return()=>clearInterval(timer);},[]);
  useEffect(()=>setReviewed(false),[state?.latest?.revision]);
  const release=async(action:"publish"|"rollback")=>{
    setBusy(true);setError("");
    try{const r=await authFetch(`${base}/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmed:true,revision:state?.latest?.revision})});const d=await r.json();if(!r.ok)throw new Error(d.error);await load();}
    catch(e){setError(e instanceof Error?e.message:"Release failed");}finally{setBusy(false);}
  };
  return <section className="space-y-4 rounded-lg border bg-card p-5">
    <h2 className="text-lg font-semibold">Fred development workspace</h2>
    <p className="text-sm text-muted-foreground">Ask Fred to improve a page or change its application code. It can edit and test in an isolated workspace. Review the exact changes here before deploying.</p>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" onClick={()=>void load()}>Refresh</Button><span role="status">Validation: {state?.latest?.status||"Not run"}{state?.running?" — working":""}</span></div>
    {state?.release&&<p className="text-sm">Last release: {state.release.status} {state.release.finishedAt||""}</p>}
    <details open><summary className="cursor-pointer font-medium">Changes to review</summary><pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">{diff||"No changes yet."}</pre></details>
    <details><summary className="cursor-pointer font-medium">Validation evidence</summary><pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">{state?.latest?.log||"No completed validation yet."}</pre></details>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} />I reviewed these changes and authorize replacing the live application with this validated revision.</label>
    <div className="flex flex-wrap gap-3"><Button disabled={!!error||!reviewed||busy||state?.running||state?.latest?.status!=="passed"} onClick={()=>void release("publish")}>Deploy validated changes</Button>
    <Button variant="outline" disabled={busy||state?.running||state?.release?.status!=="deployed"} onClick={()=>{if(window.confirm("Restore the application artifacts from before Fred's last deployment?"))void release("rollback");}}>Roll back last release</Button></div>
    <p className="text-xs text-muted-foreground">Deployment checks application health and restores the previous artifacts if startup fails. This workflow does not run database migrations. Credentials, security controls, and acceptance tests are outside Fred's editable scope.</p>
  </section>;
}
