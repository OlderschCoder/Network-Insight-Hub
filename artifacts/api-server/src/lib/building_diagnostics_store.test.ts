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
    db = (await import("@workspace/db")).pool;
    store = (await import("./building_diagnostics_store")).diagnosticsStore;
    // This explicitly named disposable test database is never shared with Fred.
    await db.query("DROP TABLE IF EXISTS building_diagnostics_audit,building_diagnostics_reports,building_diagnostics_jobs,building_diagnostics_devices,building_diagnostics_inventory CASCADE");
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
    const first = await store.queue({}, "automatic", true);
    expect(first.queued).toBe(1);
    expect((await store.queue({}, "automatic", true)).queued).toBe(0);
    await db.query("UPDATE building_diagnostics_inventory SET last_scheduler_at=now()-interval '61 seconds'");
    expect((await store.queue({}, "automatic", true)).queued).toBe(0);
    await db.query("UPDATE building_diagnostics_jobs SET status='expired' WHERE status='queued'");
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
    const actions = (await db.query("SELECT action FROM building_diagnostics_audit WHERE device_id=$1 ORDER BY id", [a.deviceId])).rows.map((r) => r.action);
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
    await store.ingest({ ...inventory, adObservedAt: new Date().toISOString(), adComputers: [] });
    expect(await store.authenticate(b.deviceToken)).toBeNull();
  });
});
