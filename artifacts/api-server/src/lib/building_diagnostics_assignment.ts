import { pool } from "@workspace/db";
import { getBuildingSummaries } from "../routes/network_nodes";
import { fresh } from "./building_diagnostics";
import { DiagnosticsError, ensureDiagnosticsSchema, type Inventory } from "./building_diagnostics_store";

export const MAX_BUILDING_ASSIGNMENTS = 1000;
type Client = Pick<typeof pool, "query">;
export type AssignmentInput = { adObjectGuids: string[]; building: string | null; reason: string; apply: true };
export type AssignmentActor = { userId: number; entraObjectId: string; name: string };
export type GroupMappingInput = Omit<AssignmentInput, "adObjectGuids"> & { groupObjectGuid: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let ready: Promise<unknown> | undefined;
let catalogCache: { expiresAt: number; names: string[] } | undefined;
let catalogPending: Promise<string[]> | undefined;

export function normalizeAssignmentIds(ids: string[]) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BUILDING_ASSIGNMENTS || ids.some(id => typeof id !== "string" || !uuid.test(id))) throw new DiagnosticsError(400, "Select between 1 and 1,000 valid AD computer identities");
  return [...new Set(ids.map(id => id.toLowerCase()))].sort();
}

export function canonicalAssignmentBuildings(summaries: unknown): string[] {
  if (!Array.isArray(summaries) || !summaries.length || summaries.some(row => typeof row?.name !== "string" || !row.name.trim() || row.name.trim().length > 120)) throw new DiagnosticsError(503, "The campus building catalog is unavailable");
  return [...new Set<string>(summaries.map(row => row.name.trim()))].sort((a, b) => a.localeCompare(b));
}

export function validateAssignmentDirectory(inv: Inventory | undefined, ids: string[], now = Date.now()) {
  if (!inv || !Array.isArray(inv.adComputers) || !fresh(inv.adObservedAt, now, 24 * 60 * 60_000)) throw new DiagnosticsError(409, "A current trusted AD inventory is required before assigning buildings");
  const directory = new Map(inv.adComputers.map(row => [row.adObjectGuid.toLowerCase(), row]));
  return ids.map(id => {
    const row = directory.get(id);
    if (!row?.enabled || row.domain.toLowerCase() !== "sccc.edu") throw new DiagnosticsError(409, "Every selected computer must match the current enabled SCCC AD inventory");
    return row;
  });
}

function actorFacts(actor: AssignmentActor) {
  if (!Number.isSafeInteger(actor.userId) || actor.userId < 1 || !uuid.test(actor.entraObjectId || "")) throw new DiagnosticsError(403, "Microsoft sign-in is required to change building assignments");
  return { ...actor, entraObjectId: actor.entraObjectId.toLowerCase(), name: actor.name?.trim().slice(0, 255) || `Fred user ${actor.userId}` };
}

async function schema() {
  await ensureDiagnosticsSchema();
  return ready ??= pool.query(`CREATE TABLE IF NOT EXISTS building_diagnostics_building_assignments (
    ad_object_guid uuid PRIMARY KEY, building text NOT NULL, reason text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
    updated_by_user_id integer NOT NULL, updated_by_entra_object_id uuid NOT NULL
  ); CREATE TABLE IF NOT EXISTS building_diagnostics_building_group_mappings (
    group_object_guid uuid PRIMARY KEY, building text NOT NULL, reason text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
    updated_by_user_id integer NOT NULL, updated_by_entra_object_id uuid NOT NULL
  )`).catch(error => { ready = undefined; throw error; });
}

