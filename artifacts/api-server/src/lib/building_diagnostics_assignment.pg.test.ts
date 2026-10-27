import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const configured = !!process.env.BUILDING_DIAGNOSTICS_TEST_DATABASE_URL;
vi.mock("@workspace/db", async () => {
  const { createRequire } = await import("node:module"), pg = createRequire(import.meta.url)("pg");
  const connectionString = process.env.BUILDING_DIAGNOSTICS_TEST_DATABASE_URL ?? "postgresql://invalid@127.0.0.1:1/diagnostics_bulk_test_missing";
  if (!/^\/diagnostics_bulk_test_[a-z0-9_]+$/i.test(new URL(connectionString).pathname)) throw new Error("Assignment integration tests require an explicitly disposable diagnostics_bulk_test_* database");
  return { pool: new pg.Pool({ connectionString, max: 6 }) };
});
vi.mock("../routes/network_nodes", () => ({ getBuildingSummaries: async () => [{ name: "Agriculture" }, { name: "Hobble" }] }));
describe.skipIf(!configured)("manual assignments in disposable Postgres", () => {
  let db: typeof import("@workspace/db").pool, store: typeof import("./building_diagnostics_assignment").buildingDiagnosticsAssignmentStore;
  const ids = [randomUUID(), randomUUID()], actor = { userId: 7, entraObjectId: randomUUID(), name: "Synthetic operator" };
  const roster = { adObservedAt: new Date().toISOString(), adComputers: ids.map((adObjectGuid, i) => ({ adObjectGuid, computerName: `SYNTHETIC-${i}`, domain: "sccc.edu", enabled: true })), observations: [], userBuildingAssignments: [] };
  beforeAll(async () => {
    db = (await import("@workspace/db")).pool; store = (await import("./building_diagnostics_assignment")).buildingDiagnosticsAssignmentStore;
    const { ensureDiagnosticsSchema } = await import("./building_diagnostics_store"); await ensureDiagnosticsSchema();
    await db.query("INSERT INTO building_diagnostics_inventory(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=$1", [JSON.stringify(roster)]);
  });
  afterAll(async () => { await db?.end(); });
  it("persists deduplicated assignments and reversible changes with exact old/new audit metadata", async () => {
    expect((await store.apply({ adObjectGuids: [ids[0], ids[0].toUpperCase(), ids[1]], building: "Hobble", reason: "Synthetic placement", apply: true }, actor)).updated).toBe(2);
    expect((await store.get()).assignments).toHaveLength(2);
    await store.apply({ adObjectGuids: [ids[0]], building: "Agriculture", reason: "Synthetic correction", apply: true }, actor);
    await store.apply({ adObjectGuids: [ids[1]], building: null, reason: "Synthetic clear", apply: true }, actor);
    expect((await store.get()).assignments).toMatchObject([{ adObjectGuid: ids[0], building: "Agriculture", source: "manual", updatedBy: actor.name }]);
    const audit = (await db.query("SELECT actor,details FROM building_diagnostics_audit WHERE action IN('assign-building','clear-building-assignment') ORDER BY id")).rows;
    expect(audit).toHaveLength(4); expect(audit[2].details).toMatchObject({ oldBuilding: "Hobble", newBuilding: "Agriculture" });
    expect(audit[3].details).toMatchObject({ oldBuilding: "Hobble", newBuilding: null }); expect(audit.every(r => r.actor.includes(actor.entraObjectId))).toBe(true);
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_devices")).rows[0].n).toBe("0");
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_jobs")).rows[0].n).toBe("0");
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_reports")).rows[0].n).toBe("0");
  });
  it("rejects a mixed valid/unknown selection with no partial assignment or audit", async () => {
    const before = (await db.query("SELECT count(*) AS n FROM building_diagnostics_audit")).rows[0].n;
    await expect(store.apply({ adObjectGuids: [ids[0], randomUUID()], building: "Hobble", reason: "Synthetic invalid selection", apply: true }, actor)).rejects.toThrow();
    expect((await store.get()).assignments[0].building).toBe("Agriculture");
    expect((await db.query("SELECT count(*) AS n FROM building_diagnostics_audit")).rows[0].n).toBe(before);
  });
  it("serializes overlapping reversed selections without partial final batches", async () => {
    await Promise.all([
      store.apply({ adObjectGuids: ids, building: "Hobble", reason: "Synthetic concurrent one", apply: true }, actor),
      store.apply({ adObjectGuids: [...ids].reverse(), building: "Agriculture", reason: "Synthetic concurrent two", apply: true }, actor),
    ]);
    const assignments = (await store.get()).assignments;
    expect(assignments).toHaveLength(2); expect(new Set(assignments.map(a => a.building)).size).toBe(1); expect(new Set(assignments.map(a => a.updatedAt)).size).toBe(1);
  });
  const groupId = randomUUID(), otherGroup = randomUUID();
  function directoryRoster(conflicting = false) {
    return { ...roster, adObservedAt: new Date().toISOString(), adComputers: roster.adComputers.map((computer, i) => ({ ...computer, directory: { memberOf: [groupId, ...(conflicting && i === 0 ? [otherGroup] : [])].map(objectGuid => ({ objectGuid, name: objectGuid === groupId ? "Synthetic-Comp" : "Synthetic-Other", distinguishedName: `CN=${objectGuid},OU=Groups,DC=sccc,DC=edu` })) } })) };
  }
  it("edits and clears explicit AD group defaults, with manual precedence and unchanged historical Unknown", async () => {
    await db.query("UPDATE building_diagnostics_inventory SET data=$1 WHERE id=1", [JSON.stringify(directoryRoster())]);
    await store.apply({ adObjectGuids: ids, building: null, reason: "Synthetic override reset", apply: true }, actor);
    const device = randomUUID(), job = randomUUID();
    await db.query("INSERT INTO building_diagnostics_devices(id,ad_object_guid,computer_name,domain,token_hash,provisioned_by) VALUES($1,$2,'SYNTHETIC-0','sccc.edu',$3,'synthetic test')", [device, ids[0], "f".repeat(64)]);
    await db.query("INSERT INTO building_diagnostics_jobs(id,device_id,status,requested_by,expires_at,download_bytes,upload_bytes) VALUES($1,$2,'complete','synthetic test',now()+interval '1 hour',1,0)", [job, device]);
    await db.query("INSERT INTO building_diagnostics_reports(job_id,device_id,building,recorded_at,data) VALUES($1,$2,NULL,'2026-01-01T00:00:00Z',$3)", [job, device, JSON.stringify({ synthetic: true, building: null })]);
    const history = (await db.query("SELECT building,recorded_at,data FROM building_diagnostics_reports WHERE job_id=$1", [job])).rows;
    await store.applyGroup({ groupObjectGuid: groupId, building: "Hobble", reason: "Synthetic group placement", apply: true }, actor);
    expect((await store.get()).assignments).toHaveLength(2);
    expect((await store.get()).assignments.every(a => a.source === "active-directory-group" && a.building === "Hobble")).toBe(true);
    await store.applyGroup({ groupObjectGuid: groupId, building: "Agriculture", reason: "Synthetic group correction", apply: true }, actor);
    await store.apply({ adObjectGuids: [ids[0]], building: "Hobble", reason: "Synthetic explicit override", apply: true }, actor);
    expect((await store.get()).assignments.find(a => a.adObjectGuid === ids[0])).toMatchObject({ source: "manual", building: "Hobble" });
    await store.apply({ adObjectGuids: [ids[0]], building: null, reason: "Synthetic restore directory default", apply: true }, actor);
    expect((await store.get()).assignments.find(a => a.adObjectGuid === ids[0])).toMatchObject({ source: "active-directory-group", building: "Agriculture" });
    await store.applyGroup({ groupObjectGuid: groupId, building: null, reason: "Synthetic clear group mapping", apply: true }, actor);
    expect((await store.get()).assignments).toEqual([]);
    expect((await db.query("SELECT building,recorded_at,data FROM building_diagnostics_reports WHERE job_id=$1", [job])).rows).toEqual(history);
    const audit = (await db.query("SELECT details FROM building_diagnostics_audit WHERE action IN('map-building-group','clear-building-group-mapping') ORDER BY id")).rows;
    expect(audit.map(row => [row.details.oldBuilding, row.details.newBuilding])).toEqual([[null, "Hobble"], ["Hobble", "Agriculture"], ["Agriculture", null]]);
  });
  it("rejects fabricated group identities and leaves conflicting real groups explicitly unassigned", async () => {
    await db.query("UPDATE building_diagnostics_inventory SET data=$1 WHERE id=1", [JSON.stringify(directoryRoster(true))]);
    await expect(store.applyGroup({ groupObjectGuid: randomUUID(), building: "Hobble", reason: "Synthetic fabricated identity", apply: true }, actor)).rejects.toThrow();
    await store.applyGroup({ groupObjectGuid: groupId, building: "Agriculture", reason: "Synthetic first group", apply: true }, actor);
    await store.applyGroup({ groupObjectGuid: otherGroup, building: "Hobble", reason: "Synthetic conflicting group", apply: true }, actor);
    const result = await store.get();
    expect(result.assignments.some(a => a.adObjectGuid === ids[0])).toBe(false);
    expect(result.groupConflicts).toMatchObject([{ adObjectGuid: ids[0], reason: "conflicting-group-buildings", buildings: ["Agriculture", "Hobble"] }]);
    expect(result.assignments.find(a => a.adObjectGuid === ids[1])).toMatchObject({ source: "active-directory-group", building: "Agriculture" });
  });
  it("retains orphaned saved mappings as editable metadata and permits only their explicit clear", async () => {
    await db.query("UPDATE building_diagnostics_inventory SET data=$1 WHERE id=1", [JSON.stringify({ ...roster, adObservedAt: new Date().toISOString() })]);
    expect((await store.get()).groupMappings.some(row => row.groupObjectGuid === otherGroup)).toBe(true);
    await store.applyGroup({ groupObjectGuid: otherGroup, building: null, reason: "Synthetic orphan clear", apply: true }, actor);
    expect((await store.get()).groupMappings.some(row => row.groupObjectGuid === otherGroup)).toBe(false);
    await expect(store.applyGroup({ groupObjectGuid: randomUUID(), building: null, reason: "Synthetic unknown clear", apply: true }, actor)).rejects.toThrow();
  });
});
