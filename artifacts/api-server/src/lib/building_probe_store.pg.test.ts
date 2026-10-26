import { createRequire } from 'node:module';
import { generateKeyPairSync,randomUUID } from 'node:crypto';
import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { BuildingProbeStore } from './building_probe_store';
import { JobSigner,token,PROBE_SCHEMA,type ProbeSnapshot,type ProbeResult } from './building_probe_protocol';
const url=process.env.BUILDING_PROBE_TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.pathname!=='/buildingprobetest')throw new Error('Probe SQL tests require localhost database buildingprobetest.');}
describe.skipIf(!url)('retained probe PostgreSQL membership and lane boundaries',()=>{
  let pool:any,store:BuildingProbeStore,building:any,a:any,b:any,c:any;
  let policy={enabled:false,targetReady:false,capacityConcurrency:1};
  const signer=new JobSigner(generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey);
  const credentials=new Map<string,string>();
  const identities=new Map<string,string>();
  const snapshot=(name:string,capability=true):ProbeSnapshot=>({schema:PROBE_SCHEMA,computerName:name,agentVersion:capability?'0.1.4':'0.1.3',capturedAt:new Date().toISOString(),uptimeSeconds:100,diagnosticsMode:'on-demand',adapters:[],keyAlert:{installed:false,serviceState:'unavailable',uiProcessCount:0},...(capability?{capabilities:['throughput-v1'] as ['throughput-v1'],installedAt:new Date().toISOString()}:{})});
  const beat=(probe:any,results:ProbeResult[]=[],runningJobId?:string,capability=true)=>store.heartbeat(probe.id,identities.get(probe.id)!,credentials.get(probe.id)!,snapshot(probe.computerName,capability),results,signer,runningJobId);
  const claims=(value:string)=>JSON.parse(Buffer.from(value.split('.')[1]!,'base64url').toString('utf8'));
  const enroll=async(name:string)=>{const bootstrap=token(),probe=await store.assign({buildingId:building.id,computerName:name},bootstrap,42),deviceId=randomUUID(),credential=token();identities.set(probe.id,deviceId);credentials.set(probe.id,credential);await store.enroll({assignmentId:probe.id,deviceId,computerName:name,proposedToken:credential},bootstrap);return probe;};
  beforeAll(async()=>{
    const pg=createRequire(import.meta.url)('pg');pool=new pg.Pool({connectionString:url,max:4});
    await pool.query('DROP TABLE IF EXISTS building_probe_result_exports,building_probe_campus_lease,building_probe_slots,building_probe_jobs,building_probes,building_probe_buildings CASCADE');
    // Synthetic prior schema exercises migration; the test database is explicitly isolated.
    await pool.query("CREATE TABLE building_probes(id uuid PRIMARY KEY,building_key varchar(160) NOT NULL,building varchar(160) NOT NULL,computer_name varchar(15) NOT NULL,enabled boolean NOT NULL DEFAULT true,adapter_id varchar(100),expected_voice_subnet varchar(64),device_id uuid,bootstrap_hash char(64),bootstrap_expires_at timestamptz,credential_hash char(64),created_by integer,created_at timestamptz DEFAULT now(),last_seen timestamptz,snapshot jsonb)");
    await pool.query("CREATE UNIQUE INDEX building_probes_one_building ON building_probes(building_key) WHERE enabled");
    await pool.query("INSERT INTO building_probes(id,building_key,building,computer_name) VALUES($1,'legacy','Legacy explicit label','LEGACY-PC')",[randomUUID()]);
    store=new BuildingProbeStore(pool,()=>policy);await store.ensure();building=await store.createBuilding('Synthetic Science',42);
    a=await enroll('SYNTHETIC-A');b=await enroll('SYNTHETIC-B');c=await enroll('SYNTHETIC-C');
  });
  afterAll(async()=>{await pool?.end();});
  it('migrates historical labels to immutable catalog IDs without selecting old rows',async()=>{
    const legacy=(await store.list()).find(p=>p.computerName==='LEGACY-PC');
    expect(legacy).toMatchObject({selected:false,assignmentBasis:'historical-assignment'});expect(legacy.buildingId).toMatch(/^[a-f0-9-]{36}$/);
    expect((await store.buildings()).find(item=>item.id===legacy.buildingId)?.label).toBe('Legacy explicit label');
    expect((await pool.query("SELECT indexname FROM pg_indexes WHERE indexname='building_probes_one_building'")).rowCount).toBe(0);
  });
  it('selects at most two PCs atomically; deselection does not revoke or remove the device',async()=>{
    const selected=await Promise.allSettled([store.select(a.id,true),store.select(b.id,true),store.select(c.id,true)]);
    expect(selected.filter(x=>x.status==='fulfilled')).toHaveLength(2);
    const active=(await store.list()).filter(p=>p.buildingId===building.id&&p.selected);
    expect(active).toHaveLength(2);[a,b]=active;c=(await store.list()).find(p=>p.buildingId===building.id&&!p.selected);
    await store.select(b.id,false);expect((await store.authenticate(b.id,identities.get(b.id)!,credentials.get(b.id)!)).enabled).toBe(true);
    expect((await store.list()).find(p=>p.id===b.id)?.selected).toBe(false);await store.select(b.id,true);
  });
  it('keeps both scheduler and target-readiness gates closed independently',async()=>{
    expect((await beat(a)).job).toBeNull();expect((await beat(b)).job).toBeNull();
    policy={...policy,enabled:true,targetReady:false};
    for(const p of [a,b]) {
      const response=await beat(p),baseline=claims(response.job!);expect(baseline.kind).toBe('network');expect(baseline.options).toBeUndefined();
      const time=new Date().toISOString();await beat(p,[{jobId:baseline.id,kind:'network',startedAt:time,completedAt:time,outcome:'completed',details:{}}]);
    }
    expect((await pool.query("SELECT count(*) FROM building_probe_jobs WHERE kind='throughput'")).rows[0].count).toBe('0');
  });
  let quick:any,capacity:any;
  it('leases only one small transfer while admitting capacity in its separate lane',async()=>{
    await pool.query("UPDATE building_probes SET activation_at=now()-interval '5 minutes',reporting_since=now()-interval '6 minutes' WHERE id IN ($1,$2)",[a.id,b.id]);
    policy={...policy,targetReady:true};const first=await beat(a);quick=claims(first.job!);expect(first.leaseExpiresAt).toBeDefined();
    expect(quick.options).toMatchObject({profile:'quick',maxBytes:5242880,timeoutSeconds:10});
    expect((await beat(b)).job).toBeNull();
    await pool.query("UPDATE building_probe_jobs SET status='cancelled' WHERE assignment_id=$1 AND status='pending'",[b.id]);
    const row=(await pool.query('SELECT * FROM building_probes WHERE id=$1',[b.id])).rows[0];
    const now=new Date().toISOString(),slot={key:`synthetic-capacity-${b.id}`,profile:'capacity',slotAt:now,windowEndsAt:new Date(Date.now()+300000).toISOString(),late:false};
    expect(await (store as any).transaction((client:any)=>(store as any).queueSlot(client,row,slot))).toBe(true);
    capacity=claims((await beat(b)).job!);
    expect(capacity.options).toMatchObject({profile:'capacity',maxBytes:10000000000,timeoutSeconds:900});
    expect(capacity.expiresAt-capacity.issuedAt).toBeLessThanOrEqual(900);expect(quick.expiresAt-quick.issuedAt).toBe(180);
    expect((await pool.query('SELECT id FROM building_probe_campus_lease WHERE job_id IS NOT NULL')).rows.map((r:any)=>r.id).sort()).toEqual([1,7]);
  });
  it('keeps original sample timestamps and immutable result identity when a result is retried',async()=>{
    const startedAt=new Date().toISOString(),completedAt=startedAt;
    const result:ProbeResult={jobId:quick.id,kind:'throughput',selectionRevision:quick.selectionRevision,slotAt:quick.slotAt,startedAt,completedAt,outcome:'completed',details:{profile:'quick',targetId:'sccc-external-v1',bytes:5242880,elapsedMs:1000,mbps:41.94304,rangeCount:1,termination:'byte_budget'}};
    expect((await beat(a,[result])).acceptedResults).toContain(quick.id);
    const first=(await store.exportResults('0',100)).results.filter(r=>r.testType==='quick');expect(first).toHaveLength(1);expect(first[0].result.startedAt).toBe(startedAt);expect(new Date(first[0].originalSampleAt).toISOString()).toBe(startedAt);
    await beat(a,[{...result,details:{...result.details,mbps:999}}]);
    const second=(await store.exportResults('0',100)).results.filter(r=>r.testType==='quick');expect(second).toHaveLength(1);expect(second[0].sampleId).toBe(first[0].sampleId);expect(second[0].result.details.mbps).toBe(41.94304);
  });
  it('acknowledges and discards old-generation results after deselection',async()=>{
    await store.select(b.id,false);
    const time=new Date().toISOString(),old:ProbeResult={jobId:capacity.id,kind:'throughput',selectionRevision:capacity.selectionRevision,slotAt:capacity.slotAt,startedAt:time,completedAt:time,outcome:'cancelled',details:{profile:'capacity',targetId:'sccc-external-v1',bytes:0,elapsedMs:1,mbps:null,rangeCount:0,termination:'cancelled',bytesAccounted:true}};
    const response=await beat(b,[old],capacity.id);
    expect(response.acceptedResults).toContain(capacity.id);expect(response.selection.selected).toBe(false);expect(response.job).toBeNull();
    expect((await store.exportResults('0',100)).results.filter(r=>r.testType==='capacity')).toHaveLength(0);
    expect((await store.authenticate(b.id,identities.get(b.id)!,credentials.get(b.id)!)).enabled).toBe(true);
  });
  it('fails over a capacity window once, retaining its original slot and never retrying the second failure',async()=>{
    const response=await beat(a),fallback=claims(response.job!);expect(fallback.kind).toBe('throughput');expect(fallback.options.profile).toBe('capacity');expect(fallback.slotAt).toBe(capacity.slotAt);
    const time=new Date().toISOString();await beat(a,[{jobId:fallback.id,kind:'throughput',selectionRevision:fallback.selectionRevision,slotAt:fallback.slotAt,startedAt:time,completedAt:time,outcome:'unavailable',details:{profile:'capacity',targetId:'sccc-external-v1',bytes:0,elapsedMs:1,mbps:null,rangeCount:0,termination:'target_not_ready',bytesAccounted:true}}]);
    const rows=(await pool.query('SELECT * FROM building_probe_slots WHERE key=$1',[`synthetic-capacity-${b.id}`])).rows;expect(rows[0]).toMatchObject({attempt:1,state:'failed'});
    expect((await pool.query("SELECT count(*) FROM building_probe_jobs WHERE slot_key=$1",[`synthetic-capacity-${b.id}`])).rows[0].count).toBe('2');
  });
  it('accepts a same-generation durable sample completed before expiry even on its first late upload',async()=>{
    const queued=await store.enqueue(a.id,'network',42),signed=claims((await beat(a)).job!);expect(signed.id).toBe(queued.id);
    await pool.query("UPDATE building_probe_jobs SET dispatched_at=now()-interval '60 seconds',expires_at=now()-interval '1 second',status='expired' WHERE id=$1",[queued.id]);
    const startedAt=new Date(Date.now()-30000).toISOString(),completedAt=new Date(Date.now()-20000).toISOString();
    await beat(a,[{jobId:queued.id,kind:'network',startedAt,completedAt,outcome:'completed',details:{}}]);
    const sample=(await store.exportResults('0',100)).results.find(r=>r.jobId===queued.id);expect(sample?.originalSampleAt).toBe(startedAt);expect(sample?.result.completedAt).toBe(completedAt);
  });
  it('does not treat a version label as throughput capability or catch up missed quick slots',async()=>{
    await store.select(b.id,true);const oldClient=await beat(b,[],undefined,false);expect(claims(oldClient.job!).kind).toBe('network');
    await pool.query("UPDATE building_probes SET activation_at=now()-interval '13 minutes',last_seen=now()-interval '1 hour' WHERE id=$1",[a.id]);
    expect((await beat(a)).job).toBeNull();
    const row=(await store.list()).find(p=>p.id===a.id);expect(row.missedSlot).not.toBeNull();
    const pending=(await pool.query("SELECT * FROM building_probe_jobs WHERE assignment_id=$1 AND status='pending'",[a.id])).rows;expect(pending).toHaveLength(0);
  });
  it('cancels a running transfer when its absolute lease can no longer be renewed',async()=>{
    const queued=await store.enqueue(a.id,'throughput',42),response=await beat(a);expect(claims(response.job!).id).toBe(queued.id);expect(response.leaseExpiresAt).toBeDefined();
    await pool.query("UPDATE building_probe_campus_lease SET lease_until=now()-interval '1 second' WHERE job_id=$1",[queued.id]);
    await pool.query("UPDATE building_probe_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[queued.id]);
    const expired=await beat(a,[],queued.id);expect(expired.cancelRunningJobId).toBe(queued.id);expect(expired.leaseExpiresAt).toBeUndefined();expect(expired.job).toBeNull();
    expect((await pool.query('SELECT status FROM building_probe_jobs WHERE id=$1',[queued.id])).rows[0].status).toBe('expired');
  });
  it('retains the original time of a throughput sample first uploaded after its valid execution lease ended',async()=>{
    const queued=await store.enqueue(a.id,'throughput',42),signed=claims((await beat(a)).job!);
    await pool.query("UPDATE building_probe_jobs SET dispatched_at=now()-interval '25 seconds',lease_expires_at=now()-interval '5 seconds',expires_at=now()-interval '1 second',status='expired' WHERE id=$1",[queued.id]);
    const startedAt=new Date(Date.now()-11000).toISOString(),completedAt=new Date(Date.now()-10000).toISOString();
    await beat(a,[{jobId:queued.id,kind:'throughput',selectionRevision:signed.selectionRevision,slotAt:signed.slotAt,startedAt,completedAt,outcome:'completed',details:{profile:'quick',targetId:'sccc-external-v1',bytes:5242880,elapsedMs:1000,mbps:41.94304,rangeCount:1,termination:'byte_budget'}}]);
    const result=(await store.exportResults('0',100)).results.find(row=>row.jobId===queued.id);expect(result?.testType).toBe('quick');expect(result?.originalSampleAt).toBe(startedAt);expect(result?.result.completedAt).toBe(completedAt);
  });
  it('clamps capacity signature expiry to the absolute hard end even with control delivery delay',async()=>{
    const row=(await pool.query('SELECT * FROM building_probes WHERE id=$1',[a.id])).rows[0],windowEnd=new Date(Date.now()+5000).toISOString();
    const slot={key:`hard-end-${a.id}`,profile:'capacity',slotAt:new Date().toISOString(),windowEndsAt:windowEnd,late:false};
    expect(await (store as any).transaction((client:any)=>(store as any).queueSlot(client,row,slot))).toBe(true);
    const response=await beat(a),job=claims(response.job!);expect(job.options.profile).toBe('capacity');expect(job.expiresAt).toBeLessThanOrEqual(Math.floor(Date.parse(windowEnd)/1000)+900);expect(job.expiresAt-job.issuedAt).toBeLessThan(930);expect(response.leaseExpiresAt).toBeDefined();
    const time=new Date().toISOString();await beat(a,[{jobId:job.id,kind:'throughput',selectionRevision:job.selectionRevision,slotAt:job.slotAt,startedAt:time,completedAt:time,outcome:'unavailable',details:{profile:'capacity',targetId:'sccc-external-v1',bytes:0,elapsedMs:1,mbps:null,rangeCount:0,termination:'target_not_ready'}}]);
  });
  it('exports current health separately from revoked assignment history',async()=>{
    await store.revoke(c.id);expect((await store.list()).some(p=>p.id===c.id)).toBe(false);expect((await store.list(true)).some(p=>p.id===c.id)).toBe(true);
    const exported=await store.exportResults('0',100);expect(exported.health.some(p=>p.assignmentId===c.id)).toBe(false);expect(exported.health.find(p=>p.assignmentId===b.id)).toMatchObject({selected:true,capable:false,eligible:false});
  });
  it('returns the newest bounded batch to a stateless poller after more than 1000 samples',async()=>{
    const original=(await store.exportResults('0',100)).results.find(row=>row.testType==='quick')!;
    await pool.query("INSERT INTO building_probe_result_exports(job_id,device_id,test_type,original_sample_at,assignment_id,building_id,result) SELECT gen_random_uuid(),$1,'throughput',$2::timestamptz+n*interval '1 millisecond',$3,$4,$5::jsonb FROM generate_series(1,1005) AS n",[original.deviceId,original.originalSampleAt,original.assignmentId,original.buildingId,JSON.stringify(original.result)]);
    const recent=await store.exportResults('0',1000,true),newest=(await pool.query('SELECT max(id)::text AS id FROM building_probe_result_exports')).rows[0].id;
    expect(recent.results).toHaveLength(1000);expect(recent.results.at(-1)?.cursor).toBe(newest);expect(recent.nextCursor).toBe(newest);
    expect(recent.results.every((row,index)=>index===0||BigInt(row.cursor)>BigInt(recent.results[index-1].cursor))).toBe(true);
    const repeated=(await store.exportResults('0',100)).results.find(row=>row.sampleId===original.sampleId)!;expect(repeated.originalSampleAt).toBe(original.originalSampleAt);expect(repeated.sampleId).toBe(original.sampleId);
    expect(recent.metrics).toHaveLength(1000);expect(recent.metrics.at(-1)?.originalSampleAt).toBe(recent.results.at(-1)?.originalSampleAt);
  });
});
