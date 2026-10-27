import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { externalProbeConfig, fresh, newToken, ONLINE_MS, tokenHash } from "./building_diagnostics";
import { DiagnosticsError, ensureDiagnosticsSchema, type Inventory } from "./building_diagnostics_store";

export const MAX_ENROLLMENT_DEVICES = 1000;
export const enrollmentStatuses = ["queued", "claimed", "installing", "installed", "online", "skipped", "unreachable", "failed"] as const;
export const enrollmentReasons = ["already-enrolled", "revoked-identity-preserved", "already-queued", "existing-configuration-preserved", "directory-changed", "unsupported-windows", "private-dns-unavailable", "kerberos-unavailable", "identity-mismatch", "payload-signature-invalid", "unsafe-installation-path", "execution-policy-restricted", "trusted-publisher-missing", "execution-policy-review-required", "installation-failed", "task-not-running", "installed-awaiting-check-in", "worker-interrupted-review-required", "credential-delivery-unknown"] as const;
type Client = Pick<typeof pool, "query">;
type Selection = { requestId: string; adObjectGuids: string[] };
type Claim = { requestId: string; adObjectGuid: string; claimId: string };
type Evidence = { taskRunning: boolean; taskSystem: boolean; helperVersion: string; signerThumbprint: string; payloadSha256: string };
let ready: Promise<unknown> | undefined;
const iso = (v: any) => v ? new Date(v).toISOString() : null;
const hashSelection = (guids: string[]) => createHash("sha256").update([...guids].map(g => g.toLowerCase()).sort().join("\n")).digest("hex");