async function transaction<T>(fn: (client: Client) => Promise<T>) {
  await schema();
  const client = await pool.connect();
  try { await client.query("BEGIN"); const value = await fn(client); await client.query("COMMIT"); return value; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

const columns = `ad_object_guid AS "adObjectGuid",building,updated_at AS "updatedAt",updated_by AS "updatedBy",reason`;
const groupColumns = `group_object_guid AS "groupObjectGuid",building,updated_at AS "updatedAt",updated_by AS "updatedBy",reason`;
function assignment(row: any) {
  return { adObjectGuid: row.adObjectGuid, building: row.building, source: "manual" as const, updatedAt: new Date(row.updatedAt).toISOString(), updatedBy: row.updatedBy, reason: row.reason };
}
function groupMapping(row: any) {
  return { groupObjectGuid: row.groupObjectGuid, building: row.building, source: "manual" as const, updatedAt: new Date(row.updatedAt).toISOString(), updatedBy: row.updatedBy, reason: row.reason };
}
type GroupFact = { groupObjectGuid: string; name: string; distinguishedName: string; kind: "organizational-unit" | "security-group" };
type EffectiveAssignment = ReturnType<typeof assignment> | (Omit<ReturnType<typeof assignment>, "source"> & { source: "active-directory-group" | "active-directory-ou"; directoryObservedAt: string; groups: GroupFact[] });

// Split only unescaped DN component boundaries; a comma inside an escaped CN is not ancestry.
function dnComponents(dn: string): string[] {
  const parts: string[] = []; let start = 0;
  for (let i = 0; i < dn.length; i++) {
    if (dn[i] === "\\") { if (++i === dn.length) return []; }
    else if (dn[i] === ",") { parts.push(dn.slice(start, i).trim().toLowerCase()); start = i + 1; }
  }
  parts.push(dn.slice(start).trim().toLowerCase());
  return parts.every(part => /^[a-z][a-z0-9-]*=.+/i.test(part)) ? parts : [];
}

export function validateOrganizationalUnitAncestors(computerDn: string, units: { objectGuid: string; name: string; distinguishedName: string }[]): boolean {
  const computer = dnComponents(computerDn), ids = new Set<string>(), dns = new Set<string>();
  if (!computer.length || !Array.isArray(units) || units.length > 64) return false;
  return units.every(unit => {
    if (!uuid.test(unit?.objectGuid || "") || typeof unit.name !== "string" || !unit.name.trim() || typeof unit.distinguishedName !== "string") return false;
    const parts = dnComponents(unit.distinguishedName), id = unit.objectGuid.toLowerCase(), key = parts.join(",");
    if (!parts.length || !parts[0].startsWith("ou=") || parts.length >= computer.length || ids.has(id) || dns.has(key) || !parts.every((part, i) => part === computer[computer.length - parts.length + i])) return false;
    ids.add(id); dns.add(key); return true;
  });
}

/** Resolve explicit GUID mappings against actual OU ancestors, then direct security groups; never infer from names. */
export function resolveBuildingAssignments(inv: Inventory | undefined, manualRows: any[], mappingRows: any[], now = Date.now()) {
  const current = !!inv && Array.isArray(inv.adComputers) && fresh(inv.adObservedAt, now, 24 * 60 * 60_000);
  const effective = new Map<string, EffectiveAssignment>(manualRows.map(row => [row.adObjectGuid.toLowerCase(), assignment(row)]));
  const mappings = new Map(mappingRows.map(row => [row.groupObjectGuid.toLowerCase(), groupMapping(row)]));
  const groupIndex = new Map<string, GroupFact & { computers: Set<string> }>();
  const memberships = new Map<string, Set<string>>();
  const ouMemberships = new Map<string, string[]>();
  if (current) for (const computer of inv!.adComputers) {
    if (!computer.enabled || computer.domain.toLowerCase() !== "sccc.edu") continue;
    const id = computer.adObjectGuid.toLowerCase(), directory = computer.directory, groups = directory?.memberOf;
    const member = new Set<string>();
    for (const group of Array.isArray(groups) ? groups : []) {
      if (!uuid.test(group?.objectGuid || "") || typeof group.name !== "string" || !group.name.trim() || typeof group.distinguishedName !== "string" || !group.distinguishedName.trim()) continue;
      const gid = group.objectGuid.toLowerCase();
      if (!groupIndex.has(gid)) groupIndex.set(gid, { groupObjectGuid: gid, name: group.name, distinguishedName: group.distinguishedName, kind: "security-group", computers: new Set() });
      groupIndex.get(gid)!.computers.add(id); member.add(gid);
    }
    memberships.set(id, member);
    const units = directory?.organizationalUnits;
    if (units && validateOrganizationalUnitAncestors(directory!.distinguishedName, units)) {
      const ordered = [...units].sort((a, b) => b.distinguishedName.length - a.distinguishedName.length);
      ouMemberships.set(id, ordered.map(unit => unit.objectGuid.toLowerCase()));
      for (const unit of ordered) {
        const gid = unit.objectGuid.toLowerCase();
        if (!groupIndex.has(gid)) groupIndex.set(gid, { groupObjectGuid: gid, name: unit.name, distinguishedName: unit.distinguishedName, kind: "organizational-unit", computers: new Set() });
        groupIndex.get(gid)!.computers.add(id);
      }
    }
  }
  const groupConflicts: { adObjectGuid: string; reason: "conflicting-group-buildings"; buildings: string[]; groups: GroupFact[] }[] = [];
  for (const [id, member] of memberships) {
    if (effective.has(id)) continue; // A computer override is explicit and takes precedence.
    const nearestMappedOu = ouMemberships.get(id)?.find(gid => mappings.has(gid));
    if (nearestMappedOu) {
      const mapped = mappings.get(nearestMappedOu)!, { computers: _, ...fact } = groupIndex.get(nearestMappedOu)!;
      effective.set(id, { adObjectGuid: id, building: mapped.building, source: "active-directory-ou", updatedAt: mapped.updatedAt, updatedBy: mapped.updatedBy, reason: mapped.reason, directoryObservedAt: inv!.adObservedAt, groups: [fact] });
      continue;
    }
    const matched = [...member].filter(gid => mappings.has(gid));
    const names = [...new Set(matched.map(gid => mappings.get(gid)!.building))].sort();
    const groups = matched.sort().map(gid => { const { computers: _, ...fact } = groupIndex.get(gid)!; return fact; });
    if (names.length > 1) { groupConflicts.push({ adObjectGuid: id, reason: "conflicting-group-buildings", buildings: names, groups }); continue; }
    if (names.length === 1) {
      const newest = matched.map(gid => mappings.get(gid)!).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
      effective.set(id, { adObjectGuid: id, building: names[0], source: "active-directory-group", updatedAt: newest.updatedAt, updatedBy: newest.updatedBy, reason: newest.reason, directoryObservedAt: inv!.adObservedAt, groups });
    }
  }
  return {
    assignments: [...effective.values()].sort((a, b) => a.adObjectGuid.localeCompare(b.adObjectGuid)),
    groups: [...groupIndex.values()].map(({ computers, ...fact }) => ({ ...fact, computerCount: computers.size })).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "organizational-unit" ? -1 : 1) || a.name.localeCompare(b.name) || a.groupObjectGuid.localeCompare(b.groupObjectGuid)),
    groupMappings: [...mappings.values()].sort((a, b) => a.groupObjectGuid.localeCompare(b.groupObjectGuid)), groupConflicts,
    directory: { observedAt: inv?.adObservedAt || null, current },
  };
}
async function buildings() {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return [...catalogCache.names];
  return catalogPending ??= getBuildingSummaries().then(summaries => {
    const names = canonicalAssignmentBuildings(summaries);
    catalogCache = { expiresAt: Date.now() + 60_000, names };
    return [...names];
  }).finally(() => { catalogPending = undefined; });
}

