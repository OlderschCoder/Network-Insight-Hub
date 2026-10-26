import {createRequire} from 'node:module';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {BuildingProbeStore} from './building_probe_store';
import {JobSigner,token,PROBE_SCHEMA,type ProbeSnapshot,type ProbeResult} from './building_probe_protocol';
const url=process.env.BUILDING_PROBE_TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.pathname!=='/buildingprobetest')throw new Error('Capacity SQL tests require localhost database buildingprobetest.');}
describe.skipIf(!url)('strict logical capacity accounting in PostgreSQL',()=>{
  let pool:any,store:BuildingProbeStore,building:any,a:any,b:any;
  const credentials=new Map<string,string>(),devices=new Map<string,string>();
  const signer=new JobSigner(generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey);
  const snap=(name:string):ProbeSnapshot=>({schema:PROBE_SCHEMA,computerName:name,agentVersion:'0.1.4',capturedAt:new Date().toISOString(),uptimeSeconds:100,diagnosticsMode:'on-demand',capabilities:['throughput-v1'],adapters:[],keyAlert:{installed:false,serviceState:'unavailable',uiProcessCount:0}});
  const beat=(p:any,results:ProbeResult[]=[],running?:string)=>store.heartbeat(p.id,devices.get(p.id)!,credentials.get(p.id)!,snap(p.computerName),results,signer,running);
  const claims=(value:string)=>JSON.parse(Buffer.from(value.split('.')[1]!,'base64url').toString('utf8'));
  const slot=()=>({key:`budget-${randomUUID()}`,profile:'capacity',slotAt:new Date().toISOString(),windowEndsAt:new Date(Date.now()+300000).toISOString(),late:false});
  const queue=async(p:any,s:any,attempt=0)=>{const raw=(await pool.query('SELECT * FROM building_probes WHERE id=$1',[p.id])).rows[0];return (store as any).transaction((client:any)=>(store as any).queueSlot(client,raw,s,attempt));};
  const terminal=(job:any,bytes:number,accounted:boolean,outcome:'completed'|'unavailable'='unavailable'):ProbeResult=>{
    const now=Date.now(),elapsed=bytes?1000:1;
    return {jobId:job.id,attemptId:job.id,capacityJobId:job.capacityJobId,kind:'throughput',selectionRevision:job.selectionRevision,slotAt:job.slotAt,startedAt:new Date(now-Math.min(1000,elapsed)).toISOString(),completedAt:new Date(now).toISOString(),outcome,details:{profile:'capacity',targetId:'sccc-external-v1',bytes,bytesAccounted:accounted,elapsedMs:elapsed,mbps:outcome==='completed'?bytes*8/(elapsed*1000):null,rangeCount:bytes?Math.ceil(bytes/1073741824):0,termination:outcome==='completed'?'byte_budget':'synthetic_terminal_failure'}};
  };
  const view=async(id:string)=>(await store.exportResults('0',1000,true)).capacityWindows.find(w=>w.capacityJobId===id)!;
  beforeAll(async()=>{
    const pg=createRequire(import.meta.url)('pg');pool=new pg.Pool({connectionString:url,max:4});
    await pool.query('DROP TABLE IF EXISTS building_probe_result_exports,building_probe_campus_lease,building_probe_slots,building_probe_jobs,building_probes,building_probe_buildings CASCADE');
    store=new BuildingProbeStore(pool,()=>({enabled:true,targetReady:true,quickConcurrency:4,hourlyConcurrency:1,capacityConcurrency:1}));await store.ensure();
    building=await store.createBuilding('Synthetic capacity building',42);
    const enroll=async(name:string)=>{const bootstrap=token(),p=await store.assign({buildingId:building.id,computerName:name},bootstrap,42),deviceId=randomUUID(),credential=token();devices.set(p.id,deviceId);credentials.set(p.id,credential);await store.enroll({assignmentId:p.id,deviceId,computerName:name,proposedToken:credential},bootstrap);return p;};
    a=await enroll('BUDGET-A');b=await enroll('BUDGET-B');
  });
  beforeEach(async()=>{
    // Reset synthetic execution fixtures; every logical window keeps its own ledger.
    await pool.query("UPDATE building_probe_jobs SET status='cancelled' WHERE status IN ('pending','dispatched')");
    await pool.query("UPDATE building_probe_slots SET state='cancelled' WHERE state NOT IN ('completed','blocked_unknown')");
    await pool.query('UPDATE building_probe_campus_lease SET job_id=NULL,building_id=NULL,lease_until=NULL');
    for(const p of [a,b])await pool.query("UPDATE building_probes SET selected=true,selection_revision=selection_revision+1,first_selected_at=coalesce(first_selected_at,now()-interval '2 minutes'),selected_at=now()-interval '2 minutes',cadence_anchor_at=coalesce(cadence_anchor_at,now()-interval '2 minutes'),cadence_anchor_source=coalesce(cadence_anchor_source,'selection-time-fallback'),cadence_anchor_resolved_at=coalesce(cadence_anchor_resolved_at,now()-interval '2 minutes'),activation_at=now()-interval '2 minutes',reporting_since=now()-interval '1 hour',last_seen=now(),snapshot=$2::jsonb WHERE id=$1",[p.id,JSON.stringify(snap(p.computerName))]);
  });
  afterAll(async()=>{await pool?.end();});
  it('serializes concurrent reservations for one logical building/window',async()=>{
    const s=slot(),reserved=await Promise.all([queue(a,s),queue(b,s)]);expect(reserved.filter(Boolean)).toHaveLength(1);
    const row=(await pool.query('SELECT * FROM building_probe_slots WHERE key=$1',[s.key])).rows[0];expect(Number(row.bytes_reserved)).toBe(10000000000);expect(Number(row.bytes_validated)).toBe(0);
    expect((await pool.query('SELECT count(*) FROM building_probe_jobs WHERE capacity_job_id=$1',[row.capacity_job_id])).rows[0].count).toBe('1');
    await expect(pool.query('UPDATE building_probe_slots SET bytes_validated=1 WHERE key=$1',[s.key])).rejects.toMatchObject({code:'23514'});
  });
  it('settles a terminal attempt once and grants only the remaining seven GB to one alternate',async()=>{
    const s=slot();expect(await queue(a,s)).toBe(true);const first=claims((await beat(a)).job!),initial=await view(first.capacityJobId);
    const failed=terminal(first,3000000000,true);await Promise.all([beat(a,[failed]),beat(a,[failed])]);
    const reserved=await view(first.capacityJobId);expect(reserved.bytesValidated).toBe(3000000000);expect(reserved.bytesReserved).toBe(7000000000);expect(reserved.remainingBytes).toBe(0);expect(reserved.attempts).toHaveLength(2);
    const second=claims((await beat(b)).job!);expect(second.id).not.toBe(first.id);expect(second.capacityJobId).toBe(first.capacityJobId);expect(second.options.maxBytes).toBe(7000000000);expect(second.options.timeoutSeconds).toBeLessThanOrEqual(900);expect(second.expiresAt).toBeLessThanOrEqual(Math.floor(Date.parse(initial.deadlineAt!)/1000));
    expect((await view(first.capacityJobId)).firstDispatchedAt).toBe(initial.firstDispatchedAt);expect((await view(first.capacityJobId)).deadlineAt).toBe(initial.deadlineAt);
    const done=terminal(second,7000000000,true,'completed');await Promise.all([beat(b,[done]),beat(b,[done])]);
    const complete=await view(first.capacityJobId);expect(complete).toMatchObject({bytesValidated:10000000000,bytesReserved:0,remainingBytes:0,state:'completed'});expect(complete).not.toHaveProperty('deviceId');expect(complete.attempts.map((x:any)=>x.deviceId).sort()).toEqual([devices.get(a.id),devices.get(b.id)].sort());expect(await queue(a,s,1)).toBe(false);
  });
  it('settles a proven one-GiB stopped boundary and grants exactly 8,926,258,176 bytes to the alternate',async()=>{
    const s=slot();await queue(a,s);const first=claims((await beat(a)).job!),original=await view(first.capacityJobId);
    const stopped=terminal(first,1073741824,true);stopped.outcome='cancelled';stopped.details.termination='verified_range_boundary';
    await beat(a,[stopped]);const next=claims((await beat(b)).job!);
    expect(next.capacityJobId).toBe(first.capacityJobId);expect(next.options.maxBytes).toBe(8926258176);expect(next.expiresAt).toBeLessThanOrEqual(Math.floor(Date.parse(original.deadlineAt!)/1000));
    const current=await view(first.capacityJobId);expect(current.deadlineAt).toBe(original.deadlineAt);expect(current.bytesValidated).toBe(1073741824);expect(current.bytesReserved).toBe(8926258176);expect(current.remainingBytes).toBe(0);
  });
  it('freezes an unknown terminal prefix and rejects a changed retry that tries to reclaim its reservation',async()=>{
    const s=slot();await queue(a,s);const first=claims((await beat(a)).job!),unknown=terminal(first,1000000000,false);
    await beat(a,[unknown]);await beat(a,[unknown]);
    let current=await view(first.capacityJobId);expect(current).toMatchObject({bytesValidated:0,bytesReserved:10000000000,remainingBytes:0,state:'blocked_unknown'});expect(current.attempts[0]).toMatchObject({reportedBytes:1000000000,bytesAccounted:false,outcome:'unavailable'});expect(current.attempts[0].completedAt).toBeDefined();
    await expect(beat(a,[{...unknown,details:{...unknown.details,bytes:0,bytesAccounted:true}}])).rejects.toMatchObject({status:409});
    expect(await queue(b,s,1)).toBe(false);current=await view(first.capacityJobId);expect(current.bytesReserved).toBe(10000000000);expect(current.attempts).toHaveLength(1);
  });
  it('accepts a verified first range plus a failed next send as immutable unknown accounting',async()=>{
    const s=slot();await queue(a,s);const first=claims((await beat(a)).job!),unknown=terminal(first,1073741824,false);
    unknown.details.rangeCount=2;unknown.details.termination='send_failed';unknown.details.segments=[{ordinal:0,requestedBytes:1073741824,bytes:1073741824,status:206,elapsedMs:500},{ordinal:1,requestedBytes:1073741824,bytes:0,status:0,elapsedMs:500}];
    expect((await beat(a,[unknown])).acceptedResults).toContain(first.id);expect((await beat(a,[unknown])).acceptedResults).toContain(first.id);
    const current=await view(first.capacityJobId);expect(current).toMatchObject({bytesValidated:0,bytesReserved:10000000000,remainingBytes:0,state:'blocked_unknown'});expect(current.attempts).toHaveLength(1);expect(current.attempts[0]).toMatchObject({reportedBytes:1073741824,bytesAccounted:false,outcome:'unavailable'});expect(await queue(b,s,1)).toBe(false);
  });
  it('retains unknown bytes after lease loss, and a late full completion only settles/report-retries without new traffic',async()=>{
    const s=slot();await queue(a,s);const first=claims((await beat(a)).job!);
    await pool.query("UPDATE building_probe_campus_lease SET lease_until=now()-interval '1 second' WHERE job_id=$1",[first.id]);
    await pool.query("UPDATE building_probe_jobs SET dispatched_at=now()-interval '5 seconds',lease_expires_at=now()-interval '1 second' WHERE id=$1",[first.id]);
    await beat(a,[],first.id);expect(await queue(b,s,1)).toBe(false);expect(await view(first.capacityJobId)).toMatchObject({bytesValidated:0,bytesReserved:10000000000,remainingBytes:0,state:'blocked_unknown'});
    const full=terminal(first,10000000000,true,'completed');full.startedAt=new Date(Date.now()-4000).toISOString();full.completedAt=new Date(Date.now()-2000).toISOString();
    await Promise.all([beat(a,[full]),beat(a,[full])]);await beat(b);
    expect(await view(first.capacityJobId)).toMatchObject({bytesValidated:10000000000,bytesReserved:0,remainingBytes:0,state:'completed'});expect(await queue(b,s,1)).toBe(false);
    expect((await pool.query('SELECT count(*) FROM building_probe_jobs WHERE capacity_job_id=$1',[first.capacityJobId])).rows[0].count).toBe('1');
    const samples=(await store.exportResults('0',1000,true)).results.filter(r=>r.capacityJobId===first.capacityJobId);expect(samples).toHaveLength(1);expect(samples[0].attemptId).toBe(first.id);
  });
  it('releases only an unsigned offline attempt and keeps the logical ID for the first dispatched alternate',async()=>{
    const s=slot();await queue(a,s);const pending=(await pool.query('SELECT * FROM building_probe_jobs WHERE slot_key=$1',[s.key])).rows[0];expect(pending.signed_job).toBeNull();
    await pool.query("UPDATE building_probe_jobs SET expires_at=now()-interval '1 second' WHERE id=$1",[pending.id]);await pool.query("UPDATE building_probe_campus_lease SET lease_until=now()-interval '1 second' WHERE job_id=$1",[pending.id]);
    const next=claims((await beat(b)).job!);expect(next.capacityJobId).toBe(pending.capacity_job_id);expect(next.id).not.toBe(pending.id);expect(next.options.maxBytes).toBe(10000000000);
    const first=(await pool.query('SELECT reserved_bytes,signed_job FROM building_probe_jobs WHERE id=$1',[pending.id])).rows[0];expect(Number(first.reserved_bytes)).toBe(0);expect(first.signed_job).toBeNull();
    const current=await view(next.capacityJobId);expect(current.attempts).toHaveLength(2);expect(current.bytesReserved).toBe(10000000000);expect(current.deadlineAt).toBeDefined();
    await beat(b,[terminal(next,0,true)]);expect(await queue(a,s,1)).toBe(false);
  });
  it('never resets an elapsed logical deadline when unused accounted bytes remain',async()=>{
    const s=slot();await queue(a,s);const first=claims((await beat(a)).job!);const deadline=new Date(Date.now()-1000).toISOString();
    await pool.query('UPDATE building_probe_slots SET deadline_at=$2 WHERE capacity_job_id=$1',[first.capacityJobId,deadline]);
    await beat(a,[terminal(first,3000000000,true)]);expect(await queue(b,s,1)).toBe(false);
    expect(await view(first.capacityJobId)).toMatchObject({deadlineAt:deadline,bytesValidated:3000000000,bytesReserved:0,remainingBytes:7000000000,state:'partial'});
  });
  it('shrinks an alternate execution lease to the original deadline when fewer than thirty seconds remain',async()=>{
    const s=slot();await queue(a,s);const first=claims((await beat(a)).job!),deadline=new Date(Date.now()+20000).toISOString();
    // Synthetic clock advance preserves the original first-dispatch +900s relationship.
    await pool.query("UPDATE building_probe_slots SET first_dispatched_at=$2::timestamptz-interval '900 seconds',deadline_at=$2 WHERE capacity_job_id=$1",[first.capacityJobId,deadline]);
    await beat(a,[terminal(first,3000000000,true)]);const response=await beat(b),second=claims(response.job!);
    expect(second.capacityJobId).toBe(first.capacityJobId);expect(second.options.maxBytes).toBe(7000000000);expect(second.options.timeoutSeconds).toBeLessThanOrEqual(20);expect(second.expiresAt).toBeLessThanOrEqual(Math.floor(Date.parse(deadline)/1000));expect(Date.parse(response.leaseExpiresAt!)).toBeLessThanOrEqual(Date.parse(deadline));expect((await view(first.capacityJobId)).deadlineAt).toBe(deadline);
  });
});
