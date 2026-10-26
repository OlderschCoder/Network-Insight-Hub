import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Opt-in, synthetic, disposable Postgres only. Never uses Fred's DATABASE_URL.
const connection = process.env.BUILDING_DIAGNOSTICS_TEST_DATABASE_URL;
const configured = !!connection;
if (connection) {
  const url = new URL(connection);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/diagnosticstest") throw new Error("Diagnostics tests require a localhost database named diagnosticstest");
}
vi.mock("@workspace/db", async () => {
  const { createRequire } = await import("node:module");
  const pg = createRequire(import.meta.url)("pg");
  return { pool: new pg.Pool({ connectionString: process.env.BUILDING_DIAGNOSTICS_TEST_DATABASE_URL ?? "postgresql://invalid@127.0.0.1:1/diagnosticstest", max: 4 }) };
});

describe.skipIf(!configured)("diagnostics Postgres leases and inventory", () => {
  let store: typeof import("./building_diagnostics_store").diagnosticsStore;
  let db: typeof import("@workspace/db").pool;
  const guidA = randomUUID(), guidB = randomUUID(), guidNeverEnrolled = randomUUID();
  let a: { deviceId: string; deviceToken: string }, b: { deviceId: string; deviceToken: string };
  let jobA: any, jobB: any;
  const adObservedAt = new Date().toISOString();
  const inventory = {
    adObservedAt,
    adComputers: [
      { adObjectGuid: guidA, computerName: "DIAG-A", domain: "sccc.edu", enabled: true },
      { adObjectGuid: guidB, computerName: "DIAG-B", domain: "sccc.edu", enabled: true },
      { adObjectGuid: guidNeverEnrolled, computerName: "DIAG-NOT-INSTALLED", domain: "sccc.edu", enabled: true },
    ],
    observations: [
      { mac: "00:11:22:33:44:55", building: "Synthetic A", switchName: "synthetic-edge-a", port: "1/1/2", source: "switch" as const, observedAt: adObservedAt, edge: true },
      { mac: "00:11:22:33:44:66", building: "Synthetic B", switchName: "synthetic-edge-b", port: "1/1/2", source: "switch" as const, observedAt: adObservedAt, edge: true },
    ],
    userBuildingAssignments: [],
  };
  const heartbeat = (identity: { deviceId: string }, name: string, mac: string) => ({ deviceId: identity.deviceId, computerName: name, adDomain: "sccc.edu", adJoined: true, uptimeSeconds: 10, agentVersion: "synthetic", interfaces: [{ mac, ipAddresses: ["127.0.0.1"], kind: "ethernet" as const }] });
  beforeAll(async () => {
    process.env.BUILDING_DIAGNOSTICS_ENABLED = "true";
    process.env.BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED = "true";
    db = (await import("@workspace/db")).pool;
    store = (await import("./building_diagnostics_store")).diagnosticsStore;
    // This explicitly named disposable test database is never shared with Fred.
    await db.query("DROP TABLE IF EXISTS building_diagnostics_audit,building_diagnostics_reports,building_diagnostics_jobs,building_diagnostics_devices,building_diagnostics_inventory,building_diagnostics_settings CASCADE");
    await db.query("CREATE TABLE IF NOT EXISTS net_nodes(building text NOT NULL)");
    await db.query("TRUNCATE net_nodes");
    await db.query("INSERT INTO net_nodes(building) VALUES('Synthetic A'),('Synthetic B'),('Synthetic empty building')");
    await store.ingest(inventory);
    a = await store.provision({ adObjectGuid: guidA, computerName: "DIAG-A", domain: "sccc.edu" }, "synthetic test");
    b = await store.provision({ adObjectGuid: guidB, computerName: "DIAG-B", domain: "sccc.edu" }, "synthetic test");
    await store.checkIn(heartbeat(a, "DIAG-A", "00:11:22:33:44:55"), false);
    await store.checkIn(heartbeat(b, "DIAG-B", "00:11:22:33:44:66"), false);
  });
  afterAll(async () => { await db?.end(); });
  it("shows all AD computers, with no invented check-in for an uninstalled computer", async () => {
    const overview = await store.overview();
    expect(overview.devices).toHaveLength(3);
    expect(overview.devices.find((d) => d.adObjectGuid === guidNeverEnrolled)).toMatchObject({ deviceId: null, enrolled: false, online: false, lastCheckIn: null, adVerified: true });
    expect(JSON.stringify(overview)).not.toContain(a.deviceToken);
    expect(overview.buildings.find((building) => building.building === "Synthetic empty building")).toMatchObject({ onlineDevices: 0, eligibleDevices: 0, lastResult: null, noCurrentMeasurement: true });
    expect(overview.settings).toMatchObject({ schedulerArmed: false, rotationIntervalMinutes: 360, effectiveSchedulerEnabled: false, persisted: true });
    expect(overview.readiness).toMatchObject({ counts: { inventory: 3, enrolled: 2, online: 2, adTrusted: 3 }, collector: { state: "unknown" }, worker: { state: "never-seen" } });
  });
  it("requires immutable AD identity and stores only a token hash", async () => {
    await expect(store.provision({ adObjectGuid: randomUUID(), computerName: "DIAG-A", domain: "sccc.edu" }, "test")).rejects.toThrow("current enabled AD roster");
    await expect(store.provision({ adObjectGuid: guidA, computerName: "DIAG-A", domain: "sccc.edu" }, "test")).rejects.toThrow("already provisioned");
    expect(await store.authenticate(a.deviceToken)).toMatchObject({ deviceId: a.deviceId });
    expect(await store.authenticate("sccc-device.alert-token")).toBeNull();
    const row = (await db.query("SELECT token_hash FROM building_diagnostics_devices WHERE id=$1", [a.deviceId])).rows[0];
    expect(row.token_hash).toHaveLength(64); expect(row.token_hash).not.toBe(a.deviceToken);
  });
  it("gives only one running lease under simultaneous computer check-ins", async () => {
    expect((await store.queue({ deviceIds: [a.deviceId, b.deviceId] }, "synthetic admin")).queued).toBe(2);
    const claims = await Promise.all([store.checkIn(heartbeat(a, "DIAG-A", "00:11:22:33:44:55"), false), store.checkIn(heartbeat(b, "DIAG-B", "00:11:22:33:44:66"), false)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    jobA = claims[0] ?? claims[1];
    const row = (await db.query("SELECT device_id FROM building_diagnostics_jobs WHERE id=$1", [jobA.id])).rows[0];
    if (row.device_id === b.deviceId) [a, b] = [b, a];
    expect((await db.query("SELECT count(*) FROM building_diagnostics_jobs WHERE status='running'")).rows[0].count).toBe("1");
  });
  it("rejects cross-device transfers, repeated operations, false receipts and replayed results", async () => {
    await expect(store.transfer(b.deviceId, jobA.id, "download")).rejects.toThrow("Invalid");
    await store.transfer(a.deviceId, jobA.id, "download");
    await expect(store.transfer(a.deviceId, jobA.id, "download")).rejects.toThrow("already used");
    await store.transfer(a.deviceId, jobA.id, "upload");
    await expect(store.result(a.deviceId, { jobId: jobA.id, downloadMbps: 10, uploadMbps: 10, requestLossPercent: 0, downloadBytes: jobA.downloadBytes, uploadBytes: jobA.uploadBytes })).rejects.toThrow("receipts");
    await store.transferReceipt(jobA.id, "download", jobA.downloadBytes);
    await store.transferReceipt(jobA.id, "upload", jobA.uploadBytes);
    for (let i = 0; i < 3; i++) await store.transfer(a.deviceId, jobA.id, "ping");
    const result = { jobId: jobA.id, downloadMbps: 10, uploadMbps: 8, latencyMs: 5, requestLossPercent: 40, downloadBytes: jobA.downloadBytes, uploadBytes: jobA.uploadBytes };
    expect((await store.result(a.deviceId, result)).ok).toBe(true);
    await expect(store.result(a.deviceId, result)).rejects.toThrow("already completed");
    const report = await store.reports("0", 100);
    expect(report.reports).toHaveLength(1);
    expect(report.reports[0]).toMatchObject({ requestLossPercent: 40, serverPingReceipts: 3, targetLabel: "Fred HTTPS path" });
  });
  it("keeps the cooldown, expires the next lease and permits a new bounded job", async () => {
    const current = (await db.query("SELECT device_id FROM building_diagnostics_jobs WHERE status='queued'")).rows[0].device_id;
    const d = current === a.deviceId ? a : b;
    const device = (await db.query("SELECT computer_name,heartbeat FROM building_diagnostics_devices WHERE id=$1", [d.deviceId])).rows[0];
    expect(await store.checkIn(device.heartbeat, false)).toBeNull();
    await db.query("UPDATE building_diagnostics_reports SET recorded_at=now()-interval '31 seconds'");
    jobB = await store.checkIn(device.heartbeat, false);
    expect(jobB).not.toBeNull();
    await db.query("UPDATE building_diagnostics_jobs SET expires_at=now()-interval '1 second' WHERE id=$1", [jobB.id]);
    await expect(store.transfer(d.deviceId, jobB.id, "download")).rejects.toThrow("expired");
    await store.overview();
    expect((await db.query("SELECT status FROM building_diagnostics_jobs WHERE id=$1", [jobB.id])).rows[0].status).toBe("expired");
  });
  it("does not revive a stale AD snapshot by merely reuploading it", async () => {
    await expect(store.ingest({ ...inventory, adObservedAt: "2020-01-01T00:00:00.000Z" })).rejects.toThrow("older than current");
    await expect(store.ingest({ ...inventory, adObservedAt: new Date(Date.now() + 60_000).toISOString() })).rejects.toThrow("future");
  });
  it("persists a one-minute scheduler sweep throttle and avoids duplicate pending building jobs", async () => {
    expect((await store.queue({}, "automatic", true)).queued).toBe(0);
    await store.saveSettings({ schedulerArmed: true, rotationIntervalMinutes: 360 }, "synthetic CIO");
    const first = await store.queue({}, "automatic", true);
    expect(first.queued).toBe(1);
    expect((await store.queue({}, "automatic", true)).queued).toBe(0);
    await db.query("UPDATE building_diagnostics_inventory SET last_scheduler_at=now()-interval '61 seconds'");
    expect((await store.queue({}, "automatic", true)).queued).toBe(0);
    await db.query("UPDATE building_diagnostics_jobs SET status='expired' WHERE status='queued'");
    await store.saveSettings({ schedulerArmed: false, rotationIntervalMinutes: 360 }, "synthetic CIO");
  });
  it("permits an explicit unlocated AD computer test without crediting an assumed building", async () => {
    const previous = (await db.query("SELECT heartbeat FROM building_diagnostics_devices WHERE id=$1", [a.deviceId])).rows[0].heartbeat;
    const unknown = { ...previous, interfaces: [{ ...previous.interfaces[0], mac: "fe:dc:ba:98:76:54" }] };
    await store.checkIn(unknown, false);
    expect((await store.queue({ deviceIds: [a.deviceId] }, "synthetic manual")).queued).toBe(1);
    const job = await store.checkIn(unknown, false);
    expect(job).not.toBeNull();
    expect((await db.query("SELECT building FROM building_diagnostics_jobs WHERE id=$1", [job!.id])).rows[0].building).toBeNull();
    await store.result(a.deviceId, { jobId: job!.id, error: "synthetic stop; no network load" });
    await store.checkIn(previous, false);
  });
  it("revokes centrally, cancels pending work, rotates recovery credentials once and audits actions", async () => {
    const previousToken = a.deviceToken;
    expect((await store.queue({ deviceIds: [a.deviceId] }, "synthetic admin")).queued).toBe(1);
    await store.revoke(a.deviceId, "synthetic recovery", "synthetic admin");
    expect(await store.authenticate(previousToken)).toBeNull();
    expect((await db.query("SELECT count(*) FROM building_diagnostics_jobs WHERE device_id=$1 AND status IN ('queued','running')", [a.deviceId])).rows[0].count).toBe("0");
    expect((await store.overview()).devices.find((d) => d.deviceId === a.deviceId)?.revoked).toBe(true);
    a = await store.rotate(a.deviceId, "synthetic reprovision", "synthetic admin");
    expect(a.deviceToken).not.toBe(previousToken); expect(await store.authenticate(previousToken)).toBeNull();
    expect(await store.authenticate(a.deviceToken)).toMatchObject({ deviceId: a.deviceId });
    const actions = (await db.query("SELECT action FROM building_diagnostics_audit WHERE device_id=$1 AND action IN ('provision','revoke','rotate') ORDER BY id", [a.deviceId])).rows.map((r) => r.action);
    expect(actions).toEqual(["provision", "revoke", "rotate"]);
  });
  it("does not count an error report as a current building speed measurement", async () => {
    const report = (await db.query("SELECT id,data FROM building_diagnostics_reports WHERE building IS NOT NULL ORDER BY id LIMIT 1")).rows[0];
    await db.query("UPDATE building_diagnostics_reports SET data=$2 WHERE id=$1", [report.id, JSON.stringify({ ...report.data, error: "synthetic failed test", downloadMbps: null, uploadMbps: null })]);
    const overview = await store.overview();
    const building = overview.buildings.find((b) => b.lastResult?.id === String(report.id));
    expect(building?.noCurrentMeasurement).toBe(true);
  });
  it("revokes device authentication when the authoritative AD object is disabled or removed", async () => {
    await store.ingest({ ...inventory, adObservedAt: new Date().toISOString(), adComputers: inventory.adComputers.map((d) => ({ ...d, enabled: false })) });
    expect(await store.authenticate(a.deviceToken)).toBeNull();
    await expect(store.ingest({ ...inventory, adObservedAt: new Date().toISOString(), adComputers: [] })).rejects.toThrow("nonempty complete AD roster");
    expect(await store.authenticate(b.deviceToken)).toBeNull();
  });
  it("requires configured selected capable probes, not an external fleet sweep", async () => {
    await store.ingest({ ...inventory, adObservedAt: new Date().toISOString() });
    await db.query("UPDATE building_diagnostics_jobs SET status='expired' WHERE status IN ('queued','running','cancelled')");
    delete process.env.BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN;
    await expect(store.queue({ deviceIds: [a.deviceId], type: "external-quick" }, "test")).rejects.toThrow("configured probe");
    process.env.BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN = "https://probe.example.org";
    await expect(store.queue({ building: "Synthetic A", type: "external-quick" }, "test")).rejects.toThrow("explicitly selected");
    await expect(store.queue({ deviceIds: [a.deviceId], type: "external-quick" }, "test", true)).rejects.toThrow("explicitly selected");
    const previous = (await db.query("SELECT heartbeat FROM building_diagnostics_devices WHERE id=$1", [a.deviceId])).rows[0].heartbeat;
    await store.checkIn(previous, false);
    await expect(store.queue({ deviceIds: [a.deviceId], type: "external-quick" }, "test")).rejects.toThrow("does not support");
    await store.checkIn({ ...previous, capabilities: ["external-probe-v2"] }, false);
    expect((await store.queue({ deviceIds: [a.deviceId], type: "external-quick" }, "test")).queued).toBe(1);
  });
  it("keeps old helpers away from external jobs, binds fixed budgets, and derives result Mbps", async () => {
    await db.query("UPDATE building_diagnostics_reports SET recorded_at=now()-interval '31 seconds'");
    const previous = (await db.query("SELECT heartbeat FROM building_diagnostics_devices WHERE id=$1", [a.deviceId])).rows[0].heartbeat;
    expect(await store.checkIn({ ...previous, capabilities: [] }, false)).toBeNull();
    const job = await store.checkIn({ ...previous, capabilities: ["external-probe-v2"] }, false);
    expect(job).toMatchObject({ proofVersion: 2, type: "external-quick", targetOrigin: "https://probe.example.org", downloadBytes: 5242880, uploadBytes: 0, timeoutSeconds: 30 });
    await expect(store.transfer(a.deviceId, job!.id, "download")).rejects.toThrow("Invalid");
    await expect(store.jobStatus(b.deviceId, job!.id)).rejects.toThrow("Unknown");
    const external = { type: "external-quick", targetOrigin: "https://probe.example.org", path: "/probe-5mb.bin", timestamp: new Date().toISOString(), dnsMs: 2, tcpConnectMs: 5, tlsMs: 10, httpStatus: 206, bytesReceived: 5242880, elapsedMs: 1000, mbps: 99999 };
    await expect(store.result(a.deviceId, { jobId: job!.id, external: { ...external, targetOrigin: "https://other.example.org" } })).rejects.toThrow("does not match");
    expect((await store.result(a.deviceId, { jobId: job!.id, external })).ok).toBe(true);
    await expect(store.result(a.deviceId, { jobId: job!.id, external })).rejects.toThrow("already completed");
    const report = (await store.reports("0", 100)).reports.at(-1)!;
    expect(report).toMatchObject({ downloadMbps: 41.943, uploadMbps: null, external: { mbps: 41.943, bytesReceived: 5242880 } });
    await db.query("UPDATE building_diagnostics_jobs SET created_at=now()-interval '16 minutes',scheduled_at=now()-interval '16 minutes' WHERE id=$1", [job!.id]);
    await expect(store.queue({ deviceIds: [a.deviceId], type: "external-quick" }, "test")).rejects.toThrow("frequency limit");
  });
  it("requires one selected sustained probe with explicit enablement, schedule and budget", async () => {
    const scheduledAt = new Date(Date.now() + 120000).toISOString();
    await expect(store.queue({ deviceIds: [a.deviceId], type: "external-sustained", scheduledAt, sustainedConfirmed: true }, "test")).rejects.toThrow("Sustained test requires");
    process.env.BUILDING_DIAGNOSTICS_EXTERNAL_SUSTAINED_ENABLED = "true";
    await expect(store.queue({ deviceIds: [a.deviceId], type: "external-sustained", sustainedConfirmed: true }, "test")).rejects.toThrow("Sustained test requires");
    await expect(store.queue({ deviceIds: [a.deviceId, b.deviceId], type: "external-sustained", scheduledAt, sustainedConfirmed: true }, "test")).rejects.toThrow("Sustained test requires");
    expect((await store.queue({ deviceIds: [a.deviceId], type: "external-sustained", scheduledAt, sustainedConfirmed: true }, "test")).queued).toBe(1);
    const heartbeat = (await db.query("SELECT heartbeat FROM building_diagnostics_devices WHERE id=$1", [a.deviceId])).rows[0].heartbeat;
    expect(await store.checkIn(heartbeat, false)).toBeNull();
  });
  it("holds a cancelled external lease until closed-connection acknowledgment and preserves partial failures", async () => {
    await db.query("UPDATE building_diagnostics_jobs SET scheduled_at=now() WHERE type='external-sustained' AND status='queued'");
    await db.query("UPDATE building_diagnostics_reports SET recorded_at=now()-interval '31 seconds'");
    const heartbeat = (await db.query("SELECT heartbeat FROM building_diagnostics_devices WHERE id=$1", [a.deviceId])).rows[0].heartbeat;
    const other = (await db.query("SELECT heartbeat FROM building_diagnostics_devices WHERE id=$1", [b.deviceId])).rows[0].heartbeat;
    const job = await store.checkIn(heartbeat, false);
    expect(job).toMatchObject({ type: "external-sustained", downloadBytes: 67108864, timeoutSeconds: 180 });
    expect((await store.queue({ deviceIds: [b.deviceId] }, "test")).queued).toBe(1);
    const cancellation = await store.cancel(job!.id, "synthetic socket stop", "test admin");
    expect(cancellation.leaseHeldUntil).not.toBeNull();
    expect((await store.jobStatus(a.deviceId, job!.id)).status).toBe("cancelled");
    expect(await store.checkIn(other, false)).toBeNull();
    const external = { type: "external-sustained", targetOrigin: "https://probe.example.org", path: "/probe-1gb.bin", timestamp: new Date().toISOString(), httpStatus: 206, bytesReceived: 1024, elapsedMs: 100, failure: "cancelled" };
    await store.result(a.deviceId, { jobId: job!.id, external });
    const report = (await store.reports("0", 100)).reports.at(-1)!;
    expect(report).toMatchObject({ error: "cancelled", downloadMbps: null, external: { bytesReceived: 1024, failure: "cancelled" } });
    await db.query("UPDATE building_diagnostics_reports SET recorded_at=now()-interval '31 seconds'");
    const next = await store.checkIn(other, false);
    expect(next).not.toBeNull();
    await store.result(b.deviceId, { jobId: next!.id, error: "synthetic stop" });
    await db.query("UPDATE building_diagnostics_jobs SET created_at=now()-interval '25 hours',scheduled_at=now()-interval '25 hours' WHERE id=$1", [job!.id]);
    await expect(store.queue({ deviceIds: [a.deviceId], type: "external-sustained", scheduledAt: new Date(Date.now() + 120000).toISOString(), sustainedConfirmed: true }, "test")).rejects.toThrow("frequency limit");
  });
  it("counts cancelled and future scheduled reservations toward data-use limits", async () => {
    process.env.BUILDING_DIAGNOSTICS_EXTERNAL_DAILY_BUDGET_BYTES = "5242880";
    const other = (await db.query("SELECT heartbeat FROM building_diagnostics_devices WHERE id=$1", [b.deviceId])).rows[0].heartbeat;
    await store.checkIn({ ...other, capabilities: ["external-probe-v2"] }, false);
    await expect(store.queue({ deviceIds: [b.deviceId], type: "external-quick", scheduledAt: new Date(Date.now() + 23 * 60 * 60_000).toISOString() }, "test")).rejects.toThrow("data budget");
    delete process.env.BUILDING_DIAGNOSTICS_EXTERNAL_DAILY_BUDGET_BYTES;
    delete process.env.BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN;
    delete process.env.BUILDING_DIAGNOSTICS_EXTERNAL_SUSTAINED_ENABLED;
  });
  it("persists settings and fences automatic work after operator disarm, revision changes and restart gates", async () => {
    await store.ingest({ ...inventory, adObservedAt: new Date().toISOString() });
    await db.query("UPDATE building_diagnostics_jobs SET status='expired',created_at=now()-interval '2 days' WHERE status IN ('queued','running','cancelled') OR building IS NOT NULL");
    await db.query("UPDATE building_diagnostics_reports SET recorded_at=now()-interval '31 seconds'");
    const ha = (await db.query("SELECT heartbeat FROM building_diagnostics_devices WHERE id=$1", [a.deviceId])).rows[0].heartbeat;
    const hb = (await db.query("SELECT heartbeat FROM building_diagnostics_devices WHERE id=$1", [b.deviceId])).rows[0].heartbeat;
    await store.checkIn(ha, false); await store.checkIn(hb, false);
    const armed = await store.saveSettings({ schedulerArmed: true, rotationIntervalMinutes: 60 }, "synthetic CIO");
    expect(await store.settings()).toMatchObject({ schedulerArmed: true, rotationIntervalMinutes: 60, revision: armed.revision, updatedBy: "synthetic CIO" });
    await db.query("UPDATE building_diagnostics_inventory SET last_scheduler_at=NULL");
    expect((await store.queue({}, "automatic rotation", true)).queued).toBe(2);
    expect((await db.query("SELECT DISTINCT scheduler_revision FROM building_diagnostics_jobs WHERE automatic AND status='queued'")).rows).toEqual([{ scheduler_revision: armed.revision }]);
    const disarmed = await store.saveSettings({ schedulerArmed: false, rotationIntervalMinutes: 60 }, "synthetic CIO");
    expect(disarmed.revision).toBeGreaterThan(armed.revision);
    expect((await db.query("SELECT count(*) FROM building_diagnostics_jobs WHERE automatic AND status IN ('queued','running')")).rows[0].count).toBe("0");
    expect(await store.checkIn(ha, true)).toBeNull();
    await store.saveSettings({ schedulerArmed: true, rotationIntervalMinutes: 60 }, "synthetic CIO");
    await db.query("UPDATE building_diagnostics_inventory SET last_scheduler_at=NULL");
    expect((await store.queue({}, "automatic rotation", true)).queued).toBe(2);
    // Simulates a restart with the deployment gate off while durable arm remains true.
    process.env.BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED = "false";
    expect(await store.checkIn(ha, false)).toBeNull();
    expect((await store.settings()).schedulerArmed).toBe(true);
    expect((await store.settings()).effectiveSchedulerEnabled).toBe(false);
    process.env.BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED = "true";
    expect(await store.checkIn(ha, false)).toBeNull();
    // A manual network-operator request is independent of automatic arming.
    const manual = await store.queue({ deviceIds: [a.deviceId] }, "synthetic network operator");
    expect(manual.queued).toBe(1);
    await store.saveSettings({ schedulerArmed: false, rotationIntervalMinutes: 360 }, "synthetic CIO");
    const job = await store.checkIn(ha, false);
    expect(job?.id).toBe(manual.jobIds[0]);
    await store.result(a.deviceId, { jobId: job!.id, error: "synthetic completion" });
    const audit = (await store.overview()).audit.find((row) => row.jobId === manual.jobIds[0]);
    expect(audit).toMatchObject({ action: "queue-job", actor: "synthetic network operator", deviceId: a.deviceId, details: { automatic: false, type: "fred", downloadBytes: 8388608 } });
    expect(JSON.stringify(audit)).not.toContain(a.deviceToken);
  });
  it("rejects unknown target selections atomically and reports actual collector fields independently", async () => {
    await expect(store.queue({ deviceIds: [a.deviceId, randomUUID()] }, "synthetic operator")).rejects.toThrow("Every selected computer");
    await expect(store.queue({ deviceIds: [a.deviceId, a.deviceId] }, "synthetic operator")).rejects.toThrow("Every selected computer");
    await store.workerSeen();
    const current = new Date().toISOString();
    await store.ingest({ ...inventory, adObservedAt: current, collectorStatus: { observedAt: current, status: "degraded", switchesObserved: 1, portObservations: 1, wifiObservations: 0 }, observations: inventory.observations.map((o) => ({ ...o, observedAt: current, portTelemetry: { source: "snmp" as const, observedAt: current, linkMbps: 1000, inErrors: 2 } })) });
    const overview = await store.overview();
    expect(overview.readiness).toMatchObject({ worker: { state: "current" }, collector: { state: "degraded", switchesObserved: 1 }, inventory: { state: "current" } });
    expect(overview.devices.find((d) => d.deviceId === a.deviceId)?.portTelemetry).toMatchObject({ source: "snmp", linkMbps: 1000, inErrors: 2 });
    await expect(store.ingest({ ...inventory, adObservedAt: current, collectorStatus: { observedAt: new Date(Date.now() + 60_000).toISOString(), status: "ok", switchesObserved: 1, portObservations: 1, wifiObservations: 0 } })).rejects.toThrow("future");
  });
  it("updates AD independently without erasing concurrent private network evidence", async () => {
    const previous = (await db.query("SELECT data FROM building_diagnostics_inventory WHERE id=1")).rows[0].data;
    const newest = new Date(Date.now() + 1000).toISOString();
    await store.ingestAd({ adObservedAt: newest, adComputers: inventory.adComputers });
    expect(await store.adInventory()).toMatchObject({ snapshotComplete: true, adObservedAt: newest, adComputers: inventory.adComputers, fresh: true });
    let current = (await db.query("SELECT data FROM building_diagnostics_inventory WHERE id=1")).rows[0].data;
    expect(current.observations).toEqual(previous.observations); expect(current.userBuildingAssignments).toEqual(previous.userBuildingAssignments); expect(current.collectorStatus).toEqual(previous.collectorStatus);
    await expect(store.ingest({ ...inventory, adObservedAt: previous.adObservedAt, observations: [] })).rejects.toThrow("older than current");
    const networkTime = new Date(Date.now() + 2000).toISOString(), adTime = new Date(Date.now() + 3000).toISOString();
    const network = { ...previous, adObservedAt: networkTime, observations: [{ ...inventory.observations[0], port: "1/1/9" }] };
    const results = await Promise.allSettled([store.ingest(network), store.ingestAd({ adObservedAt: adTime, adComputers: inventory.adComputers })]);
    expect(results[1].status).toBe("fulfilled");
    current = (await db.query("SELECT data FROM building_diagnostics_inventory WHERE id=1")).rows[0].data;
    expect(current.adObservedAt).toBe(adTime);
    expect(current.observations).toEqual(results[0].status === "fulfilled" ? network.observations : previous.observations);
    expect(current.collectorStatus).toEqual(previous.collectorStatus);
    await expect(store.ingestAd({ adObservedAt: adTime, adComputers: [] })).rejects.toThrow("nonempty complete");
    await expect(store.ingestAd({ adObservedAt: new Date(Date.now() + 60_000).toISOString(), adComputers: inventory.adComputers })).rejects.toThrow("future");
    await expect(store.ingestAd({ adObservedAt: "2020-01-01T00:00:00Z", adComputers: inventory.adComputers })).rejects.toThrow("older than current");
    await expect(store.ingestAd({ adObservedAt: adTime, adComputers: [inventory.adComputers[0], inventory.adComputers[0]] })).rejects.toThrow("Duplicate AD object");
  });
  it("resolves a controller-attested client MAC without endpoint BSSID permission", async () => {
    const current = (await db.query("SELECT data FROM building_diagnostics_inventory WHERE id=1")).rows[0].data;
    const heartbeat = (await db.query("SELECT heartbeat FROM building_diagnostics_devices WHERE id=$1", [a.deviceId])).rows[0].heartbeat;
    const wifi = { ...heartbeat, interfaces: [{ ...heartbeat.interfaces[0], kind: "wifi" }] };
    delete wifi.interfaces[0].bssid;
    await store.ingest({ ...inventory, adObservedAt: current.adObservedAt, observations: [{ mac: wifi.interfaces[0].mac, bssid: "02:11:22:33:44:88", building: "Controller WiFi", source: "wifi", observedAt: new Date().toISOString(), edge: true }] });
    await store.checkIn(wifi, false);
    const device = (await store.overview()).devices.find((d) => d.deviceId === a.deviceId);
    expect(device?.location).toMatchObject({ kind: "network-confirmed", building: "Controller WiFi", source: "Wi-Fi AP" });
    expect(device?.portTelemetry).toBeNull();
  });
});
