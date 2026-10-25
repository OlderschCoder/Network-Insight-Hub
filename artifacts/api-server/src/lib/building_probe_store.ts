interface QueryResult { rows: any[]; rowCount: number | null; }
interface PoolClient { query(sql: string, values?: unknown[]): Promise<QueryResult>; release(): void; }
interface Pool { query(sql: string, values?: unknown[]): Promise<QueryResult>; connect(): Promise<PoolClient>; }
import { randomUUID } from "node:crypto";
import { digest, matches, computerName, buildingKey, ProbeError, type JobSigner, type ProbeSnapshot, type ProbeResult, type ProbeJob } from "./building_probe_protocol";

export const BUILDING_PROBE_DDL = `
CREATE TABLE IF NOT EXISTS building_probes (
 id uuid PRIMARY KEY, building_key varchar(160) NOT NULL, building varchar(160) NOT NULL,
 computer_name varchar(15) NOT NULL, enabled boolean NOT NULL DEFAULT true,
 adapter_id varchar(100), expected_voice_subnet varchar(64), device_id uuid,
 bootstrap_hash char(64), bootstrap_expires_at timestamptz, credential_hash char(64),
 created_by integer, created_at timestamptz NOT NULL DEFAULT now(), last_seen timestamptz,
 snapshot jsonb, CONSTRAINT building_probe_name_upper CHECK(computer_name = upper(computer_name))
);
CREATE UNIQUE INDEX IF NOT EXISTS building_probes_one_building ON building_probes(building_key) WHERE enabled;
CREATE UNIQUE INDEX IF NOT EXISTS building_probes_one_computer ON building_probes(computer_name) WHERE enabled;
CREATE UNIQUE INDEX IF NOT EXISTS building_probes_one_device ON building_probes(device_id) WHERE enabled;
CREATE TABLE IF NOT EXISTS building_probe_jobs (
 id uuid PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES building_probes(id), device_id uuid NOT NULL,
 kind varchar(20) NOT NULL CHECK(kind IN ('network','multicast')),
 status varchar(20) NOT NULL CHECK(status IN ('pending','dispatched','completed','expired','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 signed_job text, result jsonb, created_by integer, completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS building_probe_one_active_job ON building_probe_jobs(assignment_id)
 WHERE status IN ('pending','dispatched');
CREATE INDEX IF NOT EXISTS building_probe_jobs_history ON building_probe_jobs(assignment_id, created_at DESC);
`;

const viewColumns = `id, building, building_key AS "buildingKey", computer_name AS "computerName", enabled,
 adapter_id AS "adapterId", expected_voice_subnet AS "expectedVoiceSubnet", device_id AS "deviceId",
 created_at AS "createdAt", last_seen AS "lastSeen", snapshot`;
