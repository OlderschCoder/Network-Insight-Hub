import { randomUUID } from "node:crypto";
import { digest, matches, computerName, buildingKey, ProbeError, type JobSigner, type ProbeSnapshot, type ProbeResult, type ProbeJob } from "./building_probe_protocol";
import { capable, reporting, deviceSlot, capacitySlots, selectCapacityProbe, throughputOptions,chooseTransferLane,PENDING_POLL_SECONDS, type ScheduleSlot } from "./building_probe_scheduler";
import { projectProbeMetrics } from "./building_probe_metrics";

interface QueryResult { rows: any[]; rowCount: number | null; }
interface PoolClient { query(sql: string, values?: unknown[]): Promise<QueryResult>; release(): void; }
interface Pool { query(sql: string, values?: unknown[]): Promise<QueryResult>; connect(): Promise<PoolClient>; }
export interface ProbeSchedulePolicy { enabled: boolean; targetReady: boolean; quickConcurrency?: number; hourlyConcurrency?: number; capacityConcurrency?: number; }
export const BUILDING_PROBE_DDL = `
CREATE TABLE IF NOT EXISTS building_probe_buildings(id uuid PRIMARY KEY,normalized_key varchar(160) NOT NULL UNIQUE,label varchar(160) NOT NULL,created_by integer,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS building_probes (
 id uuid PRIMARY KEY,building_key varchar(160) NOT NULL,building varchar(160) NOT NULL,
 computer_name varchar(15) NOT NULL,enabled boolean NOT NULL DEFAULT true,
 adapter_id varchar(100),expected_voice_subnet varchar(64),device_id uuid,
 bootstrap_hash char(64),bootstrap_expires_at timestamptz,credential_hash char(64),
 created_by integer,created_at timestamptz NOT NULL DEFAULT now(),last_seen timestamptz,
 snapshot jsonb,CONSTRAINT building_probe_name_upper CHECK(computer_name=upper(computer_name))
);
ALTER TABLE building_probes ADD COLUMN IF NOT EXISTS building_id uuid REFERENCES building_probe_buildings(id);
ALTER TABLE building_probes ADD COLUMN IF NOT EXISTS assignment_basis text NOT NULL DEFAULT 'historical-assignment';
ALTER TABLE building_probes ADD COLUMN IF NOT EXISTS selected boolean NOT NULL DEFAULT false;
ALTER TABLE building_probes ADD COLUMN IF NOT EXISTS selection_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE building_probes ADD COLUMN IF NOT EXISTS activation_at timestamptz;
ALTER TABLE building_probes ADD COLUMN IF NOT EXISTS missed_slot timestamptz;
ALTER TABLE building_probes ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;
ALTER TABLE building_probes ADD COLUMN IF NOT EXISTS reporting_since timestamptz;
INSERT INTO building_probe_buildings(id,normalized_key,label) SELECT gen_random_uuid(),building_key,min(building) FROM building_probes WHERE building_id IS NULL GROUP BY building_key ON CONFLICT(normalized_key) DO NOTHING;
UPDATE building_probes p SET building_id=b.id FROM building_probe_buildings b WHERE p.building_id IS NULL AND p.building_key=b.normalized_key;
ALTER TABLE building_probes ALTER COLUMN building_id SET NOT NULL;
DROP INDEX IF EXISTS building_probes_one_building;
CREATE UNIQUE INDEX IF NOT EXISTS building_probes_one_computer ON building_probes(computer_name) WHERE enabled;
CREATE UNIQUE INDEX IF NOT EXISTS building_probes_one_device ON building_probes(device_id) WHERE enabled;
CREATE TABLE IF NOT EXISTS building_probe_jobs (
 id uuid PRIMARY KEY,assignment_id uuid NOT NULL REFERENCES building_probes(id),device_id uuid NOT NULL,kind varchar(20) NOT NULL,
 status varchar(20) NOT NULL CHECK(status IN ('pending','dispatched','completed','expired','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 signed_job text,result jsonb,created_by integer,completed_at timestamptz
);
ALTER TABLE building_probe_jobs DROP CONSTRAINT IF EXISTS building_probe_jobs_kind_check;
ALTER TABLE building_probe_jobs ADD CONSTRAINT building_probe_jobs_kind_check CHECK(kind IN ('network','multicast','throughput'));
ALTER TABLE building_probe_jobs ADD COLUMN IF NOT EXISTS selection_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE building_probe_jobs ADD COLUMN IF NOT EXISTS slot_at timestamptz;
ALTER TABLE building_probe_jobs ADD COLUMN IF NOT EXISTS options jsonb;
ALTER TABLE building_probe_jobs ADD COLUMN IF NOT EXISTS slot_key text;
ALTER TABLE building_probe_jobs ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE building_probe_jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS building_probe_one_active_job ON building_probe_jobs(assignment_id) WHERE status IN ('pending','dispatched');
CREATE INDEX IF NOT EXISTS building_probe_jobs_history ON building_probe_jobs(assignment_id,created_at DESC);
CREATE TABLE IF NOT EXISTS building_probe_slots (
 key text PRIMARY KEY,building_id uuid NOT NULL REFERENCES building_probe_buildings(id),assignment_id uuid,
 profile varchar(20) NOT NULL,slot_at timestamptz NOT NULL,window_ends_at timestamptz NOT NULL,
 state varchar(20) NOT NULL,reason varchar(160),attempt integer NOT NULL DEFAULT 0,first_assignment_id uuid,
 job_id uuid,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS building_probe_campus_lease(id integer PRIMARY KEY,job_id uuid,building_id uuid,lease_until timestamptz);
ALTER TABLE building_probe_campus_lease DROP CONSTRAINT IF EXISTS building_probe_campus_lease_id_check;
ALTER TABLE building_probe_campus_lease ADD CONSTRAINT building_probe_campus_lease_id_check CHECK(id BETWEEN 1 AND 8);
INSERT INTO building_probe_campus_lease(id) VALUES(1),(2),(3),(4),(5),(6),(7),(8) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS building_probe_result_exports (
 id bigserial PRIMARY KEY,job_id uuid NOT NULL,device_id uuid NOT NULL,test_type varchar(20) NOT NULL,
 original_sample_at timestamptz NOT NULL,assignment_id uuid NOT NULL,building_id uuid NOT NULL,
 result jsonb NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,device_id,test_type,original_sample_at)
);
`;
const viewColumns = `id,building,building_id AS "buildingId",assignment_basis AS "assignmentBasis",building_key AS "buildingKey",computer_name AS "computerName",enabled,selected,
 selection_revision AS "selectionRevision",activation_at AS "activationAt",missed_slot AS "missedSlot",consecutive_failures AS "consecutiveFailures",
 adapter_id AS "adapterId",expected_voice_subnet AS "expectedVoiceSubnet",device_id AS "deviceId",created_at AS "createdAt",last_seen AS "lastSeen",snapshot`;