async function schema() {
  await ensureDiagnosticsSchema();
  return ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS building_diagnostics_enrollment_requests(id uuid PRIMARY KEY,selection_hash text NOT NULL,requested_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS building_diagnostics_enrollment_items(
      request_id uuid NOT NULL REFERENCES building_diagnostics_enrollment_requests(id),ad_object_guid uuid NOT NULL,
      computer_name text NOT NULL,domain text NOT NULL,status text NOT NULL CHECK(status IN ('queued','claimed','installing','installed','skipped','unreachable','failed')),
      reason text,device_id uuid REFERENCES building_diagnostics_devices(id),claim_id uuid,claimed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),evidence jsonb NOT NULL DEFAULT '{}',PRIMARY KEY(request_id,ad_object_guid));
    CREATE UNIQUE INDEX IF NOT EXISTS building_diagnostics_enrollment_active ON building_diagnostics_enrollment_items(ad_object_guid) WHERE status IN ('queued','claimed','installing');
    CREATE TABLE IF NOT EXISTS building_diagnostics_enrollment_workers(id text PRIMARY KEY,last_seen_at timestamptz NOT NULL DEFAULT now());
  `).catch(error => { ready = undefined; throw error; });
}
async function transaction<T>(fn: (client: Client) => Promise<T>) {
  await schema(); const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(17409243)"); const value = await fn(client); await client.query("COMMIT"); return value; }
  catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
async function roster(client: Client) {
  const inv = (await client.query("SELECT data FROM building_diagnostics_inventory WHERE id=1")).rows[0]?.data as Inventory | undefined;
  if (!inv || !fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000)) throw new DiagnosticsError(409, "A current enabled AD roster is required for bulk enrollment");
  return inv;
}
export function resolveEnrollmentSelection(inv: Inventory, selected: string[]) {
  if (!selected.length || selected.length > MAX_ENROLLMENT_DEVICES || new Set(selected.map(g => g.toLowerCase())).size !== selected.length) throw new DiagnosticsError(400, "Select unique AD computers within the bulk limit");
  if (!fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000)) throw new DiagnosticsError(409, "The AD roster is stale");
  const index = new Map(inv.adComputers.map(a => [a.adObjectGuid.toLowerCase(), a]));
  return selected.map(guid => {
    const row = index.get(guid.toLowerCase());
    if (!row?.enabled || row.domain.toLowerCase() !== "sccc.edu") throw new DiagnosticsError(409, "Every selected computer must match the current enabled SCCC AD roster");
    return row;
  });
}
async function expireClaims(client: Client) {
  // An interrupted credential delivery is not safe to replay automatically.
  await client.query("UPDATE building_diagnostics_enrollment_items SET status='failed',reason='worker-interrupted-review-required',updated_at=now() WHERE status IN ('claimed','installing') AND claimed_at<now()-interval '15 minutes'");
}
async function claimed(client: Client, claim: Claim) {
  const row = (await client.query("SELECT * FROM building_diagnostics_enrollment_items WHERE request_id=$1 AND ad_object_guid=$2 FOR UPDATE", [claim.requestId, claim.adObjectGuid])).rows[0];
  if (!row || row.claim_id !== claim.claimId || !["claimed", "installing"].includes(row.status) || Date.now() - new Date(row.claimed_at).getTime() > 15 * 60_000) throw new DiagnosticsError(409, "The enrollment claim is unavailable or expired; do not retry credential delivery");
  return row;
}

export const diagnosticsEnrollmentStore = {
  async create(input: Selection, actor: string) {
    await transaction(async client => {
      const previous = (await client.query("SELECT selection_hash FROM building_diagnostics_enrollment_requests WHERE id=$1", [input.requestId])).rows[0];
      if (previous) { if (previous.selection_hash !== hashSelection(input.adObjectGuids)) throw new DiagnosticsError(409, "Request ID already identifies a different computer selection"); return; }
      const selected = resolveEnrollmentSelection(await roster(client), input.adObjectGuids);
      await expireClaims(client);
      await client.query("INSERT INTO building_diagnostics_enrollment_requests(id,selection_hash,requested_by) VALUES($1,$2,$3)", [input.requestId, hashSelection(input.adObjectGuids), actor]);
      for (const a of selected) {
        const existing = (await client.query("SELECT id,revoked_at FROM building_diagnostics_devices WHERE ad_object_guid=$1", [a.adObjectGuid])).rows[0];
        const active = (await client.query("SELECT 1 FROM building_diagnostics_enrollment_items WHERE ad_object_guid=$1 AND status IN ('queued','claimed','installing')", [a.adObjectGuid])).rowCount;
        const reason = existing ? existing.revoked_at ? "revoked-identity-preserved" : "already-enrolled" : active ? "already-queued" : null;
        await client.query("INSERT INTO building_diagnostics_enrollment_items(request_id,ad_object_guid,computer_name,domain,status,reason,device_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [input.requestId, a.adObjectGuid, a.computerName, a.domain, reason ? "skipped" : "queued", reason, existing?.id ?? null]);
      }
      await client.query("INSERT INTO building_diagnostics_audit(action,actor,reason,details) VALUES('bulk-enrollment-request',$1,'Operator selected AD computers for helper installation and reporting only',$2::jsonb)", [actor, JSON.stringify({ requestId: input.requestId, requested: selected.length })]);
    });
    return this.get(input.requestId);
  },
  async get(requestId: string) {
    await schema();
    await expireClaims(pool);
    const request = (await pool.query("SELECT id,created_at FROM building_diagnostics_enrollment_requests WHERE id=$1", [requestId])).rows[0];
    if (!request) throw new DiagnosticsError(404, "Unknown bulk enrollment request");
    const rows = (await pool.query("SELECT i.*,d.last_check_in,d.revoked_at FROM building_diagnostics_enrollment_items i LEFT JOIN building_diagnostics_devices d ON d.id=i.device_id WHERE request_id=$1 ORDER BY computer_name", [requestId])).rows;
    const inv = (await pool.query("SELECT data FROM building_diagnostics_inventory WHERE id=1")).rows[0]?.data as Inventory | undefined;
    const directoryCurrent = !!inv && fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000);
    const items = rows.map(row => {
      const adCurrent = directoryCurrent && inv!.adComputers.some(a => a.enabled && a.adObjectGuid.toLowerCase() === row.ad_object_guid && a.computerName.toLowerCase() === row.computer_name.toLowerCase() && a.domain.toLowerCase() === row.domain.toLowerCase());
      return { adObjectGuid: row.ad_object_guid, computerName: row.computer_name, status: row.status === "installed" && adCurrent && !row.revoked_at && fresh(iso(row.last_check_in), Date.now(), ONLINE_MS) && new Date(row.last_check_in).getTime() >= new Date(row.claimed_at).getTime() ? "online" : row.status, reason: row.reason, deviceId: row.device_id, updatedAt: iso(row.updated_at) };
    });
    const counts = Object.fromEntries(enrollmentStatuses.map(status => [status, items.filter(i => i.status === status).length]));
    const worker = (await pool.query("SELECT max(last_seen_at) AS seen FROM building_diagnostics_enrollment_workers")).rows[0]?.seen;
    return { requestId, status: counts.queued === items.length ? "queued" : counts.queued + counts.claimed + counts.installing ? "running" : "completed", requested: items.length, queued: counts.queued, counts, items, worker: { ready: fresh(iso(worker), Date.now(), ONLINE_MS), lastSeenAt: iso(worker) } };
  },
  async claim(workerId: string) {
    return transaction(async client => {
      await client.query("INSERT INTO building_diagnostics_enrollment_workers(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET last_seen_at=now()", [workerId]);
      await expireClaims(client);
      const inv = await roster(client);
      const slots = Math.max(0, 4 - Number((await client.query("SELECT count(*) AS n FROM building_diagnostics_enrollment_items WHERE status IN ('claimed','installing')")).rows[0].n));
      const rows = slots ? (await client.query("SELECT * FROM building_diagnostics_enrollment_items WHERE status='queued' ORDER BY updated_at,computer_name LIMIT $1 FOR UPDATE SKIP LOCKED", [slots])).rows : [];
      const items = [];
      for (const row of rows) {
        const a = inv.adComputers.find(a => a.adObjectGuid.toLowerCase() === row.ad_object_guid && a.enabled && a.computerName.toLowerCase() === row.computer_name.toLowerCase() && a.domain.toLowerCase() === row.domain.toLowerCase());
        const existing = (await client.query("SELECT id,revoked_at FROM building_diagnostics_devices WHERE ad_object_guid=$1", [row.ad_object_guid])).rows[0];
        if (!a || existing) { await client.query("UPDATE building_diagnostics_enrollment_items SET status='skipped',reason=$3,updated_at=now() WHERE request_id=$1 AND ad_object_guid=$2", [row.request_id, row.ad_object_guid, !a ? "directory-changed" : existing.revoked_at ? "revoked-identity-preserved" : "already-enrolled"]); continue; }
        const claimId = randomUUID();
        await client.query("UPDATE building_diagnostics_enrollment_items SET status='claimed',claim_id=$3,claimed_at=now(),updated_at=now() WHERE request_id=$1 AND ad_object_guid=$2", [row.request_id, row.ad_object_guid, claimId]);
        items.push({ requestId: row.request_id, adObjectGuid: row.ad_object_guid, computerName: row.computer_name, domain: row.domain, claimId });
      }
      return { items, concurrency: 4, policy: { externalProbeOrigin: externalProbeConfig().origin ?? "", permitSustained: false }, measurementsQueued: false };
    });
  },
  async provision(claim: Claim) {
    return transaction(async client => {
      const row = await claimed(client, claim);
      if (row.status !== "claimed" || row.device_id) throw new DiagnosticsError(409, "Credential delivery already attempted; retain protected configuration and review the outcome");
      resolveEnrollmentSelection(await roster(client), [row.ad_object_guid]);
      const a = (await roster(client)).adComputers.find(a => a.adObjectGuid.toLowerCase() === row.ad_object_guid)!;
      if (a.computerName.toLowerCase() !== row.computer_name.toLowerCase() || a.domain.toLowerCase() !== row.domain.toLowerCase()) throw new DiagnosticsError(409, "AD identity changed after bulk selection");
      if ((await client.query("SELECT 1 FROM building_diagnostics_devices WHERE ad_object_guid=$1", [row.ad_object_guid])).rowCount) throw new DiagnosticsError(409, "Existing diagnostic identity must be preserved");
      const deviceId = randomUUID(), deviceToken = newToken();
      await client.query("INSERT INTO building_diagnostics_devices(id,ad_object_guid,computer_name,domain,token_hash,provisioned_by) VALUES($1,$2,$3,$4,$5,'private bulk enrollment worker')", [deviceId, row.ad_object_guid, row.computer_name, row.domain, tokenHash(deviceToken)]);
      await client.query("UPDATE building_diagnostics_enrollment_items SET status='installing',device_id=$3,updated_at=now() WHERE request_id=$1 AND ad_object_guid=$2", [claim.requestId, claim.adObjectGuid, deviceId]);
      await client.query("INSERT INTO building_diagnostics_audit(device_id,action,actor,reason,details) VALUES($1,'provision','private bulk enrollment worker','Bulk selected verified AD enrollment',$2::jsonb)", [deviceId, JSON.stringify({ requestId: claim.requestId })]);
      return { deviceId, deviceToken, computerName: row.computer_name, domain: row.domain };
    });
  },
  async result(claim: Claim, status: "installed" | "skipped" | "unreachable" | "failed", reason: string, evidence?: Evidence) {
    return transaction(async client => {
      const row = await claimed(client, claim);
      if (status === "installed" && (!row.device_id || !evidence?.taskRunning || !evidence.taskSystem)) throw new DiagnosticsError(409, "Installed status requires the provisioned identity and running SYSTEM helper evidence");
      await client.query("UPDATE building_diagnostics_enrollment_items SET status=$3,reason=$4,evidence=$5::jsonb,updated_at=now() WHERE request_id=$1 AND ad_object_guid=$2", [claim.requestId, claim.adObjectGuid, status, reason, JSON.stringify(evidence ?? {})]);
      await client.query("INSERT INTO building_diagnostics_audit(device_id,action,actor,reason,details) VALUES($1,'bulk-enrollment-result','private bulk enrollment worker',$2,$3::jsonb)", [row.device_id, reason, JSON.stringify({ requestId: claim.requestId, adObjectGuid: claim.adObjectGuid, status })]);
      return { ok: true, status };
    });
  },
};