export class BuildingProbeStore {
  private ready?: Promise<void>;
  constructor(private readonly pool: Pool) { }
  async ensure() {
    this.ready ??= this.pool.query(BUILDING_PROBE_DDL).then(() => undefined).catch(error => { this.ready = undefined; throw error; });
    return this.ready;
  }
  async list() {
    await this.ensure();
    return (await this.pool.query(`SELECT ${viewColumns},
      (SELECT jsonb_agg(j) FROM (SELECT id,kind,
        CASE WHEN status IN ('pending','dispatched') AND expires_at<now() THEN 'expired' ELSE status END AS status,
        result,created_at AS "createdAt",expires_at AS "expiresAt" FROM building_probe_jobs
        WHERE assignment_id=building_probes.id AND device_id=building_probes.device_id ORDER BY created_at DESC LIMIT 5) j) AS jobs
      FROM building_probes ORDER BY building`)).rows;
  }
  async assign(input: { building: string; computerName: string; adapterId?: string | null; expectedVoiceSubnet?: string | null }, bootstrap: string, userId: number) {
    await this.ensure();
    try {
      const result = await this.pool.query(`INSERT INTO building_probes
       (id,building_key,building,computer_name,adapter_id,expected_voice_subnet,bootstrap_hash,bootstrap_expires_at,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '20 minutes',$8) RETURNING ${viewColumns}`,
      [randomUUID(), buildingKey(input.building), input.building.trim(), computerName(input.computerName),
        input.adapterId || null, input.expectedVoiceSubnet || null, digest(bootstrap), userId]);
      if (!result.rows[0]) throw new ProbeError(409, "This building already has a selected probe. Revoke it before replacing it.");
      return result.rows[0];
    } catch (error: any) {
      if (error.code === "23505") throw new ProbeError(409, "This building or computer already has an active target. Revoke it before replacing it.");
      throw error;
    }
  }
  async revoke(id: string) {
    await this.transaction(async c => {
      await c.query("UPDATE building_probes SET enabled=false,credential_hash=NULL,bootstrap_hash=NULL WHERE id=$1", [id]);
      await c.query("UPDATE building_probe_jobs SET status='cancelled' WHERE assignment_id=$1 AND status IN ('pending','dispatched')", [id]);
    });
  }
  async enroll(input: { assignmentId: string; deviceId: string; computerName: string; proposedToken: string }, bootstrap: string) {
    return this.transaction(async c => {
      const row = (await c.query("SELECT * FROM building_probes WHERE id=$1 FOR UPDATE", [input.assignmentId])).rows[0];
      if (!row?.enabled || row.computer_name !== computerName(input.computerName)) throw new ProbeError(403, "Probe enrollment rejected.");
      // Retrying a lost enrollment response may prove the already-pinned device
      // credential; an old bootstrap can never replace another device.
      if (row.device_id === input.deviceId && matches(input.proposedToken, row.credential_hash)) return;
      if (row.device_id || !matches(bootstrap, row.bootstrap_hash) || new Date(row.bootstrap_expires_at).getTime() <= Date.now())
        throw new ProbeError(403, "Probe enrollment rejected.");
      await c.query("UPDATE building_probes SET device_id=$2,credential_hash=$3,bootstrap_hash=NULL WHERE id=$1",
        [input.assignmentId, input.deviceId, digest(input.proposedToken)]);
    });
  }
  async authenticate(assignmentId: string, deviceId: string, credential: string) {
    await this.ensure();
    const row = (await this.pool.query("SELECT * FROM building_probes WHERE id=$1", [assignmentId])).rows[0];
    if (!row?.enabled || row.device_id !== deviceId || !matches(credential, row.credential_hash)) throw new ProbeError(401, "Probe credential rejected.");
    return row;
  }
  async heartbeat(assignmentId: string, deviceId: string, credential: string, snapshot: ProbeSnapshot, results: ProbeResult[], signer: JobSigner) {
    return this.transaction(async c => {
      const row = (await c.query("SELECT * FROM building_probes WHERE id=$1 FOR UPDATE", [assignmentId])).rows[0];
      if (!row?.enabled || row.device_id !== deviceId || !matches(credential, row.credential_hash)) throw new ProbeError(401, "Probe credential rejected.");
      if (computerName(snapshot.computerName) !== row.computer_name) throw new ProbeError(403, "Probe computer identity mismatch.");
      const accepted: string[] = [];
      for (const result of results) {
        const job = (await c.query("SELECT kind,status FROM building_probe_jobs WHERE id=$1 AND assignment_id=$2 AND device_id=$3 FOR UPDATE", [result.jobId, assignmentId, deviceId])).rows[0];
        if (!job || job.kind !== result.kind) throw new ProbeError(403, "Result is outside this probe assignment.");
        if (job.status === "completed") { accepted.push(result.jobId); continue; }
        if (job.status !== "dispatched") { accepted.push(result.jobId); continue; }
        await c.query("UPDATE building_probe_jobs SET status='completed',result=$2::jsonb,completed_at=now() WHERE id=$1",
          [result.jobId, JSON.stringify(result)]);
        accepted.push(result.jobId);
      }
      await c.query("UPDATE building_probes SET last_seen=now(),snapshot=$2::jsonb WHERE id=$1", [assignmentId, JSON.stringify(snapshot)]);
      await c.query("UPDATE building_probe_jobs SET status='expired' WHERE assignment_id=$1 AND status IN ('pending','dispatched') AND expires_at<now()", [assignmentId]);
      const pending = (await c.query("SELECT * FROM building_probe_jobs WHERE assignment_id=$1 AND device_id=$2 AND status IN ('pending','dispatched') ORDER BY created_at LIMIT 1 FOR UPDATE", [assignmentId, deviceId])).rows[0];
      let signed: string | null = pending?.signed_job || null;
      if (pending?.status === "pending") {
        const issuedAt = Math.floor(Date.now() / 1000);
        signed = signer.sign({ id: pending.id, assignmentId, deviceId, kind: pending.kind, issuedAt, expiresAt: issuedAt + 180 });
        await c.query("UPDATE building_probe_jobs SET status='dispatched',signed_job=$2,expires_at=now()+interval '3 minutes' WHERE id=$1", [pending.id, signed]);
      }
      return { acceptedResults: accepted, job: signed };
    });
  }
  async enqueue(id: string, kind: ProbeJob["kind"], userId: number) {
    return this.transaction(async c => {
      const probe = (await c.query("SELECT * FROM building_probes WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!probe?.enabled || !probe.device_id || !probe.last_seen || Date.now() - new Date(probe.last_seen).getTime() > 5 * 60_000)
        throw new ProbeError(409, "The selected probe must be reporting before a test can run.");
      await c.query("UPDATE building_probe_jobs SET status='expired' WHERE assignment_id=$1 AND status IN ('pending','dispatched') AND expires_at<now()", [id]);
      if ((await c.query("SELECT id FROM building_probe_jobs WHERE assignment_id=$1 AND status IN ('pending','dispatched')", [id])).rowCount)
        throw new ProbeError(409, "This probe already has a pending test.");
      const jobId = randomUUID();
      await c.query("INSERT INTO building_probe_jobs(id,assignment_id,device_id,kind,status,expires_at,created_by) VALUES($1,$2,$3,$4,'pending',now()+interval '3 minutes',$5)", [jobId, id, probe.device_id, kind, userId]);
      await c.query("DELETE FROM building_probe_jobs WHERE assignment_id=$1 AND status NOT IN ('pending','dispatched') AND id NOT IN (SELECT id FROM building_probe_jobs WHERE assignment_id=$1 ORDER BY created_at DESC LIMIT 50)", [id]);
      return { id: jobId, status: "pending" };
    });
  }
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>) {
    await this.ensure();
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
