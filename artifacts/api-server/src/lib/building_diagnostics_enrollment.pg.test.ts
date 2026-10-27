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
  async function scopedFixture(count: number) {
    // This pool is restricted above to an explicitly disposable test database.
    await db.query("TRUNCATE building_diagnostics_enrollment_items,building_diagnostics_enrollment_requests,building_diagnostics_enrollment_workers,building_diagnostics_devices CASCADE");
    const selected = Array.from({ length: count }, () => randomUUID());
    await db.query("UPDATE building_diagnostics_inventory SET data=$1 WHERE id=1", [JSON.stringify({ ...roster, adObservedAt: new Date().toISOString(), adComputers: selected.map((id, n) => ({ adObjectGuid: id, computerName: `SCOPE-${String(n).padStart(3, "0")}`, domain: "sccc.edu", enabled: true })) })]);
    return selected;
  }
  it("claims only selected requests while leaving all 222 older foreign targets queued", async () => {
    const selected = await scopedFixture(226), foreign = randomUUID(), allowed = randomUUID();
    await store.create({ requestId: foreign, adObjectGuids: selected.slice(0, 222) }, "synthetic foreign operator");
    await store.create({ requestId: allowed, adObjectGuids: selected.slice(222) }, "synthetic selected operator");
    const result = await store.claim("FILTERED-WORKER", [allowed.toUpperCase(), allowed]);
    expect(result.items).toHaveLength(4); expect(result.items.every(c => c.requestId === allowed)).toBe(true);
    expect(result).toMatchObject({ scope: { requestIds: [allowed], queuedRemaining: 0 }, measurementsQueued: false, policy: { permitSustained: false } });
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_enrollment_items WHERE request_id=$1 AND status='queued' AND claim_id IS NULL AND device_id IS NULL", [foreign])).rows[0].n).toBe("222");
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_devices")).rows[0].n).toBe("0");
  });
  it("retains the atomic four-claim global cap across concurrent filtered workers", async () => {
    const selected = await scopedFixture(230), foreign = randomUUID(), allowed = randomUUID();
    await store.create({ requestId: foreign, adObjectGuids: selected.slice(0, 222) }, "synthetic foreign operator");
    await store.create({ requestId: allowed, adObjectGuids: selected.slice(222) }, "synthetic selected operator");
    const results = await Promise.all([store.claim("FILTERED-A", [allowed]), store.claim("FILTERED-B", [allowed])]);
    const returned = results.flatMap(r => r.items);
    expect(returned).toHaveLength(4); expect(new Set(returned.map(c => c.adObjectGuid)).size).toBe(4);
    expect(returned.every(c => c.requestId === allowed)).toBe(true);
    expect((await store.claim("LEGACY-WORKER")).items).toHaveLength(0);
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_enrollment_items WHERE request_id=$1 AND status='queued'", [foreign])).rows[0].n).toBe("222");
  });
  it("preserves legacy global FIFO selection when requestIds is omitted", async () => {
    const selected = await scopedFixture(6), first = randomUUID(), second = randomUUID();
    await store.create({ requestId: first, adObjectGuids: selected.slice(0, 3) }, "synthetic first operator");
    await store.create({ requestId: second, adObjectGuids: selected.slice(3) }, "synthetic second operator");
    const result = await store.claim("LEGACY-FIFO");
    expect(result.items).toHaveLength(4); expect(result.items.filter(c => c.requestId === first)).toHaveLength(3);
    expect(result).not.toHaveProperty("scope");
  });
  it("does not rotate an existing device credential during a filtered claim", async () => {
    const selected = await scopedFixture(4), allowed = randomUUID(), existingId = randomUUID(), existingHash = "9".repeat(64);
    await db.query("INSERT INTO building_diagnostics_devices(id,ad_object_guid,computer_name,domain,token_hash,provisioned_by) VALUES($1,$2,'SCOPE-000','sccc.edu',$3,'synthetic existing operator')", [existingId, selected[0], existingHash]);
    const progress = await store.create({ requestId: allowed, adObjectGuids: selected }, "synthetic selected operator");
    expect(progress.items.find(i => i.adObjectGuid === selected[0])).toMatchObject({ status: "skipped", reason: "already-enrolled" });
    const result = await store.claim("FILTERED-EXISTING", [allowed]);
    expect(result.items).toHaveLength(3); expect(result.items.some(c => c.adObjectGuid === selected[0])).toBe(false);
    expect((await db.query("SELECT token_hash FROM building_diagnostics_devices WHERE id=$1", [existingId])).rows[0].token_hash).toBe(existingHash);
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_devices")).rows[0].n).toBe("1");
  });
  it("quarantines expired foreign claims without replaying them when a scoped worker resumes", async () => {
    const selected = await scopedFixture(8), interrupted = randomUUID(), allowed = randomUUID();
    await store.create({ requestId: interrupted, adObjectGuids: selected.slice(0, 4) }, "synthetic interrupted operator");
    expect((await store.claim("OLD-WORKER")).items).toHaveLength(4);
    await db.query("UPDATE building_diagnostics_enrollment_items SET claimed_at=now()-interval '16 minutes' WHERE request_id=$1", [interrupted]);
    await store.create({ requestId: allowed, adObjectGuids: selected.slice(4) }, "synthetic selected operator");
    const result = await store.claim("SCOPED-RESUME", [allowed]);
    expect(result.items).toHaveLength(4); expect(result.items.every(c => c.requestId === allowed)).toBe(true);
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_enrollment_items WHERE request_id=$1 AND status='failed' AND reason='worker-interrupted-review-required' AND device_id IS NULL", [interrupted])).rows[0].n).toBe("4");
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_devices")).rows[0].n).toBe("0");
  });
});