const asIso = (value: any) => value ? new Date(value).toISOString() : undefined;
const generation = (row: any) => Number(row.selection_revision ?? 0);

export class BuildingProbeStore {
  private ready?: Promise<void>;
  constructor(private readonly pool: Pool, private readonly policy: () => ProbeSchedulePolicy = () => ({ enabled: false, targetReady: false })) { }
  async ensure() {
    this.ready ??= this.pool.query(BUILDING_PROBE_DDL).then(() => undefined).catch(error => { this.ready = undefined; throw error; });
    return this.ready;
  }
  async buildings() {
    await this.ensure(); return (await this.pool.query('SELECT id,label,normalized_key AS "normalizedKey" FROM building_probe_buildings ORDER BY label')).rows;
  }
  async createBuilding(label: string, userId: number) {
    await this.ensure();
    let key:string;try{key=buildingKey(label);}catch{throw new ProbeError(400,"A normalized canonical building label is required.");}
    try { return (await this.pool.query('INSERT INTO building_probe_buildings(id,normalized_key,label,created_by) VALUES($1,$2,$3,$4) RETURNING id,label,normalized_key AS "normalizedKey"', [randomUUID(), key, label.trim(), userId])).rows[0]; }
    catch (error: any) { if (error.code === "23505") throw new ProbeError(409, "That canonical building already exists."); throw error; }
  }
  async list(history = false) {
    await this.ensure();
    const rows = (await this.pool.query(`SELECT ${viewColumns},
      (SELECT jsonb_agg(j) FROM (SELECT id,kind,options,selection_revision AS "selectionRevision",slot_at AS "slotAt",
       CASE WHEN status IN ('pending','dispatched') AND expires_at<now() THEN 'expired' ELSE status END AS status,
       result,created_at AS "createdAt",expires_at AS "expiresAt" FROM building_probe_jobs WHERE assignment_id=building_probes.id AND device_id=building_probes.device_id ORDER BY created_at DESC LIMIT 5) j) AS jobs,
      (SELECT result->>'completedAt' FROM building_probe_jobs WHERE assignment_id=building_probes.id AND kind='throughput' AND status='completed' AND result->>'outcome'='completed' ORDER BY completed_at DESC LIMIT 1) AS "lastThroughputAt",
      (SELECT reason FROM building_probe_slots WHERE assignment_id=building_probes.id AND state='skipped' ORDER BY slot_at DESC LIMIT 1) AS "missedSlotReason"
      FROM building_probes WHERE enabled=$1 ORDER BY building,computer_name`, [!history])).rows;
    return rows.map(row => ({ ...row, selectionRevision: Number(row.selectionRevision), capabilities: row.snapshot?.capabilities ?? [], installedAt: row.snapshot?.installedAt ?? null,
      capable: capable(row.snapshot), eligible: row.enabled && row.selected && capable(row.snapshot) && reporting(row.lastSeen) }));
  }
  async assign(input: { buildingId: string; computerName: string; adapterId?: string | null; expectedVoiceSubnet?: string | null }, bootstrap: string, userId: number) {
    return this.transaction(async c => {
      const building = (await c.query("SELECT * FROM building_probe_buildings WHERE id=$1", [input.buildingId])).rows[0];
      if (!building) throw new ProbeError(400, "Select a canonical building from the catalog.");
      try { return (await c.query(`INSERT INTO building_probes(id,building_id,building_key,building,assignment_basis,computer_name,adapter_id,expected_voice_subnet,bootstrap_hash,bootstrap_expires_at,created_by)
        VALUES($1,$2,$3,$4,'catalog-assignment',$5,$6,$7,$8,now()+interval '20 minutes',$9) RETURNING ${viewColumns}`,
      [randomUUID(), building.id, building.normalized_key, building.label, computerName(input.computerName), input.adapterId || null, input.expectedVoiceSubnet || null, digest(bootstrap), userId])).rows[0]; }
      catch (error: any) { if (error.code === "23505") throw new ProbeError(409, "This computer already has an active assignment."); throw error; }
    });
  }
  async select(id: string, selected: boolean) {
    return this.transaction(async c => {
      const row = (await c.query("SELECT * FROM building_probes WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!row?.enabled) throw new ProbeError(404, "Unknown active assignment.");
      if (row.selected === selected) return this.selection(row);
      if (selected && (await c.query("SELECT id FROM building_probes WHERE enabled AND selected AND building_id=$1 AND id<>$2", [row.building_id, id])).rowCount! >= 2) throw new ProbeError(409, "Only two computers may be selected per canonical building.");
      const activation = selected && this.policy().enabled && reporting(row.last_seen) ? new Date() : null;
      const updated = (await c.query("UPDATE building_probes SET selected=$2,selection_revision=selection_revision+1,activation_at=$3 WHERE id=$1 RETURNING *", [id, selected, activation])).rows[0];
      await this.cancel(c, id); return this.selection(updated);
    });
  }
  private selection(row: any) { return { selected: !!row.selected, revision: generation(row), ...(row.activation_at ? { activationAt: asIso(row.activation_at) } : {}) }; }
  private async cancel(c: PoolClient, id: string) {
    await c.query("UPDATE building_probe_slots SET state='failed',reason='selection changed' WHERE job_id IN (SELECT id FROM building_probe_jobs WHERE assignment_id=$1 AND status IN ('pending','dispatched'))",[id]);
    await c.query("UPDATE building_probe_jobs SET status='cancelled' WHERE assignment_id=$1 AND status IN ('pending','dispatched')",[id]);
  }
  async revoke(id: string) {
    await this.transaction(async c => { await c.query("UPDATE building_probes SET enabled=false,selected=false,selection_revision=selection_revision+1,credential_hash=NULL,bootstrap_hash=NULL WHERE id=$1", [id]); await this.cancel(c, id); });
  }
  async enroll(input: { assignmentId: string; deviceId: string; computerName: string; proposedToken: string }, bootstrap: string) {
    return this.transaction(async c => {
      const row = (await c.query("SELECT * FROM building_probes WHERE id=$1 FOR UPDATE", [input.assignmentId])).rows[0];
      if (!row?.enabled || row.computer_name !== computerName(input.computerName)) throw new ProbeError(403, "Probe enrollment rejected.");
      if (row.device_id === input.deviceId && matches(input.proposedToken, row.credential_hash)) return;
      if (row.device_id || !matches(bootstrap, row.bootstrap_hash) || new Date(row.bootstrap_expires_at).getTime() <= Date.now()) throw new ProbeError(403, "Probe enrollment rejected.");
      await c.query("UPDATE building_probes SET device_id=$2,credential_hash=$3,bootstrap_hash=NULL WHERE id=$1", [input.assignmentId, input.deviceId, digest(input.proposedToken)]);
    });
  }
  async authenticate(assignmentId: string, deviceId: string, credential: string) {
    await this.ensure(); const row = (await this.pool.query("SELECT * FROM building_probes WHERE id=$1", [assignmentId])).rows[0];
    if (!row?.enabled || row.device_id !== deviceId || !matches(credential, row.credential_hash)) throw new ProbeError(401, "Probe credential rejected."); return row;
  }
  async heartbeat(assignmentId: string, deviceId: string, credential: string, snapshot: ProbeSnapshot, results: ProbeResult[], signer: JobSigner, runningJobId?: string) {
    return this.transaction(async c => {
      const row = (await c.query("SELECT * FROM building_probes WHERE id=$1 FOR UPDATE", [assignmentId])).rows[0];
      if (!row?.enabled || row.device_id !== deviceId || !matches(credential, row.credential_hash)) throw new ProbeError(401, "Probe credential rejected.");
      if (computerName(snapshot.computerName) !== row.computer_name) throw new ProbeError(403, "Probe computer identity mismatch.");
      const policy=this.policy();
      const accepted: string[] = [];
      for (const result of results) {
        const job = (await c.query("SELECT * FROM building_probe_jobs WHERE id=$1 AND assignment_id=$2 AND device_id=$3 FOR UPDATE", [result.jobId, assignmentId, deviceId])).rows[0];
        if (!job || job.kind !== result.kind) throw new ProbeError(403, "Result is outside this probe assignment.");
        accepted.push(result.jobId);
        const fenced = !row.selected || generation(row) !== Number(job.selection_revision) || (result.kind === "throughput" && (result.selectionRevision !== generation(row) || Date.parse(result.slotAt!) !== new Date(job.slot_at).getTime()));
        if (fenced || job.status === "completed" || !job.signed_job || job.status === "pending") {
          if (fenced) await c.query("UPDATE building_probe_campus_lease SET job_id=NULL,building_id=NULL,lease_until=NULL WHERE job_id=$1", [job.id]);
          continue;
        }
        const originalCompleted=Date.parse(result.completedAt), executionEnd=Math.min(new Date(job.expires_at).getTime(),job.kind==='throughput'?new Date(job.lease_expires_at??job.expires_at).getTime():Infinity);
        // Durable retry may arrive after expiry, but cannot claim work after its issued lease.
        if(originalCompleted>executionEnd)continue;
        if(Date.parse(result.startedAt)<new Date(job.dispatched_at??job.created_at).getTime()-5000 || originalCompleted>Date.now()+30000 || originalCompleted<Date.parse(result.startedAt))throw new ProbeError(400,"Result sample timestamps do not match its dispatched job.");
        if (result.kind === "throughput") this.validateThroughput(result, job);
        await c.query("UPDATE building_probe_jobs SET status='completed',result=$2::jsonb,completed_at=now() WHERE id=$1", [result.jobId, JSON.stringify(result)]);
        await c.query("INSERT INTO building_probe_result_exports(job_id,device_id,test_type,original_sample_at,assignment_id,building_id,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING", [job.id, deviceId, result.kind==='throughput'?job.options.profile:result.kind, result.startedAt, assignmentId, row.building_id, JSON.stringify(result)]);
        await c.query("UPDATE building_probes SET consecutive_failures=CASE WHEN $2 THEN 0 ELSE consecutive_failures+1 END WHERE id=$1", [assignmentId, ["completed", "received"].includes(result.outcome)]);
        await c.query("UPDATE building_probe_campus_lease SET job_id=NULL,building_id=NULL,lease_until=NULL WHERE job_id=$1", [job.id]);
        if (job.slot_key) await c.query("UPDATE building_probe_slots SET state=$2,reason=$3 WHERE key=$1 AND job_id=$4", [job.slot_key, result.outcome === "completed" ? "completed" : "failed", result.details.termination ?? result.outcome,job.id]);
      }
      const update=await c.query("UPDATE building_probes SET reporting_since=CASE WHEN last_seen IS NULL OR last_seen<now()-interval '90 seconds' THEN now() ELSE coalesce(reporting_since,now()) END,last_seen=now(),snapshot=$2::jsonb,activation_at=CASE WHEN selected AND activation_at IS NULL AND $3 THEN now() ELSE activation_at END WHERE id=$1 RETURNING activation_at", [assignmentId, JSON.stringify(snapshot),policy.enabled]);
      row.snapshot = snapshot; row.last_seen = new Date();
      row.activation_at=update.rows[0]?.activation_at??row.activation_at;
      const allowed = policy.enabled && policy.targetReady && row.selected && capable(snapshot);
      let cancelRunningJobId: string | undefined;
      if (runningJobId) {
        const job = (await c.query("SELECT * FROM building_probe_jobs WHERE id=$1 AND assignment_id=$2 AND device_id=$3", [runningJobId, assignmentId, deviceId])).rows[0];
        if (!job || !row.selected || (job.kind==='throughput' && !allowed) || job.status !== "dispatched" || generation(row) !== Number(job.selection_revision) || new Date(job.expires_at).getTime() <= Date.now()) cancelRunningJobId = runningJobId;
        else if(job.kind==='throughput') {
          const renewed=await c.query("UPDATE building_probe_campus_lease SET lease_until=least($2::timestamptz,now()+interval '30 seconds') WHERE job_id=$1 AND lease_until>now() RETURNING lease_until",[job.id,job.expires_at]);
          if(!renewed.rowCount)cancelRunningJobId=runningJobId;
          else await c.query("UPDATE building_probe_jobs SET lease_expires_at=$2 WHERE id=$1",[job.id,renewed.rows[0].lease_until]);
        }
      }
      await this.tick(c, policy);
      const pending = (await c.query("SELECT * FROM building_probe_jobs WHERE assignment_id=$1 AND device_id=$2 AND status IN ('pending','dispatched') ORDER BY created_at LIMIT 1 FOR UPDATE", [assignmentId, deviceId])).rows[0];
      let signed: string | null = null;
      if(pending&&new Date(pending.expires_at).getTime()<=Date.now()) {
        await c.query("UPDATE building_probe_jobs SET status='expired' WHERE id=$1",[pending.id]);
        if(pending.slot_key)await c.query("UPDATE building_probe_slots SET state='skipped',reason='scheduled window expired' WHERE key=$1 AND state='queued'",[pending.slot_key]);
      }
      if (pending && new Date(pending.expires_at).getTime()>Date.now() && row.selected && Number(pending.selection_revision) === generation(row) && (pending.kind !== "throughput" || allowed)) {
        signed = pending.signed_job ?? null;
        if (pending.status === "pending") {
          let lease = true;
          if (pending.kind === "throughput") {
            if (pending.options?.profile==='capacity') lease=!!(await c.query("UPDATE building_probe_campus_lease SET lease_until=now()+interval '30 seconds' WHERE id IN (7,8) AND job_id=$1 AND lease_until>now() RETURNING id",[pending.id])).rowCount;
            else {
              const lanes=(await c.query('SELECT * FROM building_probe_campus_lease ORDER BY id')).rows;
              const lane=chooseTransferLane(pending.options.profile,lanes,row.building_id,policy);
              lease=lane!==null&&!!(await c.query("UPDATE building_probe_campus_lease SET job_id=$1,building_id=$2,lease_until=now()+interval '30 seconds' WHERE id=$3 AND (job_id IS NULL OR lease_until<=now()) RETURNING id",[pending.id,row.building_id,lane])).rowCount;
            }
          }
          if (lease) {
            const issuedAt = Math.floor(Date.now() / 1000), lifetime = pending.options?.profile === "capacity" ? 930 : 180;
            let expiresAt=issuedAt+lifetime;
            if(pending.options?.profile==='capacity') {
              const window=(await c.query("SELECT window_ends_at FROM building_probe_slots WHERE key=$1",[pending.slot_key])).rows[0];
              if(!window)throw new ProbeError(409,'Capacity window is unavailable.');
              expiresAt=Math.min(expiresAt,Math.floor(new Date(window.window_ends_at).getTime()/1000)+900);
            }
            signed = signer.sign({ id: pending.id, assignmentId, deviceId, kind: pending.kind, issuedAt, expiresAt, selectionRevision: generation(row), ...(pending.slot_at ? { slotAt: asIso(pending.slot_at) } : {}), ...(pending.options ? { options: pending.options } : {}) });
            await c.query("UPDATE building_probe_jobs SET status='dispatched',signed_job=$2,expires_at=$3,dispatched_at=now(),lease_expires_at=(SELECT lease_until FROM building_probe_campus_lease WHERE job_id=$1) WHERE id=$1", [pending.id, signed, new Date(expiresAt * 1000)]);
            if (pending.slot_key) await c.query("UPDATE building_probe_slots SET state='running' WHERE key=$1", [pending.slot_key]);
          }
        }
      }
      if(runningJobId) {
        const current=(await c.query("SELECT status FROM building_probe_jobs WHERE id=$1",[runningJobId])).rows[0];
        if(current?.status!=='dispatched')cancelRunningJobId=runningJobId;
      }
      const signedId=signed?JSON.parse(Buffer.from(signed.split('.')[1]!,'base64url').toString('utf8')).id:runningJobId;
      const lease=signedId?(await c.query("SELECT lease_until FROM building_probe_campus_lease WHERE job_id=$1 AND lease_until>now()",[signedId])).rows[0]:null;
      return { acceptedResults: accepted, job: signed, selection: this.selection(row),pollAfterSeconds:pending?PENDING_POLL_SECONDS:60, ...(lease?{leaseExpiresAt:asIso(lease.lease_until)}:{}), ...(cancelRunningJobId ? { cancelRunningJobId } : {}) };
    });
  }
  private validateThroughput(result: ProbeResult, job: any) {
    const d = result.details, options = job.options;
    if (!options || d.profile !== options.profile || d.targetId !== options.targetId || d.bytes! > options.maxBytes || d.elapsedMs! > (options.timeoutSeconds + 30) * 1000 || (d.profile !== "capacity" && d.rangeCount! > 1)) throw new ProbeError(400, "Throughput result exceeds its signed bounds.");
    if (d.segments && (new Set(d.segments.map(s => s.ordinal)).size !== d.segments.length || d.segments.length !== d.rangeCount || d.segments.reduce((n,s) => n+s.bytes,0) !== d.bytes || d.segments.some(s => s.bytes>s.requestedBytes))) throw new ProbeError(400, "Inconsistent range accounting.");
    if (result.outcome === "completed") {
      const calculated = d.bytes! * 8 / (d.elapsedMs! * 1000);
      if (d.mbps === null || d.mbps === undefined || Math.abs(d.mbps-calculated)>Math.max(.1,calculated*.05)) throw new ProbeError(400, "Throughput rate does not match bytes and elapsed time.");
    }
  }
  private async queueSlot(c: PoolClient, probe: any, slot: ScheduleSlot, attempt = 0) {
    const id = randomUUID(), options = throughputOptions(slot.profile);
    let capacityLane: number | undefined;
    if(slot.profile==='capacity') {
      const lanes=(await c.query('SELECT * FROM building_probe_campus_lease ORDER BY id')).rows;
      const lane=chooseTransferLane('capacity',lanes,probe.building_id,this.policy());
      if(lane===null || Date.parse(slot.windowEndsAt)<=Date.now())return false;
      capacityLane=lane;
    }
    await c.query("INSERT INTO building_probe_jobs(id,assignment_id,device_id,kind,status,expires_at,selection_revision,slot_at,options,slot_key) VALUES($1,$2,$3,'throughput','pending',$4,$5,$6,$7::jsonb,$8)", [id, probe.id, probe.device_id, slot.windowEndsAt, generation(probe), slot.slotAt, JSON.stringify(options), slot.key]);
    await c.query("INSERT INTO building_probe_slots(key,building_id,assignment_id,profile,slot_at,window_ends_at,state,attempt,first_assignment_id,job_id) VALUES($1,$2,$3,$4,$5,$6,'queued',$7,$3,$8) ON CONFLICT(key) DO UPDATE SET assignment_id=$3,state='queued',attempt=$7,job_id=$8", [slot.key, probe.building_id, probe.id, slot.profile, slot.slotAt, slot.windowEndsAt, attempt, id]);
    if(capacityLane)await c.query("UPDATE building_probe_campus_lease SET job_id=$2,building_id=$3,lease_until=least(now()+interval '90 seconds',$4::timestamptz) WHERE id=$1",[capacityLane,id,probe.building_id,slot.windowEndsAt]);
    return true;
  }
  private async skipSlot(c: PoolClient, probe: any, slot: ScheduleSlot, reason: string) {
    await c.query("INSERT INTO building_probe_slots(key,building_id,assignment_id,profile,slot_at,window_ends_at,state,reason) VALUES($1,$2,$3,$4,$5,$6,'skipped',$7) ON CONFLICT DO NOTHING", [slot.key, probe.building_id, probe.id, slot.profile, slot.slotAt, slot.windowEndsAt, reason]);
    await c.query("UPDATE building_probes SET missed_slot=greatest(missed_slot,$2::timestamptz) WHERE id=$1", [probe.id, slot.slotAt]);
  }
  private async tick(c: PoolClient, policy: ProbeSchedulePolicy) {
    await c.query("UPDATE building_probe_jobs SET status='expired' WHERE status IN ('pending','dispatched') AND expires_at<=now()");
    const expired = (await c.query("SELECT j.*,l.id AS lease_id FROM building_probe_campus_lease l JOIN building_probe_jobs j ON j.id=l.job_id WHERE l.lease_until<=now() OR (j.status='expired' AND j.signed_job IS NULL) FOR UPDATE")).rows;
    for (const job of expired) {
      await c.query("UPDATE building_probe_jobs SET status='expired' WHERE id=$1 AND status='dispatched'", [job.id]);
      if (job.slot_key) await c.query("UPDATE building_probe_slots SET state='failed',reason='lease expired' WHERE key=$1 AND state IN ('queued','running')", [job.slot_key]);
      if(job.status!=='cancelled')await c.query("UPDATE building_probes SET consecutive_failures=consecutive_failures+$2,missed_slot=greatest(missed_slot,$3::timestamptz) WHERE id=$1",[job.assignment_id,job.signed_job?1:0,job.slot_at]);
      await c.query("UPDATE building_probe_campus_lease SET job_id=NULL,building_id=NULL,lease_until=NULL WHERE id=$1",[job.lease_id]);
    }
    await c.query("UPDATE building_probe_campus_lease SET job_id=NULL,building_id=NULL,lease_until=NULL WHERE lease_until<=now()");
    if (!policy.enabled) {
      await c.query("UPDATE building_probe_slots SET state='cancelled',reason='scheduler or target readiness disarmed' WHERE job_id IN (SELECT id FROM building_probe_jobs WHERE kind='throughput' AND status IN ('pending','dispatched'))");
      await c.query("UPDATE building_probe_jobs SET status='cancelled' WHERE kind='throughput' AND status IN ('pending','dispatched')"); return;
    }
    const probes = (await c.query("SELECT * FROM building_probes WHERE enabled AND selected ORDER BY building_id,id")).rows;
    const active = (await c.query("SELECT j.*,p.building_id FROM building_probe_jobs j JOIN building_probes p ON p.id=j.assignment_id WHERE j.status IN ('pending','dispatched')")).rows;
    const now = Date.now();
    for(const probe of probes) {
      if(!probe.activation_at || !reporting(probe.last_seen,now))continue;
      const key=`${probe.id}:${generation(probe)}:baseline:${asIso(probe.activation_at)}`;
      if((await c.query('SELECT key FROM building_probe_slots WHERE key=$1',[key])).rowCount||active.some(j=>j.assignment_id===probe.id))continue;
      const slotAt=asIso(probe.activation_at)!,windowEndsAt=new Date(new Date(probe.activation_at).getTime()+90000).toISOString();
      if(now>Date.parse(windowEndsAt)) {
        await c.query("INSERT INTO building_probe_slots(key,building_id,assignment_id,profile,slot_at,window_ends_at,state,reason) VALUES($1,$2,$3,'network',$4,$5,'skipped','baseline activation gap: no catch-up') ON CONFLICT DO NOTHING",[key,probe.building_id,probe.id,slotAt,windowEndsAt]);
        continue;
      }
      const id=randomUUID();
      await c.query("INSERT INTO building_probe_jobs(id,assignment_id,device_id,kind,status,expires_at,selection_revision,slot_at,slot_key) VALUES($1,$2,$3,'network','pending',now()+interval '3 minutes',$4,$5,$6)",[id,probe.id,probe.device_id,generation(probe),slotAt,key]);
      await c.query("INSERT INTO building_probe_slots(key,building_id,assignment_id,profile,slot_at,window_ends_at,state,first_assignment_id,job_id) VALUES($1,$2,$3,'network',$4,$5,'queued',$3,$6)",[key,probe.building_id,probe.id,slotAt,windowEndsAt,id]);
      active.push({id,assignment_id:probe.id,building_id:probe.building_id,kind:'network'});
    }
    if(!policy.targetReady) {
      await c.query("UPDATE building_probe_slots SET state='cancelled',reason='target readiness disarmed' WHERE job_id IN (SELECT id FROM building_probe_jobs WHERE kind='throughput' AND status IN ('pending','dispatched'))");
      await c.query("UPDATE building_probe_jobs SET status='cancelled' WHERE kind='throughput' AND status IN ('pending','dispatched')");return;
    }
    const failures = (await c.query("SELECT * FROM building_probe_slots s WHERE profile='capacity' AND state='failed' AND attempt=0 AND window_ends_at>now() AND NOT EXISTS(SELECT 1 FROM building_probe_campus_lease l WHERE l.job_id=s.job_id AND l.lease_until>now())")).rows;
    for (const slot of failures) {
      const alternate = selectCapacityProbe(probes.filter(p => p.building_id===slot.building_id && !active.some(j=>j.assignment_id===p.id)), slot.first_assignment_id, now, slot.first_assignment_id);
      await c.query("UPDATE building_probe_slots SET attempt=1 WHERE key=$1", [slot.key]);
      if (alternate) {
        const admitted=await this.queueSlot(c,alternate,{key:slot.key,profile:"capacity",slotAt:asIso(slot.slot_at)!,windowEndsAt:asIso(slot.window_ends_at)!,late:false},1);
        if(admitted)active.push({assignment_id:alternate.id,building_id:alternate.building_id,kind:'throughput',options:{profile:'capacity'}});
        else await c.query("UPDATE building_probe_slots SET state='skipped',reason='skipped_due_to_capacity_contention' WHERE key=$1",[slot.key]);
      }
    }
    for (const buildingId of new Set<string>(probes.map(p=>p.building_id))) {
      const members = probes.filter(p=>p.building_id===buildingId);
      for (const slot of capacitySlots(buildingId, now)) {
        if ((await c.query("SELECT key FROM building_probe_slots WHERE key=$1", [slot.key])).rowCount) continue;
        const previous = (await c.query("SELECT assignment_id FROM building_probe_slots WHERE building_id=$1 AND profile='capacity' ORDER BY slot_at DESC LIMIT 1", [buildingId])).rows[0]?.assignment_id ?? null;
        const candidate = selectCapacityProbe(members.filter(p=>p.reporting_since&&new Date(p.reporting_since).getTime()<=Date.parse(slot.slotAt)&&!active.some(j=>j.assignment_id===p.id && (j.kind!=='throughput'||j.options?.profile==='capacity'))), previous, now);
        if (slot.late || !candidate) { await this.skipSlot(c,members[0],slot,slot.late?"offline gap: no catch-up":"no eligible selected probe"); continue; }
        await c.query("UPDATE building_probe_jobs SET status='cancelled' WHERE assignment_id=$1 AND kind='throughput' AND options->>'profile'<>'capacity' AND status IN ('pending','dispatched')", [candidate.id]);
        if(await this.queueSlot(c,candidate,slot))active.push({assignment_id:candidate.id,building_id:buildingId,kind:'throughput',options:{profile:'capacity'}});
        else await this.skipSlot(c,candidate,slot,'skipped_due_to_capacity_contention');
      }
    }
    for (const probe of probes) {
      if (!capable(probe.snapshot)) continue;
      const slot = deviceSlot(probe.id,generation(probe),probe.activation_at,now);
      if (!slot || (await c.query("SELECT key FROM building_probe_slots WHERE key=$1",[slot.key])).rowCount) continue;
      if (slot.late || !reporting(probe.last_seen,now) || (probe.reporting_since&&new Date(probe.reporting_since).getTime()>Date.parse(slot.slotAt))) { await this.skipSlot(c,probe,slot,"offline gap: no catch-up"); continue; }
      if (active.some(j=>j.assignment_id===probe.id && j.kind==='throughput' && j.options?.profile==='capacity')) { await this.skipSlot(c,probe,slot,"capacity supersedes this slot on this computer"); continue; }
      const own = active.find(j=>j.assignment_id===probe.id);
      if (own) { if (slot.profile==='hourly' && own.kind==='throughput' && own.options?.profile==='quick') await c.query("UPDATE building_probe_jobs SET status='cancelled' WHERE id=$1",[own.id]); else { await this.skipSlot(c,probe,slot,"probe already has an active diagnostic"); continue; } }
      await this.queueSlot(c,probe,slot); active.push({assignment_id:probe.id,building_id:probe.building_id,kind:'throughput',options:{profile:slot.profile}});
    }
    await c.query("UPDATE building_probe_slots SET state='skipped',reason='scheduled window expired' WHERE state='queued' AND window_ends_at<=now()");
  }
  async enqueue(id: string, kind: ProbeJob["kind"], userId: number) {
    return this.transaction(async c => {
      const probe = (await c.query("SELECT * FROM building_probes WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!probe?.enabled || !probe.selected || !probe.device_id || !reporting(probe.last_seen)) throw new ProbeError(409, "The selected probe must be reporting before a test can run.");
      if (kind==='throughput' && (!capable(probe.snapshot) || !this.policy().enabled || !this.policy().targetReady)) throw new ProbeError(409,"Throughput capability, reviewed scheduling and target readiness are required.");
      await c.query("UPDATE building_probe_jobs SET status='expired' WHERE assignment_id=$1 AND status IN ('pending','dispatched') AND expires_at<now()",[id]);
      if ((await c.query("SELECT id FROM building_probe_jobs WHERE assignment_id=$1 AND status IN ('pending','dispatched')",[id])).rowCount) throw new ProbeError(409,"This probe already has a pending test.");
      const jobId=randomUUID(), options=kind==='throughput'?throughputOptions('quick'):null;
      await c.query("INSERT INTO building_probe_jobs(id,assignment_id,device_id,kind,status,expires_at,created_by,selection_revision,slot_at,options) VALUES($1,$2,$3,$4,'pending',now()+interval '3 minutes',$5,$6,now(),$7::jsonb)",[jobId,id,probe.device_id,kind,userId,generation(probe),JSON.stringify(options)]);
      return {id:jobId,status:'pending'};
    });
  }
  async exportResults(after: string, limit: number, recent=false) {
    await this.ensure(); const rows=(await this.pool.query(`SELECT id::text AS cursor,job_id AS "jobId",device_id AS "deviceId",assignment_id AS "assignmentId",building_id AS "buildingId",test_type AS "testType",original_sample_at AS "originalSampleAt",received_at AS "receivedAt",result FROM building_probe_result_exports WHERE id>$1 ORDER BY id ${recent?'DESC':'ASC'} LIMIT $2`,[after,limit])).rows;
    if(recent)rows.reverse();
    const results=rows.map(row=>({...row,originalSampleAt:new Date(row.originalSampleAt).toISOString(),receivedAt:new Date(row.receivedAt).toISOString(),sampleId:digest(`${row.jobId}|${row.deviceId}|${row.testType}|${new Date(row.originalSampleAt).toISOString()}`)}));
    const health=(await this.list()).slice(0,1000).map(p=>({assignmentId:p.id,deviceId:p.deviceId,buildingId:p.buildingId,computerName:p.computerName,selected:p.selected,selectionRevision:p.selectionRevision,activationAt:p.activationAt,lastSeen:p.lastSeen,capable:p.capable,eligible:p.eligible,missedSlot:p.missedSlot,missedSlotReason:p.missedSlotReason,consecutiveFailures:p.consecutiveFailures,lastThroughputAt:p.lastThroughputAt}));
    return {results,nextCursor:rows.at(-1)?.cursor??after,health,metrics:projectProbeMetrics(results)};
  }
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>) {
    await this.ensure(); const client=await this.pool.connect();
    try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(184739215)'); const result=await fn(client); await client.query('COMMIT'); return result; }
    catch(error) { await client.query('ROLLBACK'); throw error; } finally {client.release();}
  }
}
