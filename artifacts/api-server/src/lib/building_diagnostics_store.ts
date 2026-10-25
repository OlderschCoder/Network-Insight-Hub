import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { chooseCandidates, fresh, JOB_MS, newToken, ONLINE_MS, PING_COUNT, resolveLocation, TARGET_LABEL, tokenHash, TRANSFER_BYTES, type Assignment, type Heartbeat, type Observation } from "./building_diagnostics";

export class DiagnosticsError extends Error { constructor(public status: number, message: string) { super(message); } }
type Client = Pick<typeof pool, "query">;
export type Inventory = { adObservedAt: string; adComputers: { adObjectGuid: string; computerName: string; domain: string; enabled: boolean }[]; observations: Observation[]; userBuildingAssignments: Assignment[] };
let schemaReady: Promise<unknown> | undefined;
export function ensureDiagnosticsSchema() {
  // Lazy, separate schema: normal Fred startup is unchanged while the feature is disabled.
  return schemaReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS building_diagnostics_inventory (id integer PRIMARY KEY CHECK(id=1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), last_scheduler_at timestamptz);
    CREATE TABLE IF NOT EXISTS building_diagnostics_devices (
      id uuid PRIMARY KEY, ad_object_guid uuid NOT NULL UNIQUE, computer_name text NOT NULL,
      domain text NOT NULL, token_hash text NOT NULL UNIQUE, heartbeat jsonb, last_check_in timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), provisioned_by text NOT NULL,
      revoked_at timestamptz,revoked_by text,revoked_reason text,rotated_at timestamptz);
    CREATE TABLE IF NOT EXISTS building_diagnostics_jobs (
      id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES building_diagnostics_devices(id), building text,
      status text NOT NULL CHECK(status IN ('queued','running','complete','expired')),
      requested_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL, claimed_at timestamptz, download_started_at timestamptz,
      download_complete boolean NOT NULL DEFAULT false, upload_started_at timestamptz,
      upload_received_bytes integer, ping_count integer NOT NULL DEFAULT 0,
      download_bytes integer NOT NULL, upload_bytes integer NOT NULL);
    CREATE INDEX IF NOT EXISTS building_diagnostics_jobs_device ON building_diagnostics_jobs(device_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS building_diagnostics_reports (
      id bigserial PRIMARY KEY, job_id uuid NOT NULL UNIQUE REFERENCES building_diagnostics_jobs(id),
      device_id uuid NOT NULL REFERENCES building_diagnostics_devices(id), building text,
      recorded_at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL);
    CREATE INDEX IF NOT EXISTS building_diagnostics_reports_building ON building_diagnostics_reports(building,recorded_at DESC);
    CREATE INDEX IF NOT EXISTS building_diagnostics_reports_device ON building_diagnostics_reports(device_id,id DESC);
    CREATE TABLE IF NOT EXISTS building_diagnostics_audit (
      id bigserial PRIMARY KEY,device_id uuid NOT NULL REFERENCES building_diagnostics_devices(id),
      action text NOT NULL,actor text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
  `).catch((err) => { schemaReady = undefined; throw err; });
}
function iso(value: any): string | null { return value ? new Date(value).toISOString() : null; }
let inventoryCache: { expires: number; data: Inventory & { updatedAt: string | null } } | undefined;
async function inventory(client: Client = pool): Promise<Inventory & { updatedAt: string | null }> {
  if (client === pool && inventoryCache && inventoryCache.expires > Date.now()) return inventoryCache.data;
  const { rows } = await client.query("SELECT data,updated_at FROM building_diagnostics_inventory WHERE id=1");
  const data = { adObservedAt: "", adComputers: [], observations: [], userBuildingAssignments: [], ...(rows[0]?.data ?? {}), updatedAt: iso(rows[0]?.updated_at) };
  if (client === pool) inventoryCache = { expires: Date.now() + 5_000, data };
  return data;
}
async function transaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(17409243)"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
const indexes = new WeakMap<Inventory, { ad: Map<string, Inventory["adComputers"][number]>; macs: Map<string, Observation[]>; aps: Map<string, Observation[]>; users: Map<string, Assignment[]> }>();
function getIndexes(inv: Inventory) {
  let result = indexes.get(inv);
  if (result) return result;
  result = { ad: new Map(inv.adComputers.map((a) => [a.adObjectGuid.toLowerCase(), a])), macs: new Map(), aps: new Map(), users: new Map() };
  for (const o of inv.observations) { const key = (o.source === "switch" ? o.mac : o.bssid)?.replace(/[^a-f0-9]/gi, "").toLowerCase(); if (!key) continue; const map = o.source === "switch" ? result.macs : result.aps; map.set(key, [...(map.get(key) ?? []), o]); }
  for (const a of inv.userBuildingAssignments) { const key = a.username.trim().toLowerCase(); result.users.set(key, [...(result.users.get(key) ?? []), a]); }
  indexes.set(inv, result); return result;
}
function adMatch(inv: Inventory, d: any) {
  const a = getIndexes(inv).ad.get(d.ad_object_guid.toLowerCase());
  return !!a?.enabled && a.computerName.toLowerCase() === d.computer_name.toLowerCase() && a.domain.toLowerCase() === d.domain.toLowerCase();
}
function locationFor(heartbeat: Heartbeat, inv: Inventory) {
  const index = getIndexes(inv), observations: Observation[] = [];
  for (const i of heartbeat.interfaces) { observations.push(...(index.macs.get(i.mac.replace(/[^a-f0-9]/gi, "").toLowerCase()) ?? [])); if (i.bssid) observations.push(...(index.aps.get(i.bssid.replace(/[^a-f0-9]/gi, "").toLowerCase()) ?? [])); }
  return resolveLocation(heartbeat, observations, index.users.get(heartbeat.loggedOnUser?.trim().toLowerCase() ?? "") ?? []);
}
async function snapshot(client: Client = pool) {
  const inv = await inventory(client);
  const devices = (await client.query(`SELECT d.*,r.id AS report_id,r.recorded_at,r.data AS report_data,
    (SELECT max(created_at) FROM building_diagnostics_jobs j WHERE j.device_id=d.id) AS last_test_at
    FROM building_diagnostics_devices d LEFT JOIN LATERAL (SELECT * FROM building_diagnostics_reports WHERE device_id=d.id ORDER BY id DESC LIMIT 1) r ON true ORDER BY d.computer_name`)).rows;
  const enrolled = devices.map((d) => {
    const heartbeat = d.heartbeat ?? { interfaces: [] };
    const currentHeartbeat = fresh(iso(d.last_check_in), Date.now(), ONLINE_MS);
    const location = locationFor(heartbeat, inv);
    if (!currentHeartbeat && location.kind === "network-confirmed") location.kind = "stale";
    return { deviceId: d.id as string | null, enrolled: true, revoked: !!d.revoked_at, computerName: d.computer_name, adObjectGuid: d.ad_object_guid, adDomain: d.domain,
      adVerified: adMatch(inv, d) && fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000), online: currentHeartbeat && !d.revoked_at,
      lastCheckIn: iso(d.last_check_in), agentVersion: heartbeat.agentVersion ?? null,
      loggedOnUser: heartbeat.loggedOnUser ?? null, interfaces: heartbeat.interfaces, location,
      lastTestAt: iso(d.last_test_at), lastResult: d.report_id ? { id: String(d.report_id), recordedAt: iso(d.recorded_at), ...d.report_data } : null };
  });
  const enrolledIds = new Set(enrolled.map((d) => d.adObjectGuid.toLowerCase()));
  for (const a of inv.adComputers) {
    if (enrolledIds.has(a.adObjectGuid.toLowerCase())) continue;
    enrolled.push({ deviceId: null, enrolled: false, revoked: false, computerName: a.computerName, adObjectGuid: a.adObjectGuid, adDomain: a.domain,
      adVerified: a.enabled && fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000), online: false,
      lastCheckIn: null, agentVersion: null, loggedOnUser: null, interfaces: [],
      location: { building: null, kind: "unknown", source: null, observedAt: null }, lastTestAt: null, lastResult: null });
  }
  return { inv, devices: enrolled };
}
async function expire(client: Client) {
  await client.query("UPDATE building_diagnostics_jobs SET status='expired' WHERE status IN ('queued','running') AND expires_at<=now()");
}
export const diagnosticsStore = {
  async ingest(data: Inventory) {
    await ensureDiagnosticsSchema();
    await transaction(async (client) => {
      const previous = await inventory(client);
      if (Date.parse(data.adObservedAt) > Date.now() + 30_000 || Date.parse(data.adObservedAt) < Date.parse(previous.adObservedAt || "1970-01-01")) throw new DiagnosticsError(409, "AD snapshot timestamp is future or older than current inventory");
      await client.query("INSERT INTO building_diagnostics_inventory(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=$1,updated_at=now()", [JSON.stringify(data)]);
    });
    inventoryCache = undefined;
    return { ok: true, adComputers: data.adComputers.length, observations: data.observations.length, userBuildingAssignments: data.userBuildingAssignments.length };
  },
  async provision(input: { adObjectGuid: string; computerName: string; domain: string }, actor: string) {
    await ensureDiagnosticsSchema();
    return transaction(async (client) => {
      const inv = await inventory(client);
      const expected = { ad_object_guid: input.adObjectGuid, computer_name: input.computerName, domain: input.domain };
      if (!adMatch(inv, expected) || !fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000)) throw new DiagnosticsError(409, "Computer must match the current enabled AD roster");
      if ((await client.query("SELECT id FROM building_diagnostics_devices WHERE ad_object_guid=$1", [input.adObjectGuid])).rowCount) throw new DiagnosticsError(409, "Diagnostics identity already provisioned; retain its protected configuration");
      const deviceId = randomUUID(), deviceToken = newToken();
      await client.query("INSERT INTO building_diagnostics_devices(id,ad_object_guid,computer_name,domain,token_hash,provisioned_by) VALUES($1,$2,$3,$4,$5,$6)", [deviceId, input.adObjectGuid, input.computerName, input.domain, tokenHash(deviceToken), actor]);
      await client.query("INSERT INTO building_diagnostics_audit(device_id,action,actor,reason) VALUES($1,'provision',$2,'initial verified AD enrollment')", [deviceId, actor]);
      return { deviceId, deviceToken };
    });
  },
  async revoke(deviceId: string, reason: string, actor: string) {
    await ensureDiagnosticsSchema();
    return transaction(async (client) => {
      const result = await client.query("UPDATE building_diagnostics_devices SET revoked_at=now(),revoked_by=$2,revoked_reason=$3 WHERE id=$1 RETURNING id", [deviceId, actor, reason]);
      if (!result.rowCount) throw new DiagnosticsError(404, "Unknown diagnostics device");
      await client.query("UPDATE building_diagnostics_jobs SET status='expired' WHERE device_id=$1 AND status IN ('queued','running')", [deviceId]);
      await client.query("INSERT INTO building_diagnostics_audit(device_id,action,actor,reason) VALUES($1,'revoke',$2,$3)", [deviceId, actor, reason]);
      return { ok: true, deviceId, revoked: true };
    });
  },
  async rotate(deviceId: string, reason: string, actor: string) {
    await ensureDiagnosticsSchema();
    return transaction(async (client) => {
      const d = (await client.query("SELECT * FROM building_diagnostics_devices WHERE id=$1 FOR UPDATE", [deviceId])).rows[0];
      if (!d) throw new DiagnosticsError(404, "Unknown diagnostics device");
      const inv = await inventory(client);
      const adObject = getIndexes(inv).ad.get(d.ad_object_guid.toLowerCase());
      if (!adObject?.enabled || !fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000)) throw new DiagnosticsError(409, "Computer must match the current enabled AD roster");
      const deviceToken = newToken();
      // The immutable AD GUID allows an operator to recover after a legitimate rename;
      // the current name/domain come solely from the trusted directory snapshot.
      await client.query("UPDATE building_diagnostics_devices SET token_hash=$2,computer_name=$3,domain=$4,revoked_at=NULL,revoked_by=NULL,revoked_reason=NULL,rotated_at=now() WHERE id=$1", [deviceId, tokenHash(deviceToken), adObject.computerName, adObject.domain]);
      await client.query("UPDATE building_diagnostics_jobs SET status='expired' WHERE device_id=$1 AND status IN ('queued','running')", [deviceId]);
      await client.query("INSERT INTO building_diagnostics_audit(device_id,action,actor,reason) VALUES($1,'rotate',$2,$3)", [deviceId, actor, reason]);
      return { deviceId, deviceToken };
    });
  },
  async authenticate(token: string) {
    await ensureDiagnosticsSchema();
    if (!/^sccc-diag\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const d = (await pool.query("SELECT * FROM building_diagnostics_devices WHERE token_hash=$1", [tokenHash(token)])).rows[0];
    if (!d || d.revoked_at) return null;
    const inv = await inventory();
    return adMatch(inv, d) && fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000) ? { deviceId: d.id, computerName: d.computer_name, domain: d.domain } : null;
  },
  async overview() {
    await ensureDiagnosticsSchema();
    await expire(pool);
    const { inv, devices } = await snapshot();
    const jobs = (await pool.query(`SELECT j.*,d.computer_name FROM building_diagnostics_jobs j JOIN building_diagnostics_devices d ON d.id=j.device_id ORDER BY j.created_at DESC LIMIT 100`)).rows.map((j) => ({ id: j.id, deviceId: j.device_id, computerName: j.computer_name, building: j.building, status: j.status, createdAt: iso(j.created_at), expiresAt: iso(j.expires_at), requestedBy: j.requested_by }));
    // Buildings with no enrolled endpoint must remain visible as missing coverage.
    const catalog = (await pool.query("SELECT DISTINCT trim(building) AS building FROM net_nodes WHERE trim(building)<>''")).rows;
    const allBuildings = new Set([...catalog.map((b) => String(b.building)), ...inv.observations.map((o) => o.building), ...inv.userBuildingAssignments.map((a) => a.building)]);
    const recent = (await pool.query("SELECT DISTINCT ON(building) building,id,recorded_at,data FROM building_diagnostics_reports WHERE building IS NOT NULL ORDER BY building,id DESC")).rows;
    const buildings = [...allBuildings].sort().map((building) => {
      const members = devices.filter((d) => d.location.building === building), r = recent.find((r) => r.building === building);
      const lastResult = r ? { id: String(r.id), recordedAt: iso(r.recorded_at), ...r.data } : null;
      return { building, onlineDevices: members.filter((d) => d.online).length, eligibleDevices: members.filter((d) => d.online && d.adVerified && d.location.kind === "network-confirmed").length, lastResult, noCurrentMeasurement: !r || !!r.data.error || r.data.downloadMbps === null || r.data.uploadMbps === null || !fresh(iso(r.recorded_at), Date.now(), 12 * 60 * 60_000) };
    });
    return { devices, buildings, jobs, inventoryUpdatedAt: inv.updatedAt, adObservedAt: inv.adObservedAt || null, targetLabel: TARGET_LABEL };
  },
  async queue(input: { deviceIds?: string[]; building?: string }, actor: string, automatic = false) {
    await ensureDiagnosticsSchema();
    return transaction(async (client) => {
      await expire(client);
      if (automatic) {
        const sweep = await client.query("UPDATE building_diagnostics_inventory SET last_scheduler_at=now() WHERE id=1 AND (last_scheduler_at IS NULL OR last_scheduler_at<now()-interval '1 minute') RETURNING id");
        if (!sweep.rowCount) return { queued: 0, jobIds: [] };
      }
      const { devices } = await snapshot(client);
      const recent = (await client.query("SELECT building,max(created_at) AS tested_at FROM building_diagnostics_jobs WHERE building IS NOT NULL AND status IN ('running','complete') GROUP BY building")).rows;
      const enrolled = devices.filter((d) => !!d.deviceId).map((d) => ({ ...d, deviceId: d.deviceId! }));
      let selected = automatic ? chooseCandidates(enrolled, new Map(recent.map((r) => [r.building, new Date(r.tested_at).getTime()]))) : enrolled.filter((d) => (input.deviceIds?.includes(d.deviceId) || (input.building && d.location.building === input.building)) && d.online && d.adVerified);
      const pending = (await client.query("SELECT device_id,building FROM building_diagnostics_jobs WHERE status IN ('queued','running')")).rows;
      selected = selected.filter((d) => !pending.some((p) => p.device_id === d.deviceId || (automatic && p.building === d.location.building))).slice(0, Math.max(0, 100 - pending.length));
      const ids: string[] = [];
      for (let i = 0; i < selected.length; i++) {
        const d = selected[i]!, id = randomUUID();
        // Queue lifetime allows serial execution; each claim receives a new two-minute lease.
        await client.query("INSERT INTO building_diagnostics_jobs(id,device_id,building,status,requested_by,expires_at,download_bytes,upload_bytes) VALUES($1,$2,$3,'queued',$4,now()+interval '30 minutes',$5,$5)", [id, d.deviceId, d.location.kind === "network-confirmed" ? d.location.building : null, actor, TRANSFER_BYTES]);
        ids.push(id);
      }
      return { queued: ids.length, jobIds: ids };
    });
  },
  async checkIn(input: Heartbeat, auto: boolean) {
    await pool.query("UPDATE building_diagnostics_devices SET heartbeat=$2,last_check_in=now() WHERE id=$1", [input.deviceId, JSON.stringify(input)]);
    if (auto) await this.queue({}, "automatic building rotation", true);
    return transaction(async (client) => {
      await expire(client);
      // Serialize all load tests, including across API processes.
      if ((await client.query("SELECT id FROM building_diagnostics_jobs WHERE status='running' LIMIT 1")).rowCount) return null;
      // A 30-second cooldown separates transfer runs even if results arrive quickly.
      if ((await client.query("SELECT id FROM building_diagnostics_reports WHERE recorded_at>now()-interval '30 seconds' LIMIT 1")).rowCount) return null;
      const j = (await client.query("SELECT * FROM building_diagnostics_jobs WHERE device_id=$1 AND status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE", [input.deviceId])).rows[0];
      if (!j) return null;
      const { inv, devices } = await snapshot(client), current = devices.find((d) => d.deviceId === input.deviceId);
      if (!fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000) || !current?.adVerified || (j.building !== null && (current.location.kind !== "network-confirmed" || current.location.building !== j.building))) {
        await client.query("UPDATE building_diagnostics_jobs SET status='expired' WHERE id=$1", [j.id]); return null;
      }
      const expiresAt = new Date(Date.now() + JOB_MS).toISOString();
      await client.query("UPDATE building_diagnostics_jobs SET status='running',claimed_at=now(),expires_at=$2 WHERE id=$1", [j.id, expiresAt]);
      return { id: j.id, expiresAt, downloadBytes: j.download_bytes, uploadBytes: j.upload_bytes, pingCount: PING_COUNT };
    });
  },
  async transfer(deviceId: string, jobId: string, kind: "ping" | "download" | "upload") {
    const column = kind === "ping" ? "ping_count=ping_count+1" : `${kind}_started_at=now()`;
    const condition = kind === "ping" ? `ping_count<${PING_COUNT}` : `${kind}_started_at IS NULL`;
    const remaining = kind === "ping" ? "now()" : "now()+interval '20 seconds'";
    const result = await pool.query(`UPDATE building_diagnostics_jobs SET ${column} WHERE id=$1 AND device_id=$2 AND status='running' AND expires_at>${remaining} AND ${condition} RETURNING download_bytes,upload_bytes`, [jobId, deviceId]);
    if (!result.rows[0]) throw new DiagnosticsError(409, "Invalid, expired, or already used job operation");
    return { downloadBytes: result.rows[0].download_bytes, uploadBytes: result.rows[0].upload_bytes };
  },
  async transferReceipt(jobId: string, kind: "download" | "upload", bytes: number) {
    if (kind === "download") await pool.query("UPDATE building_diagnostics_jobs SET download_complete=true WHERE id=$1 AND status='running'", [jobId]);
    else await pool.query("UPDATE building_diagnostics_jobs SET upload_received_bytes=$2 WHERE id=$1 AND status='running'", [jobId, bytes]);
  },
  async result(deviceId: string, input: any) {
    return transaction(async (client) => {
      const j = (await client.query("SELECT * FROM building_diagnostics_jobs WHERE id=$1 AND device_id=$2 AND status='running' AND expires_at>now() FOR UPDATE", [input.jobId, deviceId])).rows[0];
      if (!j) throw new DiagnosticsError(409, "Invalid, expired, or already completed job");
      if (!input.error && (!j.download_complete || j.upload_received_bytes !== j.upload_bytes || input.downloadBytes !== j.download_bytes || input.uploadBytes !== j.upload_bytes || input.requestLossPercent < (PING_COUNT - j.ping_count) * 100 / PING_COUNT)) throw new DiagnosticsError(409, "Server transfer receipts do not match this result");
      const data = { downloadMbps: input.error ? null : input.downloadMbps ?? null, uploadMbps: input.error ? null : input.uploadMbps ?? null, latencyMs: input.latencyMs ?? null, requestLossPercent: input.requestLossPercent ?? null, serverPingReceipts: j.ping_count, scheduledProbeCount: PING_COUNT, error: input.error ?? null, downloadBytes: input.downloadBytes ?? 0, uploadBytes: input.uploadBytes ?? 0, targetLabel: TARGET_LABEL, provenance: "authenticated endpoint measurement; server transfer receipts; not uplink capacity", requestLossKind: "HTTPS request failures" };
      const report = (await client.query("INSERT INTO building_diagnostics_reports(job_id,device_id,building,data) VALUES($1,$2,$3,$4) RETURNING id", [j.id, deviceId, j.building, JSON.stringify(data)])).rows[0];
      await client.query("UPDATE building_diagnostics_jobs SET status='complete' WHERE id=$1", [j.id]);
      return { ok: true, reportId: String(report.id) };
    });
  },
  async reports(after: string, limit: number) {
    await ensureDiagnosticsSchema();
    const rows = (await pool.query("SELECT r.*,d.computer_name,d.ad_object_guid FROM building_diagnostics_reports r JOIN building_diagnostics_devices d ON d.id=r.device_id WHERE r.id>$1 ORDER BY r.id LIMIT $2", [after, limit])).rows;
    return { reports: rows.map((r) => ({ id: String(r.id), seq: String(r.id), jobId: r.job_id, deviceId: r.device_id, computerName: r.computer_name, adObjectGuid: r.ad_object_guid, building: r.building, recordedAt: iso(r.recorded_at), ...r.data })), nextCursor: rows.length ? String(rows[rows.length - 1].id) : after };
  },
};
