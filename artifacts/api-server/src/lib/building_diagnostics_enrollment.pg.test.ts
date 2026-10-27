import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const configured = !!process.env.BUILDING_DIAGNOSTICS_TEST_DATABASE_URL;
vi.mock("@workspace/db", async () => {
  const { createRequire } = await import("node:module"); const pg = createRequire(import.meta.url)("pg");
  const connectionString = process.env.BUILDING_DIAGNOSTICS_TEST_DATABASE_URL ?? "postgresql://invalid@127.0.0.1:1/diagnostics_bulk_test_missing";
  if (!/^\/diagnostics_bulk_test_[a-z0-9_]+$/i.test(new URL(connectionString).pathname)) throw new Error("Bulk integration tests require an explicitly named disposable diagnostics_bulk_test_* database");
  return { pool: new pg.Pool({ connectionString, max: 6 }) };
});
describe.skipIf(!configured)("bulk enrollment Postgres delivery and concurrency", () => {
  let store: typeof import("./building_diagnostics_enrollment").diagnosticsEnrollmentStore;
  let db: typeof import("@workspace/db").pool;
  const ids = Array.from({ length: 8 }, () => randomUUID()), requestId = randomUUID();
  const roster = { adObservedAt: new Date().toISOString(), adComputers: ids.map((id, n) => ({ adObjectGuid: id, computerName: `TEST-${n}`, domain: "sccc.edu", enabled: true })), observations: [], userBuildingAssignments: [] };
  let claims: any[] = [], credential: { deviceId: string; deviceToken: string };
  beforeAll(async () => {
    process.env.BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN = "https://probe.synthetic.example";
    db = (await import("@workspace/db")).pool; store = (await import("./building_diagnostics_enrollment")).diagnosticsEnrollmentStore;
    const { ensureDiagnosticsSchema } = await import("./building_diagnostics_store"); await ensureDiagnosticsSchema();
    await db.query("INSERT INTO building_diagnostics_inventory(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=$1", [JSON.stringify(roster)]);
  });
  afterAll(async () => { await db?.end(); });
  it("persists one exact selection per request UUID and rejects UUID reuse for another selection", async () => {
    const first = await store.create({ requestId, adObjectGuids: ids }, "synthetic network user");
    const same = await store.create({ requestId, adObjectGuids: [...ids].reverse() }, "synthetic network user");
    expect(first.requested).toBe(8); expect(same.requested).toBe(8);
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_enrollment_requests WHERE id=$1", [requestId])).rows[0].n).toBe("1");
    await expect(store.create({ requestId, adObjectGuids: [ids[0]] }, "synthetic network user")).rejects.toThrow("different computer selection");
    expect(JSON.stringify(first)).not.toMatch(/deviceToken|token_hash|claimId/);
  });
  it("caps simultaneous private workers at four durable global claims", async () => {
    const results = await Promise.all([store.claim("TEST-WORKER-A"), store.claim("TEST-WORKER-B")]);
    for (const result of results) expect(result).toMatchObject({ policy: { externalProbeOrigin: "https://probe.synthetic.example", permitSustained: false }, measurementsQueued: false });
    claims = results.flatMap(r => r.items);
    expect(claims).toHaveLength(4); expect(new Set(claims.map(c => c.adObjectGuid)).size).toBe(4);
    expect((await store.claim("TEST-WORKER-C")).items).toHaveLength(0);
  });
  it("issues a device credential once and never recovers it through replay or operator progress", async () => {
    credential = await store.provision(claims[0]);
    expect(credential.deviceToken).toMatch(/^sccc-diag\.[A-Za-z0-9_-]{43}$/);
    const device = (await db.query("SELECT token_hash FROM building_diagnostics_devices WHERE id=$1", [credential.deviceId])).rows[0];
    expect(device.token_hash).toHaveLength(64); expect(device.token_hash).not.toBe(credential.deviceToken);
    await expect(store.provision(claims[0])).rejects.toThrow("already attempted");
    await expect(store.provision({ ...claims[0], claimId: randomUUID() })).rejects.toThrow("claim");
    expect(JSON.stringify(await store.get(requestId))).not.toContain(credential.deviceToken);
  });
  it("requires running SYSTEM evidence and distinguishes installation from authenticated check-in", async () => {
    await expect(store.result(claims[0], "installed", "installed-awaiting-check-in")).rejects.toThrow("SYSTEM");
    await store.result(claims[0], "installed", "installed-awaiting-check-in", { taskRunning: true, taskSystem: true, helperVersion: "synthetic", signerThumbprint: "A".repeat(40), payloadSha256: "B".repeat(64) });
    expect((await store.get(requestId)).items.find(i => i.adObjectGuid === claims[0].adObjectGuid)?.status).toBe("installed");
    await db.query("UPDATE building_diagnostics_devices SET last_check_in=now() WHERE id=$1", [credential.deviceId]);
    expect((await store.get(requestId)).items.find(i => i.adObjectGuid === claims[0].adObjectGuid)?.status).toBe("online");
    await db.query("UPDATE building_diagnostics_devices SET revoked_at=now() WHERE id=$1", [credential.deviceId]);
    expect((await store.get(requestId)).items.find(i => i.adObjectGuid === claims[0].adObjectGuid)?.status).toBe("installed");
    const skipped = await store.create({ requestId: randomUUID(), adObjectGuids: [claims[0].adObjectGuid] }, "synthetic user");
    expect(skipped.items[0]).toMatchObject({ status: "skipped", reason: "revoked-identity-preserved" });
  });
  it("expires interrupted claims without silently replaying provisioning", async () => {
    await db.query("UPDATE building_diagnostics_enrollment_items SET claimed_at=now()-interval '16 minutes' WHERE request_id=$1 AND status='claimed'", [requestId]);
    const progress = await store.get(requestId);
    expect(progress.counts.failed).toBe(3);
    await expect(store.provision(claims[1])).rejects.toThrow("claim");
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_devices")).rows[0].n).toBe("1");
  });
});