export const buildingDiagnosticsAssignmentStore = {
  async get() {
    await schema();
    const [catalog, rows, mappings, inventory] = await Promise.all([buildings(), pool.query(`SELECT ${columns} FROM building_diagnostics_building_assignments ORDER BY ad_object_guid`), pool.query(`SELECT ${groupColumns} FROM building_diagnostics_building_group_mappings ORDER BY group_object_guid`), pool.query("SELECT data FROM building_diagnostics_inventory WHERE id=1")]);
    return { buildings: catalog, ...resolveBuildingAssignments(inventory.rows[0]?.data, rows.rows, mappings.rows) };
  },
  async apply(input: AssignmentInput, actor: AssignmentActor) {
    const ids = normalizeAssignmentIds(input.adObjectGuids), by = actorFacts(actor);
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (input.apply !== true || reason.length < 3 || reason.length > 300 || (input.building !== null && (typeof input.building !== "string" || !input.building.trim() || input.building.trim().length > 120))) throw new DiagnosticsError(400, "An explicit Apply action and a reason of 3–300 characters are required");
    const building = input.building === null ? null : input.building.trim();
    if (building !== null && !(await buildings()).includes(building)) throw new DiagnosticsError(400, "Choose a building from the current campus building catalog");
    return transaction(async client => {
      // Deterministic per-AD-identity locks serialize overlapping selections without locking jobs.
      for (const id of ids) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,17409244))", [`sccc.manual-building:${id}`]);
      const inventory = (await client.query("SELECT data FROM building_diagnostics_inventory WHERE id=1 FOR SHARE")).rows[0]?.data as Inventory | undefined;
      const selected = validateAssignmentDirectory(inventory, ids);
      const before = (await client.query(`SELECT ${columns} FROM building_diagnostics_building_assignments WHERE ad_object_guid=ANY($1::uuid[]) FOR UPDATE`, [ids])).rows;
      const old = new Map(before.map(row => [row.adObjectGuid, row]));
      for (const computer of selected) {
        const id = computer.adObjectGuid.toLowerCase();
        if (building === null) await client.query("DELETE FROM building_diagnostics_building_assignments WHERE ad_object_guid=$1", [id]);
        else await client.query(`INSERT INTO building_diagnostics_building_assignments(ad_object_guid,building,reason,updated_by,updated_by_user_id,updated_by_entra_object_id)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(ad_object_guid) DO UPDATE SET building=EXCLUDED.building,reason=EXCLUDED.reason,
          updated_at=now(),updated_by=EXCLUDED.updated_by,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_by_entra_object_id=EXCLUDED.updated_by_entra_object_id`, [id, building, reason, by.name, by.userId, by.entraObjectId]);
        await client.query(`INSERT INTO building_diagnostics_audit(device_id,action,actor,reason,details)
          VALUES((SELECT id FROM building_diagnostics_devices WHERE ad_object_guid=$1),$2,$3,$4,$5::jsonb)`, [id, building === null ? "clear-building-assignment" : "assign-building", `Fred user ${by.userId}; Entra ${by.entraObjectId}`, reason,
          JSON.stringify({ source: "manual", adObjectGuid: id, computerName: computer.computerName, oldBuilding: old.get(id)?.building ?? null, newBuilding: building, updatedBy: by.name })]);
      }
      const after = await client.query(`SELECT ${columns} FROM building_diagnostics_building_assignments WHERE ad_object_guid=ANY($1::uuid[]) ORDER BY ad_object_guid`, [ids]);
      return { ok: true, updated: ids.length, assignments: after.rows.map(assignment) };
    });
  },
  async applyGroup(input: GroupMappingInput, actor: AssignmentActor) {
    const id = normalizeAssignmentIds([input.groupObjectGuid])[0], by = actorFacts(actor);
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (input.apply !== true || reason.length < 3 || reason.length > 300 || (input.building !== null && (typeof input.building !== "string" || !input.building.trim() || input.building.trim().length > 120))) throw new DiagnosticsError(400, "An explicit Apply action and a reason of 3–300 characters are required");
    const building = input.building === null ? null : input.building.trim();
    if (building !== null && !(await buildings()).includes(building)) throw new DiagnosticsError(400, "Choose a building from the current campus building catalog");
    return transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,17409244))", [`sccc.building-group:${id}`]);
      const inventory = (await client.query("SELECT data FROM building_diagnostics_inventory WHERE id=1 FOR SHARE")).rows[0]?.data as Inventory | undefined;
      if (!inventory || !fresh(inventory.adObservedAt, Date.now(), 24 * 60 * 60_000)) throw new DiagnosticsError(409, "A current trusted AD inventory is required before mapping groups");
      const previous = (await client.query(`SELECT ${groupColumns} FROM building_diagnostics_building_group_mappings WHERE group_object_guid=$1 FOR UPDATE`, [id])).rows[0];
      const group = resolveBuildingAssignments(inventory, [], []).groups.find(row => row.groupObjectGuid === id);
      if (!group && !(building === null && previous)) throw new DiagnosticsError(409, "Select a current AD folder or direct group, or clear its existing saved mapping");
      if (building === null) await client.query("DELETE FROM building_diagnostics_building_group_mappings WHERE group_object_guid=$1", [id]);
      else await client.query(`INSERT INTO building_diagnostics_building_group_mappings(group_object_guid,building,reason,updated_by,updated_by_user_id,updated_by_entra_object_id)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(group_object_guid) DO UPDATE SET building=EXCLUDED.building,reason=EXCLUDED.reason,updated_at=now(),
        updated_by=EXCLUDED.updated_by,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_by_entra_object_id=EXCLUDED.updated_by_entra_object_id`, [id, building, reason, by.name, by.userId, by.entraObjectId]);
      await client.query("INSERT INTO building_diagnostics_audit(action,actor,reason,details) VALUES($1,$2,$3,$4::jsonb)", [building === null ? "clear-building-group-mapping" : "map-building-group", `Fred user ${by.userId}; Entra ${by.entraObjectId}`, reason,
        JSON.stringify({ source: "manual-group-mapping", groupObjectGuid: id, groupName: group?.name ?? null, kind: group?.kind ?? null, distinguishedName: group?.distinguishedName ?? null, directoryPresent: !!group, oldBuilding: previous?.building ?? null, newBuilding: building, updatedBy: by.name })]);
      return { ok: true, updated: 1 };
    });
  },
};
