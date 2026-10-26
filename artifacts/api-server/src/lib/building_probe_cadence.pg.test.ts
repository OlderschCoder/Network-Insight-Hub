import {createRequire} from 'node:module';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {BuildingProbeStore} from './building_probe_store';
import {JobSigner,token,PROBE_SCHEMA,type ProbeSnapshot,type ProbeResult} from './building_probe_protocol';
import {deviceSlot} from './building_probe_scheduler';
const url=process.env.BUILDING_PROBE_TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.pathname!=='/buildingprobetest')throw new Error('Cadence SQL tests require localhost database buildingprobetest.');}
describe.skipIf(!url)('installation cadence persistence in PostgreSQL',()=>{
  let pool:any,store:BuildingProbeStore,building:any,probe:any,deviceId:string,credential:string,index=0;
  const signer=new JobSigner(generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey);
  const policy=()=>({enabled:true,targetReady:true,quickConcurrency:4,hourlyConcurrency:1,capacityConcurrency:1});
  const snapshot=(installedAt?:string):ProbeSnapshot=>({schema:PROBE_SCHEMA,computerName:probe.computerName,agentVersion:'0.1.4',capturedAt:new Date().toISOString(),uptimeSeconds:100,diagnosticsMode:'on-demand',capabilities:['throughput-v1'],...(installedAt?{installedAt}:{}),adapters:[],keyAlert:{installed:false,serviceState:'unavailable',uiProcessCount:0}});
  const beat=(installedAt?:string,results:ProbeResult[]=[],running?:string)=>store.heartbeat(probe.id,deviceId,credential,snapshot(installedAt),results,signer,running);
  const claims=(jwt:string)=>JSON.parse(Buffer.from(jwt.split('.')[1]!,'base64url').toString('utf8'));
  const row=async()=>(await pool.query('SELECT * FROM building_probes WHERE id=$1',[probe.id])).rows[0];
  const completeBaseline=async(response:any,installedAt?:string)=>{const job=claims(response.job);expect(job.kind).toBe('network');expect(job.options).toBeUndefined();const time=new Date().toISOString();await beat(installedAt,[{jobId:job.id,kind:'network',startedAt:time,completedAt:time,outcome:'completed',details:{}}]);return job;};
  beforeAll(async()=>{
    const pg=createRequire(import.meta.url)('pg');pool=new pg.Pool({connectionString:url,max:4});
    await pool.query('DROP TABLE IF EXISTS building_probe_result_exports,building_probe_campus_lease,building_probe_slots,building_probe_jobs,building_probes,building_probe_buildings CASCADE');
    store=new BuildingProbeStore(pool,policy);await store.ensure();building=await store.createBuilding('Synthetic cadence building',42);
  });
  beforeEach(async()=>{
    for(const previous of await store.list())await store.revoke(previous.id);
    await pool.query('UPDATE building_probe_campus_lease SET job_id=NULL,building_id=NULL,lease_until=NULL');
    const bootstrap=token();probe=await store.assign({buildingId:building.id,computerName:`CADENCE-${++index}`},bootstrap,42);deviceId=randomUUID();credential=token();
    await store.enroll({assignmentId:probe.id,deviceId,computerName:probe.computerName,proposedToken:credential},bootstrap);
  });
  afterAll(async()=>{await pool?.end();});
  it('uses historic installedAt for cadence but runs the lightweight selection baseline immediately',async()=>{
    const installed=new Date(Date.now()-2*3600000-8*60000).toISOString();await beat(installed);const selected=await store.select(probe.id,true);
    expect(selected.cadenceAnchorAt).toBe(installed);expect(selected.cadenceAnchorSource).toBe('installed-at');
    const first=await beat(installed);await completeBaseline(first,installed);
    expect((await beat(installed)).job).toBeNull();expect((await pool.query("SELECT count(*) FROM building_probe_jobs WHERE assignment_id=$1 AND kind='throughput'",[probe.id])).rows[0].count).toBe('0');
    // Continuous monitoring began before the current aligned slot: use the installation phase,
    // which differs from the monitoring-activation phase by a minute in this fixture.
    await pool.query("UPDATE building_probes SET selected_at=now()-interval '4 minutes',activation_at=now()-interval '4 minutes',cadence_anchor_resolved_at=now()-interval '4 minutes',reporting_since=now()-interval '4 minutes' WHERE id=$1",[probe.id]);
    const expected=deviceSlot(probe.id,Number((await row()).selection_revision),installed,Date.now())!;
    const current=claims((await beat(installed)).job!);expect(current.kind).toBe('throughput');expect(current.options.profile).toBe('quick');expect(current.slotAt).toBe(expected.slotAt);
    expect((await row()).cadence_anchor_at.toISOString()).toBe(installed);
  });
  it('retains an explicit fallback through store restart and reselection without calling it installation time',async()=>{
    await beat();const selected=await store.select(probe.id,true),fallback=selected.cadenceAnchorAt;
    expect(selected.cadenceAnchorSource).toBe('selection-time-fallback');expect(fallback).toBeDefined();await completeBaseline(await beat());
    store=new BuildingProbeStore(pool,policy);await store.select(probe.id,false);const reselected=await store.select(probe.id,true);expect(reselected.cadenceAnchorAt).toBe(fallback);expect(reselected.cadenceAnchorSource).toBe('selection-time-fallback');
    const response=await beat();expect(response.selection.cadenceAnchorAt).toBe(fallback);expect((await store.list()).find(p=>p.id===probe.id)?.installedAt).toBeNull();await completeBaseline(response);
  });
  it('resolves fallback evidence once, cancels/fences the running old phase and preserves install phase on reselection',async()=>{
    await beat();await store.select(probe.id,true);await completeBaseline(await beat());
    const oldAnchor=new Date(Date.now()-300000).toISOString();
    await pool.query("UPDATE building_probes SET cadence_anchor_at=$2,first_selected_at=$2,selected_at=now()-interval '6 minutes',activation_at=now()-interval '5 minutes',cadence_anchor_resolved_at=now()-interval '6 minutes',reporting_since=now()-interval '6 minutes' WHERE id=$1",[probe.id,oldAnchor]);
    const old=claims((await beat()).job!);expect(old.options.profile).toBe('quick');
    const installed=new Date(Date.now()-7*3600000-8*60000).toISOString(),time=new Date().toISOString();
    const result:ProbeResult={jobId:old.id,kind:'throughput',selectionRevision:old.selectionRevision,slotAt:old.slotAt,startedAt:time,completedAt:time,outcome:'completed',details:{profile:'quick',targetId:'sccc-external-v1',bytes:5242880,elapsedMs:1000,mbps:41.94304,rangeCount:1,termination:'byte_budget'}};
    const resolved=await beat(installed,[result],old.id);expect(resolved.selection.revision).toBe(old.selectionRevision+1);expect(resolved.selection.cadenceAnchorAt).toBe(installed);expect(resolved.selection.cadenceAnchorSource).toBe('installed-at');expect(resolved.acceptedResults).toContain(old.id);expect(resolved.cancelRunningJobId).toBe(old.id);expect(claims(resolved.job!).kind).toBe('network');
    expect((await pool.query('SELECT count(*) FROM building_probe_result_exports WHERE job_id=$1',[old.id])).rows[0].count).toBe('0');expect((await pool.query('SELECT status FROM building_probe_jobs WHERE id=$1',[old.id])).rows[0].status).toBe('cancelled');
    await completeBaseline(resolved,installed);const pinned=(await row()).cadence_anchor_resolved_at.toISOString();await store.select(probe.id,false);const again=await store.select(probe.id,true);expect(again.cadenceAnchorAt).toBe(installed);expect(again.cadenceAnchorResolvedAt).toBe(pinned);expect((await beat(installed)).selection.cadenceAnchorAt).toBe(installed);
  });
  it('rejects invalid or changed installation timestamps and never shifts the pinned anchor',async()=>{
    const installed=new Date(Date.now()-3600000).toISOString();await beat(installed);await store.select(probe.id,true);const before=await row();
    await expect(beat('1999-01-01T00:00:00Z')).rejects.toMatchObject({status:400});await expect(beat(new Date(Date.now()+60000).toISOString())).rejects.toMatchObject({status:400});await expect(beat(new Date(Date.parse(installed)+1000).toISOString())).rejects.toMatchObject({status:409});
    const after=await row();expect(after.cadence_anchor_at.toISOString()).toBe(before.cadence_anchor_at.toISOString());expect(after.selection_revision).toBe(before.selection_revision);expect((await beat()).selection.cadenceAnchorAt).toBe(installed);
  });
  it('lazily migrates a staged selected legacy phase without preserving its queued old-cadence job',async()=>{
    const installed=new Date(Date.now()-2*3600000).toISOString();await beat(installed);await store.select(probe.id,true);await completeBaseline(await beat(installed),installed);
    await pool.query("UPDATE building_probes SET first_selected_at=NULL,selected_at=NULL,cadence_anchor_at=NULL,cadence_anchor_source=NULL,cadence_anchor_resolved_at=NULL,installed_at=NULL,activation_at=now()-interval '4 minutes' WHERE id=$1",[probe.id]);
    const old=await store.enqueue(probe.id,'throughput',42),revision=Number((await row()).selection_revision);
    const migrated=await beat(installed);expect(migrated.selection.revision).toBe(revision+1);expect(migrated.selection.cadenceAnchorAt).toBe(installed);expect(migrated.selection.cadenceAnchorSource).toBe('installed-at');expect(claims(migrated.job!).kind).toBe('network');expect((await pool.query('SELECT status FROM building_probe_jobs WHERE id=$1',[old.id])).rows[0].status).toBe('cancelled');
  });
});
