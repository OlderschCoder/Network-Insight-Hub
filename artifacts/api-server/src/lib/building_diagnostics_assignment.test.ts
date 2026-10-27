import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), catalog: vi.fn(), ensure: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: mock.query, connect: mock.connect } }));
vi.mock("../routes/network_nodes", () => ({ getBuildingSummaries: mock.catalog }));
vi.mock("./building_diagnostics_store", () => ({ DiagnosticsError: class extends Error { constructor(public status: number, message: string) { super(message); } }, ensureDiagnosticsSchema: mock.ensure }));
const id = "a3cf38da-324f-437b-bd35-1d34bd32b2e9", other = "b2b8d74a-57bf-4ebf-85d7-8429ca6eab1c";
const actor = { userId: 7, entraObjectId: "b8f6d2ad-ad3f-42d4-ae3c-602592904c88", name: "Synthetic operator" };
const input = { adObjectGuids: [id], building: "Agriculture", reason: "Confirmed campus placement", apply: true as const };
const gid = "9c91e75e-f828-4a24-9f01-d8b700ea50fc", secondGroup = "1736ccf1-e9dd-424f-a1db-9147560e7dca";
function withGroups(inv: any, groups = [gid]) { return { ...inv, adComputers: inv.adComputers.map((row: any) => ({ ...row, directory: { memberOf: groups.map(objectGuid => ({ objectGuid, name: objectGuid === gid ? "Ag-Comp" : "Other-Comp", distinguishedName: `CN=${objectGuid},OU=Groups,DC=sccc,DC=edu` })) } })) }; }
function mapping(groupObjectGuid = gid, building = "Agriculture") { return { groupObjectGuid, building, updatedAt: new Date().toISOString(), updatedBy: actor.name, reason: input.reason }; }
let code: typeof import("./building_diagnostics_assignment"), client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }, inventory: any;
beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules();
  mock.query.mockReset().mockResolvedValue({ rows: [] }); mock.ensure.mockReset().mockResolvedValue(undefined);
  mock.catalog.mockReset().mockResolvedValue([{ name: "Agriculture" }, { name: "Hobble" }]);
  inventory = { adObservedAt: new Date().toISOString(), adComputers: [{ adObjectGuid: id, computerName: "SYNTHETIC-1", domain: "sccc.edu", enabled: true }], observations: [], userBuildingAssignments: [] };
  client = { query: vi.fn(async (sql: string) => sql.startsWith("SELECT data FROM") ? { rows: [{ data: inventory }] } : sql.includes("FOR UPDATE") ? { rows: [{ adObjectGuid: id, building: "Hobble" }] } : { rows: [] }), release: vi.fn() };
  mock.connect.mockReset().mockResolvedValue(client);
  code = await import("./building_diagnostics_assignment");
});
describe("canonical manual building assignment metadata", () => {
  it("deduplicates immutable AD identities without broadening an invalid selection", () => {
    expect(code.normalizeAssignmentIds([other, id.toUpperCase(), id])).toEqual([id, other]);
    for (const invalid of [[], ["bad"], Array(1001).fill(id), null] as any[]) expect(() => code.normalizeAssignmentIds(invalid)).toThrow();
  });
  it("uses exact catalog names and does not infer a group-to-building crosswalk", () => {
    expect(code.canonicalAssignmentBuildings([{ name: "Tech Building A" }, { name: "Hobble" }, { name: "Hobble" }])).toEqual(["Hobble", "Tech Building A"]);
    for (const invalid of [[], [{}], null]) expect(() => code.canonicalAssignmentBuildings(invalid)).toThrow();
  });
  it("requires every selected AD computer to be current and enabled, independent of heartbeat", () => {
    expect(code.validateAssignmentDirectory(inventory, [id])).toHaveLength(1);
    expect(() => code.validateAssignmentDirectory(inventory, [id, other])).toThrow();
    for (const change of [{ adObservedAt: new Date(Date.now() - 25 * 3600_000).toISOString() }, { adObservedAt: new Date(Date.now() + 120_000).toISOString() }, { adComputers: [{ ...inventory.adComputers[0], enabled: false }] }]) expect(() => code.validateAssignmentDirectory({ ...inventory, ...change }, [id])).toThrow();
  });
  it("caches the trusted summary catalog for 60 seconds with one concurrent fetch", async () => {
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
    const results = await Promise.all([code.buildingDiagnosticsAssignmentStore.get(), code.buildingDiagnosticsAssignmentStore.get()]);
    expect(results[0].buildings).toEqual(["Agriculture", "Hobble"]); expect(mock.catalog).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockReturnValue(now + 59_000); await code.buildingDiagnosticsAssignmentStore.get(); expect(mock.catalog).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockReturnValue(now + 60_001); await code.buildingDiagnosticsAssignmentStore.get(); expect(mock.catalog).toHaveBeenCalledTimes(2);
  });
  it("validates the whole directory selection before any assignment or audit mutation", async () => {
    await expect(code.buildingDiagnosticsAssignmentStore.apply({ ...input, adObjectGuids: [id, other] }, actor)).rejects.toThrow();
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO|DELETE FROM/.test(sql))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK"); expect(client.release).toHaveBeenCalledOnce();
  });
  it("records exact old/new metadata and trusted actor inside one transaction", async () => {
    const result = await code.buildingDiagnosticsAssignmentStore.apply({ ...input, adObjectGuids: [id, id.toUpperCase()] }, actor);
    expect(result).toMatchObject({ ok: true, updated: 1 });
    const update = client.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO building_diagnostics_building_assignments"));
    expect(update?.[1]).toEqual([id, "Agriculture", input.reason, actor.name, actor.userId, actor.entraObjectId]);
    const audit = client.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO building_diagnostics_audit"));
    expect(JSON.parse(audit?.[1][4])).toMatchObject({ adObjectGuid: id, oldBuilding: "Hobble", newBuilding: "Agriculture", source: "manual" });
    expect(audit?.[1][2]).toBe(`Fred user 7; Entra ${actor.entraObjectId}`);
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
    expect(client.query.mock.calls.some(([sql]) => /UPDATE building_diagnostics_jobs|UPDATE building_diagnostics_reports|token_hash/.test(sql))).toBe(false);
  });
  it("clears the override reversibly and audits the previous value", async () => {
    const result = await code.buildingDiagnosticsAssignmentStore.apply({ ...input, building: null }, actor);
    expect(result).toEqual({ ok: true, updated: 1, assignments: [] });
    expect(client.query.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM building_diagnostics_building_assignments"))).toBe(true);
    const audit = client.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO building_diagnostics_audit"));
    expect(JSON.parse(audit?.[1][4])).toMatchObject({ oldBuilding: "Hobble", newBuilding: null });
  });
  it("rejects noncatalog buildings, implicit Apply and missing Entra identity before a transaction", async () => {
    await expect(code.buildingDiagnosticsAssignmentStore.apply({ ...input, building: "Ag-Comp" }, actor)).rejects.toThrow();
    await expect(code.buildingDiagnosticsAssignmentStore.apply({ ...input, apply: false as any }, actor)).rejects.toThrow();
    await expect(code.buildingDiagnosticsAssignmentStore.apply(input, { ...actor, entraObjectId: "" })).rejects.toThrow();
    expect(mock.connect).not.toHaveBeenCalled();
  });
  it("rolls back when the audit cannot be written", async () => {
    const query = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql, values) => { if (sql.startsWith("INSERT INTO building_diagnostics_audit")) throw new Error("synthetic audit failure"); return query(sql, values); });
    await expect(code.buildingDiagnosticsAssignmentStore.apply(input, actor)).rejects.toThrow("synthetic audit failure");
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK"); expect(client.release).toHaveBeenCalledOnce();
  });
  it("derives defaults only from current direct membership GUIDs with explicit canonical mappings", () => {
    const inv = withGroups(inventory);
    expect(code.resolveBuildingAssignments(inv, [], []).assignments).toEqual([]);
    const result = code.resolveBuildingAssignments(inv, [], [mapping()]);
    expect(result.assignments).toMatchObject([{ adObjectGuid: id, building: "Agriculture", source: "active-directory-group", directoryObservedAt: inventory.adObservedAt, groups: [{ groupObjectGuid: gid, name: "Ag-Comp" }] }]);
    expect(result.groups[0].computerCount).toBe(1);
  });
  it("gives an explicit computer override precedence and reveals the AD default when cleared", () => {
    const manual = { adObjectGuid: id, building: "Hobble", updatedAt: new Date().toISOString(), updatedBy: actor.name, reason: input.reason };
    expect(code.resolveBuildingAssignments(withGroups(inventory), [manual], [mapping()]).assignments[0]).toMatchObject({ source: "manual", building: "Hobble" });
    expect(code.resolveBuildingAssignments(withGroups(inventory), [], [mapping()]).assignments[0]).toMatchObject({ source: "active-directory-group", building: "Agriculture" });
  });
  it("keeps conflicting group buildings unassigned and collapses agreeing mappings", () => {
    const inv = withGroups(inventory, [gid, secondGroup]);
    const conflict = code.resolveBuildingAssignments(inv, [], [mapping(), mapping(secondGroup, "Hobble")]);
    expect(conflict.assignments).toEqual([]); expect(conflict.groupConflicts).toMatchObject([{ adObjectGuid: id, reason: "conflicting-group-buildings", buildings: ["Agriculture", "Hobble"] }]);
    const same = code.resolveBuildingAssignments(inv, [], [mapping(), mapping(secondGroup)]);
    expect(same.assignments).toHaveLength(1); expect(same.assignments[0]).toMatchObject({ source: "active-directory-group", groups: [{ groupObjectGuid: secondGroup }, { groupObjectGuid: gid }] });
  });
  it("does not refresh stale directory facts or infer defaults for disabled computers", () => {
    const stale = code.resolveBuildingAssignments(withGroups({ ...inventory, adObservedAt: new Date(Date.now() - 25 * 3600_000).toISOString() }), [], [mapping()]);
    expect(stale.directory.current).toBe(false); expect(stale.assignments).toEqual([]); expect(stale.groups).toEqual([]);
    const disabled = withGroups({ ...inventory, adComputers: [{ ...inventory.adComputers[0], enabled: false }] });
    expect(code.resolveBuildingAssignments(disabled, [], [mapping()]).assignments).toEqual([]);
  });
  it("allows mapping edits only for groups actually present in the fresh directory snapshot", async () => {
    inventory = withGroups(inventory);
    const result = await code.buildingDiagnosticsAssignmentStore.applyGroup({ groupObjectGuid: gid, building: "Agriculture", reason: input.reason, apply: true }, actor);
    expect(result).toEqual({ ok: true, updated: 1 });
    const audit = client.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO building_diagnostics_audit"));
    expect(JSON.parse(audit?.[1][3])).toMatchObject({ groupObjectGuid: gid, groupName: "Ag-Comp", oldBuilding: "Hobble", newBuilding: "Agriculture" });
    await expect(code.buildingDiagnosticsAssignmentStore.applyGroup({ groupObjectGuid: secondGroup, building: "Hobble", reason: input.reason, apply: true }, actor)).rejects.toThrow();
  });
  it("allows an orphaned saved group mapping to be cleared, but rejects a fabricated clear", async () => {
    await expect(code.buildingDiagnosticsAssignmentStore.applyGroup({ groupObjectGuid: gid, building: null, reason: input.reason, apply: true }, actor)).resolves.toEqual({ ok: true, updated: 1 });
    const audit = client.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO building_diagnostics_audit"));
    expect(JSON.parse(audit?.[1][3])).toMatchObject({ groupObjectGuid: gid, groupName: null, directoryPresent: false, newBuilding: null });
    const query = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql, values) => sql.includes("FOR UPDATE") ? { rows: [] } : query(sql, values));
    await expect(code.buildingDiagnosticsAssignmentStore.applyGroup({ groupObjectGuid: secondGroup, building: null, reason: input.reason, apply: true }, actor)).rejects.toThrow();
  });
});
