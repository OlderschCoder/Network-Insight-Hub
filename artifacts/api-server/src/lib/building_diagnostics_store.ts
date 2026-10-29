import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { chooseCandidates, chooseLibreSpeedBuildingSample, diagnosticsReadiness, externalProbeConfig, fresh, JOB_MS, libreSpeedConfig, libreSpeedScheduleSlot, newToken, ONLINE_MS, PING_COUNT, QUICK_BYTES, resolveLocation, resolvePortTelemetry, schedulerSettings, SUSTAINED_OBJECT_BYTES, TARGET_LABEL, tokenHash, TRANSFER_BYTES, MIN_ROTATION_MINUTES, MAX_ROTATION_MINUTES, type Assignment, type CollectorStatus, type Heartbeat, type JobType, type Observation, type QueueInput, type SchedulerInput } from "./building_diagnostics";
import { diagnosticsBuildingName } from "./building_diagnostics_catalog";

export class DiagnosticsError extends Error { constructor(public status: number, message: string) { super(message); } }
type Client = Pick<typeof pool, "query">;
export type DirectoryFacts = { distinguishedName: string; canonicalName: string; location: string | null; observedAt?: string; memberOf: { objectGuid: string; name: string; distinguishedName: string }[]; organizationalUnits?: { objectGuid: string; name: string; distinguishedName: string }[] };
export type Inventory = { adObservedAt: string; adComputers: { adObjectGuid: string; computerName: string; domain: string; enabled: boolean; directory?: DirectoryFacts }[]; observations: Observation[]; userBuildingAssignments: Assignment[]; collectorStatus?: CollectorStatus };
type AdInventory = Pick<Inventory, "adObservedAt" | "adComputers">;
export function mergeDirectoryFacts(data: AdInventory, previous: Inventory, now = Date.now()) {
  const old = new Map(previous.adComputers.map(computer => [computer.adObjectGuid.toLowerCase(), computer]));
  return data.adComputers.map(computer => {
    const existing = old.get(computer.adObjectGuid.toLowerCase());
    const retained = computer.directory === undefined && existing?.directory && computer.computerName.toLowerCase() === existing.computerName.toLowerCase() && computer.domain.toLowerCase() === existing.domain.toLowerCase() && computer.enabled === existing.enabled;
    const directory = computer.directory ?? (retained ? existing!.directory : undefined);
    // Omitted fields in a legacy roster cannot renew independently observed facts.
    const observedAt = directory?.observedAt ?? (computer.directory ? data.adObservedAt : previous.adObservedAt);
    if (directory && fresh(observedAt, now, 24 * 60 * 60_000)) return { ...computer, directory: { ...directory, observedAt } };
    const { directory: _directory, ...withoutFacts } = computer;
    return withoutFacts;
  });
}
let schemaReady: Promise<unknown> | undefined;
export function ensureDiagnosticsSchema() {
  // Lazy, separate schema: normal Fred startup is unchanged while the feature is disabled.
  return schemaReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS building_diagnostics_inventory (id integer PRIMARY KEY CHECK(id=1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), last_scheduler_at timestamptz);
    CREATE TABLE IF NOT EXISTS building_diagnostics_settings (
      id integer PRIMARY KEY CHECK(id=1), scheduler_armed boolean NOT NULL DEFAULT false,
      rotation_interval_minutes integer NOT NULL DEFAULT 360 CHECK(rotation_interval_minutes BETWEEN 60 AND 1440),
      revision integer NOT NULL DEFAULT 0, updated_at timestamptz, updated_by text, worker_last_seen_at timestamptz);
    INSERT INTO building_diagnostics_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
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
    ALTER TABLE building_diagnostics_jobs ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'fred';
    ALTER TABLE building_diagnostics_jobs ADD COLUMN IF NOT EXISTS target_origin text;
    ALTER TABLE building_diagnostics_jobs ADD COLUMN IF NOT EXISTS timeout_seconds integer NOT NULL DEFAULT 30;
    ALTER TABLE building_diagnostics_jobs ADD COLUMN IF NOT EXISTS scheduled_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE building_diagnostics_jobs ADD COLUMN IF NOT EXISTS cancelled_reason text;
    ALTER TABLE building_diagnostics_jobs ADD COLUMN IF NOT EXISTS automatic boolean NOT NULL DEFAULT false;
    ALTER TABLE building_diagnostics_jobs ADD COLUMN IF NOT EXISTS scheduler_revision integer;
    ALTER TABLE building_diagnostics_inventory ADD COLUMN IF NOT EXISTS last_librespeed_scheduler_at timestamptz;
    ALTER TABLE building_diagnostics_inventory ADD COLUMN IF NOT EXISTS last_librespeed_slot text;
    ALTER TABLE building_diagnostics_jobs DROP CONSTRAINT IF EXISTS building_diagnostics_jobs_status_check;
    ALTER TABLE building_diagnostics_jobs ADD CONSTRAINT building_diagnostics_jobs_status_check CHECK(status IN ('queued','running','complete','expired','cancelled'));
    CREATE INDEX IF NOT EXISTS building_diagnostics_jobs_device ON building_diagnostics_jobs(device_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS building_diagnostics_reports (
      id bigserial PRIMARY KEY, job_id uuid NOT NULL UNIQUE REFERENCES building_diagnostics_jobs(id),
      device_id uuid NOT NULL REFERENCES building_diagnostics_devices(id), building text,
      recorded_at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL);
    CREATE INDEX IF NOT EXISTS building_diagnostics_reports_building ON building_diagnostics_reports(building,recorded_at DESC);
    CREATE INDEX IF NOT EXISTS building_diagnostics_reports_device ON building_diagnostics_reports(device_id,id DESC);
    CREATE TABLE IF NOT EXISTS building_diagnostics_audit (
      id bigserial PRIMARY KEY,device_id uuid REFERENCES building_diagnostics_devices(id),
      action text NOT NULL,actor text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE building_diagnostics_audit ALTER COLUMN device_id DROP NOT NULL;
    ALTER TABLE building_diagnostics_audit ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES building_diagnostics_jobs(id);
    ALTER TABLE building_diagnostics_audit ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
    CREATE TABLE IF NOT EXISTS building_diagnostics_building_assignments (
      ad_object_guid uuid PRIMARY KEY, building text NOT NULL, reason text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
      updated_by_user_id integer NOT NULL, updated_by_entra_object_id uuid NOT NULL);
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
async function readSettings(client: Client = pool) {
  const row = (await client.query("SELECT * FROM building_diagnostics_settings WHERE id=1")).rows[0];
  return { settings: schedulerSettings(row), workerLastSeenAt: iso(row?.worker_last_seen_at) };
}
function validateAdSnapshot(data: AdInventory, previous: Inventory) {
  if (!data.adComputers.length || data.adComputers.length > 30_000) throw new DiagnosticsError(400, "A nonempty complete AD roster is required");
  if (new Set(data.adComputers.map((a) => a.adObjectGuid.toLowerCase())).size !== data.adComputers.length) throw new DiagnosticsError(400, "Duplicate AD object identity");
  if (Date.parse(data.adObservedAt) > Date.now() + 30_000 || Date.parse(data.adObservedAt) < Date.parse(previous.adObservedAt || "1970-01-01")) throw new DiagnosticsError(409, "AD snapshot timestamp is future or older than current inventory");
  if (!fresh(data.adObservedAt, Date.now(), 24 * 60 * 60_000)) throw new DiagnosticsError(409, "AD snapshot must be a complete export within the last 24 hours");
}
async function fenceAutomatic(client: Client, settings: ReturnType<typeof schedulerSettings>) {
  // Persisted revision + deployment gate are rechecked under the same lease lock.
  // A restart or a stale API caller cannot dispatch a previously armed schedule.
  await client.query(`UPDATE building_diagnostics_jobs SET status='cancelled',cancelled_reason='Automatic schedule is disarmed or superseded'
    WHERE automatic AND status IN ('queued','running') AND (NOT $1::boolean OR scheduler_revision IS DISTINCT FROM $2)`, [settings.effectiveSchedulerEnabled, settings.revision]);
}
const indexes = new WeakMap<Inventory, { ad: Map<string, Inventory["adComputers"][number]>; macs: Map<string, Observation[]>; aps: Map<string, Observation[]>; users: Map<string, Assignment[]> }>();
function getIndexes(inv: Inventory) {
  let result = indexes.get(inv);
  if (result) return result;
  result = { ad: new Map(inv.adComputers.map((a) => [a.adObjectGuid.toLowerCase(), a])), macs: new Map(), aps: new Map(), users: new Map() };
  for (const o of inv.observations) {
    // A private controller may attest client MAC -> BSSID -> AP without Windows
    // location permission. Endpoints still cannot supply location observations.
    if (o.mac) { const key = o.mac.replace(/[^a-f0-9]/gi, "").toLowerCase(); result.macs.set(key, [...(result.macs.get(key) ?? []), o]); }
    if (o.source === "wifi" && o.bssid) { const key = o.bssid.replace(/[^a-f0-9]/gi, "").toLowerCase(); result.aps.set(key, [...(result.aps.get(key) ?? []), o]); }
  }
  for (const a of inv.userBuildingAssignments) { const key = a.username.trim().toLowerCase(); result.users.set(key, [...(result.users.get(key) ?? []), a]); }
  indexes.set(inv, result); return result;
}
function adMatch(inv: Inventory, d: any) {
  const a = getIndexes(inv).ad.get(d.ad_object_guid.toLowerCase());
  return !!a?.enabled && a.computerName.toLowerCase() === d.computer_name.toLowerCase() && a.domain.toLowerCase() === d.domain.toLowerCase();
}
function directoryFor(inv: Inventory, adObjectGuid: string) {
  const directory = getIndexes(inv).ad.get(adObjectGuid.toLowerCase())?.directory;
  // Directory classifications remain separate from observed physical location.
  const observedAt = directory?.observedAt ?? inv.adObservedAt;
  return directory && fresh(observedAt, Date.now(), 24 * 60 * 60_000) ? { ...directory, source: "active-directory" as const, observedAt } : null;
}
function locationFor(heartbeat: Heartbeat, inv: Inventory) {
  const index = getIndexes(inv), observations: Observation[] = [];
  for (const i of heartbeat.interfaces) { observations.push(...(index.macs.get(i.mac.replace(/[^a-f0-9]/gi, "").toLowerCase()) ?? [])); if (i.bssid) observations.push(...(index.aps.get(i.bssid.replace(/[^a-f0-9]/gi, "").toLowerCase()) ?? [])); }
  return resolveLocation(heartbeat, observations, index.users.get(heartbeat.loggedOnUser?.trim().toLowerCase() ?? "") ?? []);
}
async function snapshot(client: Client = pool) {
  const inv = await inventory(client);
  const assignmentRows = (await client.query("SELECT ad_object_guid,building,updated_at FROM building_diagnostics_building_assignments")).rows;
  const assignments = new Map(assignmentRows.map((row) => [String(row.ad_object_guid).toLowerCase(), { building: String(row.building), observedAt: iso(row.updated_at) }]));
  const devices = (await client.query(`SELECT d.*,r.id AS report_id,r.recorded_at,r.data AS report_data,
    (SELECT max(created_at) FROM building_diagnostics_jobs j WHERE j.device_id=d.id) AS last_test_at
    FROM building_diagnostics_devices d LEFT JOIN LATERAL (SELECT * FROM building_diagnostics_reports WHERE device_id=d.id ORDER BY id DESC LIMIT 1) r ON true ORDER BY d.computer_name`)).rows;
  const enrolled = devices.map((d) => {
    const heartbeat = d.heartbeat ?? { interfaces: [] };
    const currentHeartbeat = fresh(iso(d.last_check_in), Date.now(), ONLINE_MS);
    let location = locationFor(heartbeat, inv);
    if (!currentHeartbeat && location.kind === "network-confirmed") location.kind = "stale";
    const assigned = assignments.get(String(d.ad_object_guid).toLowerCase());
    if (assigned && location.kind !== "network-confirmed") location = { building: assigned.building, kind: "assigned", source: "manual", observedAt: assigned.observedAt };
    return { deviceId: d.id as string | null, enrolled: true, revoked: !!d.revoked_at, computerName: d.computer_name, adObjectGuid: d.ad_object_guid, adDomain: d.domain,
      adEnabled: inv.adObservedAt ? getIndexes(inv).ad.get(d.ad_object_guid.toLowerCase())?.enabled ?? false : null,
      adVerified: adMatch(inv, d) && fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000), online: currentHeartbeat && !d.revoked_at,
      lastCheckIn: iso(d.last_check_in), agentVersion: heartbeat.agentVersion ?? null,
      loggedOnUser: heartbeat.loggedOnUser ?? null, interfaces: heartbeat.interfaces, location,
      directory: directoryFor(inv, d.ad_object_guid),
      capabilities: heartbeat.capabilities ?? [],
      portTelemetry: currentHeartbeat ? resolvePortTelemetry(heartbeat, inv.observations) : null,
      lastTestAt: iso(d.last_test_at), lastResult: d.report_id ? { id: String(d.report_id), recordedAt: iso(d.recorded_at), ...d.report_data } : null };
  });
  const enrolledIds = new Set(enrolled.map((d) => d.adObjectGuid.toLowerCase()));
  for (const a of inv.adComputers) {
    if (enrolledIds.has(a.adObjectGuid.toLowerCase())) continue;
    const assigned = assignments.get(a.adObjectGuid.toLowerCase());
    enrolled.push({ deviceId: null, enrolled: false, revoked: false, computerName: a.computerName, adObjectGuid: a.adObjectGuid, adDomain: a.domain,
      adEnabled: a.enabled,
      adVerified: a.enabled && fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000), online: false,
      lastCheckIn: null, agentVersion: null, loggedOnUser: null, interfaces: [],
      capabilities: [],
      directory: directoryFor(inv, a.adObjectGuid),
      portTelemetry: null,
      location: assigned ? { building: assigned.building, kind: "assigned", source: "manual", observedAt: assigned.observedAt } : { building: null, kind: "unknown", source: null, observedAt: null }, lastTestAt: null, lastResult: null });
  }
  return { inv, devices: enrolled };
}
async function expire(client: Client) {
  await client.query("UPDATE building_diagnostics_jobs SET status='expired' WHERE status IN ('queued','running','cancelled') AND expires_at<=now()");
}
export const diagnosticsStore = {
  async settings() {
    await ensureDiagnosticsSchema();
    return (await readSettings()).settings;
  },
  async saveSettings(input: SchedulerInput, actor: string) {
    if (typeof input.schedulerArmed !== "boolean" || !Number.isInteger(input.rotationIntervalMinutes) || input.rotationIntervalMinutes < MIN_ROTATION_MINUTES || input.rotationIntervalMinutes > MAX_ROTATION_MINUTES) throw new DiagnosticsError(400, "Invalid scheduler settings");
    await ensureDiagnosticsSchema();
    return transaction(async (client) => {
      const row = (await client.query("UPDATE building_diagnostics_settings SET scheduler_armed=$1,rotation_interval_minutes=$2,revision=revision+1,updated_at=now(),updated_by=$3 WHERE id=1 RETURNING *", [input.schedulerArmed, input.rotationIntervalMinutes, actor])).rows[0];
      const settings = schedulerSettings(row);
      await fenceAutomatic(client, settings);
      await client.query("INSERT INTO building_diagnostics_audit(device_id,action,actor,reason,details) VALUES(NULL,'scheduler-settings',$1,'Operator saved automatic Fred-path rotation settings',$2::jsonb)", [actor, JSON.stringify({ ...input, revision: settings.revision })]);
      return settings;
    });
  },
  async workerSeen() {
    await ensureDiagnosticsSchema();
    await pool.query("UPDATE building_diagnostics_settings SET worker_last_seen_at=now() WHERE id=1");
  },
  async adInventory() {
    await ensureDiagnosticsSchema();
    const inv = await inventory();
    return { snapshotComplete: !!inv.adObservedAt && inv.adComputers.length > 0, adObservedAt: inv.adObservedAt || null, adComputers: mergeDirectoryFacts(inv, inv), fresh: fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000) };
  },
  async ingestAd(data: AdInventory) {
    await ensureDiagnosticsSchema();
    await transaction(async (client) => {
      const previous = await inventory(client);
      validateAdSnapshot(data, previous);
      // Share the full-inventory transaction lock. A concurrent private SNMP join
      // cannot be erased by an AD-only exporter, nor roll this directory back.
      const merged: Inventory = { ...data, adComputers: mergeDirectoryFacts(data, previous), observations: previous.observations, userBuildingAssignments: previous.userBuildingAssignments,
        ...(previous.collectorStatus ? { collectorStatus: previous.collectorStatus } : {}) };
      await client.query("INSERT INTO building_diagnostics_inventory(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=$1,updated_at=now()", [JSON.stringify(merged)]);
    });
    inventoryCache = undefined;
    return { ok: true, adComputers: data.adComputers.length, adObservedAt: data.adObservedAt };
  },
  async ingest(data: Inventory) {
    await ensureDiagnosticsSchema();
    await transaction(async (client) => {
      const previous = await inventory(client);
      validateAdSnapshot(data, previous);
      if (data.collectorStatus && Date.parse(data.collectorStatus.observedAt) > Date.now() + 30_000) throw new DiagnosticsError(409, "Collector observation cannot be in the future");
      if (data.observations.some((o) => Date.parse(o.observedAt) > Date.now() + 30_000 || (o.portTelemetry && Date.parse(o.portTelemetry.observedAt) > Date.now() + 30_000))) throw new DiagnosticsError(409, "Network observation cannot be in the future");
      const adComputers = mergeDirectoryFacts(data, previous);
      await client.query("INSERT INTO building_diagnostics_inventory(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=$1,updated_at=now()", [JSON.stringify({ ...data, adComputers })]);
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
      return { deviceId, deviceToken, computerName: input.computerName, domain: input.domain };
    });
  },
  async revoke(deviceId: string, reason: string, actor: string) {
    await ensureDiagnosticsSchema();
    return transaction(async (client) => {
      const result = await client.query("UPDATE building_diagnostics_devices SET revoked_at=now(),revoked_by=$2,revoked_reason=$3 WHERE id=$1 RETURNING id", [deviceId, actor, reason]);
      if (!result.rowCount) throw new DiagnosticsError(404, "Unknown diagnostics device");
      await client.query("UPDATE building_diagnostics_jobs SET status=CASE WHEN status='running' THEN 'cancelled' ELSE 'expired' END WHERE device_id=$1 AND status IN ('queued','running')", [deviceId]);
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
      await client.query("UPDATE building_diagnostics_jobs SET status=CASE WHEN status='running' THEN 'cancelled' ELSE 'expired' END WHERE device_id=$1 AND status IN ('queued','running')", [deviceId]);
      await client.query("INSERT INTO building_diagnostics_audit(device_id,action,actor,reason) VALUES($1,'rotate',$2,$3)", [deviceId, actor, reason]);
      return { deviceId, deviceToken, computerName: adObject.computerName, domain: adObject.domain };
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
    const jobs = (await pool.query(`SELECT j.*,d.computer_name FROM building_diagnostics_jobs j JOIN building_diagnostics_devices d ON d.id=j.device_id ORDER BY j.created_at DESC LIMIT 100`)).rows.map((j) => ({ id: j.id, deviceId: j.device_id, computerName: j.computer_name, building: j.building, status: j.status, type: j.type, automatic: j.automatic, targetOrigin: j.target_origin, downloadBytes: j.download_bytes, scheduledAt: iso(j.scheduled_at), createdAt: iso(j.created_at), expiresAt: iso(j.expires_at), requestedBy: j.requested_by }));
    // Buildings with no enrolled endpoint must remain visible as missing coverage.
    const catalog = (await pool.query("SELECT DISTINCT trim(building) AS building FROM net_nodes WHERE trim(building)<>''")).rows;
    const allBuildings = new Set([...catalog.map((b) => String(b.building)), ...inv.observations.map((o) => o.building), ...inv.userBuildingAssignments.map((a) => a.building)]
      .map(diagnosticsBuildingName).filter((building): building is string => !!building));
    const recent = (await pool.query("SELECT DISTINCT ON(building) building,id,recorded_at,data FROM building_diagnostics_reports WHERE building IS NOT NULL ORDER BY building,id DESC")).rows;
    const buildings = [...allBuildings].sort().map((building) => {
      const members = devices.filter((d) => diagnosticsBuildingName(d.location.building) === building);
      const r = recent.filter((row) => diagnosticsBuildingName(row.building) === building)
        .sort((a, b) => Number(b.id) - Number(a.id))[0];
      const interfaces = Array.isArray(r?.data?.libreSpeed?.measurements) ? r.data.libreSpeed.measurements : [];
      const representative = interfaces.find((item: any) => item.adapterKind === "ethernet") ?? interfaces[0];
      const lastResult = r ? { id: String(r.id), recordedAt: iso(r.recorded_at), ...r.data,
        ...(representative ? { downloadMbps: representative.downloadMbps, uploadMbps: representative.uploadMbps,
          latencyMs: representative.pingMs, jitterMs: representative.jitterMs, requestLossPercent: null } : {}) } : null;
      const validLibre = interfaces.length > 0 && interfaces.every((item: any) => item.transferClosed === true && Number.isFinite(item.downloadMbps) && Number.isFinite(item.uploadMbps));
      const validLegacy = !!r && r.data.downloadMbps !== null && (r.data.external || r.data.uploadMbps !== null);
      return { building, onlineDevices: members.filter((d) => d.online).length,
        eligibleDevices: members.filter((d) => d.adEnabled === true).length,
        readyDevices: members.filter((d) => d.adEnabled === true && d.enrolled && !d.revoked && d.online && d.adVerified && d.capabilities.includes("librespeed-v2")).length,
        lastResult, noCurrentMeasurement: !r || !!r.data.error || (!validLibre && !validLegacy) || !fresh(iso(r.recorded_at), Date.now(), 12 * 60 * 60_000) };
    });
    const { settings, workerLastSeenAt } = await readSettings();
    const audit = (await pool.query(`SELECT a.*,d.computer_name FROM building_diagnostics_audit a LEFT JOIN building_diagnostics_devices d ON d.id=a.device_id ORDER BY a.id DESC LIMIT 50`)).rows.map((a) => ({ id: String(a.id), deviceId: a.device_id, jobId: a.job_id, computerName: a.computer_name ?? null, action: a.action, actor: a.actor, reason: a.reason, details: a.details, createdAt: iso(a.created_at) }));
    return { devices, buildings, jobs, settings, readiness: diagnosticsReadiness({ inventory: inv, devices, workerLastSeenAt }), audit,
      inventoryUpdatedAt: inv.updatedAt, adObservedAt: inv.adObservedAt || null, targetLabel: TARGET_LABEL, externalProbe: externalProbeConfig() };
  },
  async queue(input: QueueInput, actor: string, automatic = false) {
    await ensureDiagnosticsSchema();
    const type: JobType = input.type ?? "fred", config = externalProbeConfig(), libreConfig = libreSpeedConfig();
    const libre = type === "librespeed-v2";
    const external = type === "external-quick" || type === "external-sustained";
    const sustained = type === "external-sustained";
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
    if (!Number.isFinite(scheduledAt.getTime()) || (input.scheduledAt && (scheduledAt.getTime() < Date.now() || scheduledAt.getTime() > Date.now() + 24 * 60 * 60_000))) throw new DiagnosticsError(400, "Schedule must be within the next 24 hours");
    if (external && (automatic || !config.origin || !input.deviceIds?.length || input.building)) throw new DiagnosticsError(409, "Static external tests require a configured probe and explicitly selected computers");
    if (libre && !automatic && !input.deviceIds?.length) throw new DiagnosticsError(409, "LibreSpeed tests require explicitly selected computers");
    if (libre && !libreConfig.enabled) {
      if (automatic) return { queued: 0, jobIds: [] };
      throw new DiagnosticsError(409, "LibreSpeed V2 is staged but not enabled on this server");
    }
    if (libre && !automatic && input.deviceIds!.length > libreConfig.canaryMax) throw new DiagnosticsError(409, `LibreSpeed V2 canary is limited to ${libreConfig.canaryMax} computers`);
    if (sustained && (!config.sustainedEnabled || input.sustainedConfirmed !== true || input.deviceIds?.length !== 1 || !input.scheduledAt || scheduledAt.getTime() < Date.now() + 60_000)) throw new DiagnosticsError(409, "Sustained test requires enablement, one selected computer, explicit confirmation and a schedule at least one minute ahead");
    const bytes = libre ? 0 : type === "fred" ? TRANSFER_BYTES : sustained ? (input.maxBytes ?? 64 * 1024 * 1024) : QUICK_BYTES;
    if ((!libre && (!Number.isSafeInteger(bytes) || bytes < QUICK_BYTES || bytes > SUSTAINED_OBJECT_BYTES)) || (input.maxBytes !== undefined && !sustained)) throw new DiagnosticsError(400, "Invalid external byte budget");
    const timeout = libre ? 180 : sustained ? 180 : 30;
    return transaction(async (client) => {
      await expire(client);
      const { settings } = await readSettings(client);
      if (automatic) {
        if (!settings.effectiveSchedulerEnabled) return { queued: 0, jobIds: [] };
        await fenceAutomatic(client, settings);
        const slot = libre ? libreSpeedScheduleSlot() : null;
        if (libre && !slot) return { queued: 0, jobIds: [] };
        const sweep = libre
          ? await client.query("UPDATE building_diagnostics_inventory SET last_librespeed_scheduler_at=now(),last_librespeed_slot=$1 WHERE id=1 AND last_librespeed_slot IS DISTINCT FROM $1 RETURNING id", [slot])
          : await client.query("UPDATE building_diagnostics_inventory SET last_scheduler_at=now() WHERE id=1 AND (last_scheduler_at IS NULL OR last_scheduler_at<now()-interval '1 minute') RETURNING id");
        if (!sweep.rowCount) return { queued: 0, jobIds: [] };
      }
      const { devices } = await snapshot(client);
      const recent = (await client.query("SELECT building,max(created_at) AS tested_at FROM building_diagnostics_jobs WHERE building IS NOT NULL AND status IN ('running','complete') GROUP BY building")).rows;
      const enrolled = devices.filter((d) => !!d.deviceId).map((d) => ({ ...d, deviceId: d.deviceId! }));
      if (!automatic && input.deviceIds && (new Set(input.deviceIds).size !== input.deviceIds.length || input.deviceIds.some((id) => !enrolled.some((d) => d.deviceId === id && d.online && d.adVerified)))) throw new DiagnosticsError(409, "Every selected computer must be enrolled, online and AD verified");
      let selected = automatic
        ? libre
          ? chooseLibreSpeedBuildingSample(enrolled)
          : chooseCandidates(enrolled, new Map(recent.map((r) => [r.building, new Date(r.tested_at).getTime()])), Date.now(), settings.rotationIntervalMinutes * 60_000)
        : enrolled.filter((d) => (input.deviceIds?.includes(d.deviceId) || (input.building && d.location.kind === "network-confirmed" && d.location.building === input.building)) && d.online && d.adVerified);
      if (external && selected.some((d) => !d.capabilities.includes("external-probe-v2"))) throw new DiagnosticsError(409, "Selected computer does not support external probe jobs");
      if (libre && selected.some((d) => !d.capabilities.includes("librespeed-v2"))) throw new DiagnosticsError(409, "Selected computer does not support LibreSpeed V2 jobs");
      if (libre && selected.length) {
        const recentLibre = (await client.query("SELECT DISTINCT device_id FROM building_diagnostics_jobs WHERE type='librespeed-v2' AND status IN ('queued','running','complete') AND created_at>now()-interval '110 minutes'")).rows;
        const recentIds = new Set(recentLibre.map((row) => row.device_id));
        selected = selected.filter((d) => !recentIds.has(d.deviceId));
      }
      const pending = (await client.query("SELECT device_id,building FROM building_diagnostics_jobs WHERE status IN ('queued','running')")).rows;
      selected = selected.filter((d) => !pending.some((p) => p.device_id === d.deviceId || (automatic && !libre && p.building === d.location.building))).slice(0, Math.max(0, (automatic && libre ? 250 : 100) - pending.length));
      if (external && selected.length) {
        // Reserve against the execution window, including cancellations. The
        // symmetric window is deliberately conservative for future schedules.
        const used = (await client.query("SELECT coalesce(sum(download_bytes),0) AS bytes FROM building_diagnostics_jobs WHERE type IN ('external-quick','external-sustained') AND ((scheduled_at>$1::timestamptz-interval '24 hours' AND scheduled_at<$1::timestamptz+interval '24 hours') OR claimed_at>now()-interval '24 hours')", [scheduledAt.toISOString()])).rows[0];
        if (Number(used.bytes) + bytes * selected.length > config.dailyBudgetBytes) throw new DiagnosticsError(429, "External tests exceed the rolling 24-hour data budget");
        const interval = sustained ? "24 hours" : "15 minutes";
        if ((await client.query(`SELECT id FROM building_diagnostics_jobs WHERE device_id=ANY($1::uuid[]) AND type=$2 AND (created_at>now()-interval '${interval}' OR claimed_at>$3::timestamptz-interval '${interval}' OR (scheduled_at>$3::timestamptz-interval '${interval}' AND scheduled_at<$3::timestamptz+interval '${interval}')) LIMIT 1`, [selected.map((d) => d.deviceId), type, scheduledAt.toISOString()])).rowCount) throw new DiagnosticsError(429, "Selected computer was already scheduled within the external test frequency limit");
      }
      const ids: string[] = [];
      for (let i = 0; i < selected.length; i++) {
        const d = selected[i]!, id = randomUUID();
        // Queue lifetime allows serial execution; each claim receives a new two-minute lease.
        const building = d.location.building ?? null;
        const targetOrigin = libre ? libreConfig.origin : external ? config.origin : null;
        const queueLifetimeMinutes = automatic && libre ? 110 : 30;
        await client.query("INSERT INTO building_diagnostics_jobs(id,device_id,building,status,requested_by,expires_at,download_bytes,upload_bytes,type,target_origin,timeout_seconds,scheduled_at,automatic,scheduler_revision) VALUES($1,$2,$3,'queued',$4,$5::timestamptz+($13::text||' minutes')::interval,$6,$7,$8,$9,$10,$5,$11,$12)", [id, d.deviceId, building, actor, scheduledAt.toISOString(), bytes, external ? 0 : bytes, type, targetOrigin, timeout, automatic, automatic ? settings.revision : null, queueLifetimeMinutes]);
        await client.query("INSERT INTO building_diagnostics_audit(device_id,job_id,action,actor,reason,details) VALUES($1,$2,'queue-job',$3,$4,$5::jsonb)", [d.deviceId, id, actor, automatic ? (libre ? "Automatic daytime two-hour LibreSpeed rotation" : "Automatic building rotation") : "Operator requested a bounded measurement", JSON.stringify({ type, automatic, building, downloadBytes: bytes, uploadBytes: external ? 0 : bytes, scheduledAt: scheduledAt.toISOString() })]);
        ids.push(id);
      }
      return { queued: ids.length, jobIds: ids };
    });
  },
  async checkIn(input: Heartbeat, auto: { legacySchedulerEnabled: boolean; libreSpeedSchedulerEnabled: boolean } | boolean) {
    await pool.query("UPDATE building_diagnostics_devices SET heartbeat=$2,last_check_in=now() WHERE id=$1", [input.deviceId, JSON.stringify(input)]);
    const legacySchedulerEnabled = typeof auto === "boolean" ? auto : auto.legacySchedulerEnabled;
    const libreSpeedSchedulerEnabled = typeof auto === "boolean" ? false : auto.libreSpeedSchedulerEnabled;
    if (legacySchedulerEnabled) await this.queue({}, "automatic building rotation", true);
    if (libreSpeedSchedulerEnabled) await this.queue({ type: "librespeed-v2" }, "automatic daytime two-hour LibreSpeed rotation", true);
    return transaction(async (client) => {
      await expire(client);
      await fenceAutomatic(client, (await readSettings(client)).settings);
      const j = (await client.query("SELECT * FROM building_diagnostics_jobs WHERE device_id=$1 AND status='queued' AND scheduled_at<=now() AND (type='fred' OR (type IN ('external-quick','external-sustained') AND $2::boolean) OR (type='librespeed-v2' AND $3::boolean)) ORDER BY created_at LIMIT 1 FOR UPDATE", [input.deviceId, input.capabilities?.includes("external-probe-v2") ?? false, input.capabilities?.includes("librespeed-v2") ?? false])).rows[0];
      if (!j) return null;
      const libre = j.type === "librespeed-v2", libreConfig = libreSpeedConfig();
      if (libre) {
        if (!libreConfig.enabled) return null;
        if ((await client.query("SELECT id FROM building_diagnostics_jobs WHERE type<>'librespeed-v2' AND (status='running' OR (status='cancelled' AND claimed_at IS NOT NULL AND expires_at>now())) LIMIT 1")).rowCount) return null;
        const active = Number((await client.query("SELECT count(*) AS n FROM building_diagnostics_jobs WHERE type='librespeed-v2' AND status='running' AND expires_at>now()")).rows[0].n);
        if (active >= libreConfig.maxConcurrent) return null;
      } else {
        // Legacy measurements stay serialized and never overlap a capacity test.
        if ((await client.query("SELECT id FROM building_diagnostics_jobs WHERE status='running' OR (status='cancelled' AND claimed_at IS NOT NULL AND expires_at>now()) LIMIT 1")).rowCount) return null;
        if ((await client.query("SELECT id FROM building_diagnostics_reports WHERE recorded_at>now()-interval '30 seconds' LIMIT 1")).rowCount) return null;
      }
      const { inv, devices } = await snapshot(client), current = devices.find((d) => d.deviceId === input.deviceId);
      const locationMismatch = j.building !== null && (current?.location.building !== j.building || (!libre && current?.location.kind !== "network-confirmed"));
      if (!fresh(inv.adObservedAt, Date.now(), 24 * 60 * 60_000) || !current?.adVerified || locationMismatch) {
        await client.query("UPDATE building_diagnostics_jobs SET status='expired' WHERE id=$1", [j.id]); return null;
      }
      const config = externalProbeConfig();
      if (libre && j.target_origin !== libreConfig.origin) { await client.query("UPDATE building_diagnostics_jobs SET status='expired' WHERE id=$1", [j.id]); return null; }
      if (!libre && j.type !== "fred" && (j.target_origin !== config.origin || (j.type === "external-sustained" && !config.sustainedEnabled))) { await client.query("UPDATE building_diagnostics_jobs SET status='expired' WHERE id=$1", [j.id]); return null; }
      if (!libre && j.type !== "fred") {
        const used = (await client.query("SELECT coalesce(sum(download_bytes),0) AS bytes FROM building_diagnostics_jobs WHERE type IN ('external-quick','external-sustained') AND claimed_at>now()-interval '24 hours'")).rows[0];
        if (Number(used.bytes) + j.download_bytes > config.dailyBudgetBytes) return null;
        const interval = j.type === "external-sustained" ? "24 hours" : "15 minutes";
        if ((await client.query(`SELECT id FROM building_diagnostics_jobs WHERE id<>$1 AND device_id=$2 AND type=$3 AND claimed_at>now()-interval '${interval}' LIMIT 1`, [j.id, input.deviceId, j.type])).rowCount) return null;
      }
      const expiresAt = new Date(Date.now() + (libre ? 4 * 60_000 : j.type === "external-sustained" ? 5 * 60_000 : JOB_MS)).toISOString();
      await client.query("UPDATE building_diagnostics_jobs SET status='running',claimed_at=now(),expires_at=$2 WHERE id=$1", [j.id, expiresAt]);
      return { id: j.id, expiresAt, downloadBytes: j.download_bytes, uploadBytes: j.upload_bytes, pingCount: j.type === "fred" ? PING_COUNT : 1, ...(j.type === "fred" ? {} : { proofVersion: 2, type: j.type as JobType, targetOrigin: j.target_origin, timeoutSeconds: j.timeout_seconds }) };
    });
  },
  async cancel(jobId: string, reason: string, actor: string) {
    await ensureDiagnosticsSchema();
    return transaction(async (client) => {
      const j = (await client.query("UPDATE building_diagnostics_jobs SET status='cancelled',cancelled_reason=$2 WHERE id=$1 AND status IN ('queued','running') RETURNING *", [jobId, reason])).rows[0];
      if (!j) throw new DiagnosticsError(409, "Job is unknown or already finished");
      await client.query("INSERT INTO building_diagnostics_audit(device_id,action,actor,reason) VALUES($1,'cancel-job',$2,$3)", [j.device_id, actor, `${jobId}: ${reason}`]);
      return { ok: true, id: jobId, status: "cancelled", leaseHeldUntil: j.claimed_at ? iso(j.expires_at) : null };
    });
  },
  async jobStatus(deviceId: string, jobId: string) {
    return transaction(async (client) => {
      await fenceAutomatic(client, (await readSettings(client)).settings);
      const j = (await client.query("SELECT id,status,expires_at FROM building_diagnostics_jobs WHERE id=$1 AND device_id=$2", [jobId, deviceId])).rows[0];
      if (!j) throw new DiagnosticsError(404, "Unknown device job");
      return { id: j.id, status: Date.parse(j.expires_at) <= Date.now() && ["running", "queued", "cancelled"].includes(j.status) ? "expired" : j.status, expiresAt: iso(j.expires_at) };
    });
  },
  async transfer(deviceId: string, jobId: string, kind: "ping" | "download" | "upload") {
    const column = kind === "ping" ? "ping_count=ping_count+1" : `${kind}_started_at=now()`;
    const condition = kind === "ping" ? `ping_count<${PING_COUNT}` : `${kind}_started_at IS NULL`;
    const remaining = kind === "ping" ? "now()" : "now()+interval '20 seconds'";
    const result = await transaction(async (client) => {
      await fenceAutomatic(client, (await readSettings(client)).settings);
      return client.query(`UPDATE building_diagnostics_jobs SET ${column} WHERE id=$1 AND device_id=$2 AND type='fred' AND status='running' AND expires_at>${remaining} AND ${condition} RETURNING download_bytes,upload_bytes`, [jobId, deviceId]);
    });
    if (!result.rows[0]) throw new DiagnosticsError(409, "Invalid, expired, or already used job operation");
    return { downloadBytes: result.rows[0].download_bytes, uploadBytes: result.rows[0].upload_bytes };
  },
  async transferReceipt(jobId: string, kind: "download" | "upload", bytes: number) {
    if (kind === "download") await pool.query("UPDATE building_diagnostics_jobs SET download_complete=true WHERE id=$1 AND status='running'", [jobId]);
    else await pool.query("UPDATE building_diagnostics_jobs SET upload_received_bytes=$2 WHERE id=$1 AND status='running'", [jobId, bytes]);
  },
  async result(deviceId: string, input: any) {
    return transaction(async (client) => {
      const j = (await client.query("SELECT * FROM building_diagnostics_jobs WHERE id=$1 AND device_id=$2 AND status IN ('running','cancelled') AND expires_at>now() FOR UPDATE", [input.jobId, deviceId])).rows[0];
      if (!j) throw new DiagnosticsError(409, "Invalid, expired, or already completed job");
      if (j.type === "librespeed-v2") {
        const measurement = input.libreSpeed, failure = input.error || (j.status === "cancelled" ? "cancelled" : null);
        if (input.external || input.downloadMbps !== undefined || input.uploadMbps !== undefined || (!measurement && !failure) || (measurement && (measurement.serverOrigin !== libreSpeedConfig().origin || measurement.serverId !== 92 || measurement.method !== "MultiStreamV2"))) throw new DiagnosticsError(409, "LibreSpeed result does not match its authorized job");
        const heartbeat = (await client.query("SELECT heartbeat FROM building_diagnostics_devices WHERE id=$1", [deviceId])).rows[0]?.heartbeat as Heartbeat | undefined;
        if (!heartbeat) throw new DiagnosticsError(409, "Current endpoint evidence is unavailable");
        for (const item of measurement?.measurements ?? []) {
          const match = heartbeat.interfaces.find((iface) => iface.kind === item.adapterKind && iface.mac.replace(/[^a-f0-9]/gi, "").toLowerCase() === item.mac.replace(/[^a-f0-9]/gi, "").toLowerCase() && iface.ipAddresses.includes(item.sourceIp));
          if (!match || (item.adapterKind === "wifi" && match.bssid && match.bssid.replace(/[^a-f0-9]/gi, "").toLowerCase() !== item.bssid.replace(/[^a-f0-9]/gi, "").toLowerCase())) throw new DiagnosticsError(409, "LibreSpeed source interface does not match the authenticated check-in");
        }
        if (failure && measurement) throw new DiagnosticsError(409, "Failed LibreSpeed jobs must not include successful measurements");
        const data = { type: j.type, error: failure, libreSpeed: measurement ?? null, targetLabel: "External LibreSpeed V2 path", provenance: "authenticated endpoint MultiStreamV2 measurement with source-interface and transfer-closure evidence; not a campus uplink certification" };
        const report = (await client.query("INSERT INTO building_diagnostics_reports(job_id,device_id,building,data) VALUES($1,$2,$3,$4) RETURNING id", [j.id, deviceId, j.building, JSON.stringify(data)])).rows[0];
        await client.query("UPDATE building_diagnostics_jobs SET status='complete' WHERE id=$1", [j.id]);
        return { ok: true, reportId: String(report.id) };
      }
      if (j.type !== "fred") {
        const e = input.external;
        const path = j.type === "external-quick" ? "/probe-5mb.bin" : "/probe-1gb.bin";
        const failure = e?.failure || input.error || (j.status === "cancelled" ? "cancelled" : null);
        if (!e || e.type !== j.type || e.targetOrigin !== j.target_origin || e.path !== path || !Number.isSafeInteger(e.bytesReceived) || e.bytesReceived < 0 || e.bytesReceived > j.download_bytes || !Number.isFinite(e.elapsedMs) || e.elapsedMs < 0 || e.elapsedMs > (j.timeout_seconds + 15) * 1000 || !fresh(e.timestamp, Date.now(), 10 * 60_000)) throw new DiagnosticsError(409, "External result does not match its authorized job");
        if (!failure && (e.bytesReceived !== j.download_bytes || e.elapsedMs <= 0 || ![200, 206].includes(e.httpStatus))) throw new DiagnosticsError(409, "Successful external result requires the complete bounded download");
        const mbps = e.elapsedMs > 0 ? Math.round(e.bytesReceived * 8 / (e.elapsedMs * 1000) * 1000) / 1000 : null;
        const external = { ...e, mbps, ...(failure ? { failure } : {}) };
        const data = { downloadMbps: failure ? null : mbps, uploadMbps: null, latencyMs: null, requestLossPercent: null, error: failure, downloadBytes: e.bytesReceived, uploadBytes: 0, type: j.type, external, targetLabel: `External HTTPS path (${j.target_origin})`, provenance: "authenticated endpoint external HTTPS measurement; no server-side transfer receipt; does not certify link capacity" };
        const report = (await client.query("INSERT INTO building_diagnostics_reports(job_id,device_id,building,data) VALUES($1,$2,$3,$4) RETURNING id", [j.id, deviceId, j.building, JSON.stringify(data)])).rows[0];
        await client.query("UPDATE building_diagnostics_jobs SET status='complete' WHERE id=$1", [j.id]);
        return { ok: true, reportId: String(report.id) };
      }
      if (input.external || input.libreSpeed) throw new DiagnosticsError(409, "Fred job cannot report an external measurement");
      if (j.status === "cancelled" && !input.error) throw new DiagnosticsError(409, "Cancelled job requires a cancellation result");
      if (!input.error && (!j.download_complete || j.upload_received_bytes !== j.upload_bytes || input.downloadBytes !== j.download_bytes || input.uploadBytes !== j.upload_bytes || input.requestLossPercent < (PING_COUNT - j.ping_count) * 100 / PING_COUNT)) throw new DiagnosticsError(409, "Server transfer receipts do not match this result");
      const data = { downloadMbps: input.error ? null : input.downloadMbps ?? null, uploadMbps: input.error ? null : input.uploadMbps ?? null, latencyMs: input.latencyMs ?? null, requestLossPercent: input.requestLossPercent ?? null, serverPingReceipts: j.ping_count, scheduledProbeCount: PING_COUNT, error: input.error ?? null, downloadBytes: input.downloadBytes ?? 0, uploadBytes: input.uploadBytes ?? 0, targetLabel: TARGET_LABEL, provenance: "authenticated endpoint measurement; server transfer receipts; not uplink capacity", requestLossKind: "HTTPS request failures" };
      const report = (await client.query("INSERT INTO building_diagnostics_reports(job_id,device_id,building,data) VALUES($1,$2,$3,$4) RETURNING id", [j.id, deviceId, j.building, JSON.stringify(data)])).rows[0];
      await client.query("UPDATE building_diagnostics_jobs SET status='complete' WHERE id=$1", [j.id]);
      return { ok: true, reportId: String(report.id) };
    });
  },
  async reports(after: string, limit: number) {
    await ensureDiagnosticsSchema();
    const rows = (await pool.query("SELECT r.*,d.computer_name,d.ad_object_guid,d.heartbeat->>'loggedOnUser' AS logged_on_user FROM building_diagnostics_reports r JOIN building_diagnostics_devices d ON d.id=r.device_id WHERE r.id>$1 ORDER BY r.id LIMIT $2", [after, limit])).rows;
    return { reports: rows.map((r) => ({ id: String(r.id), seq: String(r.id), jobId: r.job_id, deviceId: r.device_id, computerName: r.computer_name, adObjectGuid: r.ad_object_guid, building: r.building, ...(r.logged_on_user ? { user: r.logged_on_user } : {}), recordedAt: iso(r.recorded_at), ...r.data })), nextCursor: rows.length ? String(rows[rows.length - 1].id) : after };
  },
};
