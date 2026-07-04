import {
  db,
  networkSwitchesTable,
  vlansTable,
  inventoryAuditTable,
} from "@workspace/db";
import type { AuditFieldChange } from "@workspace/db";
import { eq, ilike, desc, and } from "drizzle-orm";
import { logger } from "./logger";

export type { AuditFieldChange };

export type InventorySource = "manual" | "chat_ai";
export type InventoryEntityType = "switch" | "vlan";
export type InventoryAction = "create" | "update" | "rollback";

export interface InventoryActor {
  id: number | null;
  name: string | null;
}

export interface NetworkUpdate {
  kind: InventoryEntityType;
  id: number;
  label: string;
  action: "created" | "updated";
}

export interface PendingNetworkChange {
  kind: InventoryEntityType;
  action: "create" | "update";
  targetId: number | null;
  label: string;
  changes: AuditFieldChange[];
  payload: Record<string, unknown>;
}

// Fields tracked in the audit trail. Order also drives the diff output.
export const SWITCH_AUDIT_FIELDS = [
  "hostname",
  "building",
  "ipAddress",
  "model",
  "status",
  "configFile",
  "location",
  "notes",
] as const;

export const VLAN_AUDIT_FIELDS = [
  "vlanId",
  "name",
  "description",
  "building",
  "type",
  "subnet",
  "gateway",
  "notes",
] as const;

// A field becoming null/empty cannot be rolled back to if the column is
// required — used to block rolling back a create (all prior values are null).
const SWITCH_REQUIRED_FIELDS = new Set(["hostname", "building", "ipAddress"]);
const VLAN_REQUIRED_FIELDS = new Set(["vlanId", "name", "building", "type"]);

const SWITCH_STATUSES = new Set(["online", "offline", "unknown"]);
const VLAN_TYPES = new Set(["data", "voice", "ospf", "management", "security", "other"]);

function norm(v: unknown): unknown {
  if (v === undefined || v === "") return null;
  return v;
}

/**
 * Compute the per-field changes between a prior row (or null for a create) and
 * the resulting row, limited to the audited fields.
 */
export function diffFields(
  before: Record<string, any> | null,
  after: Record<string, any>,
  fields: readonly string[],
): AuditFieldChange[] {
  const out: AuditFieldChange[] = [];
  for (const f of fields) {
    const b = norm(before ? before[f] : null);
    const a = norm(after[f]);
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      out.push({ field: f, from: b, to: a });
    }
  }
  return out;
}

/**
 * Persist an audit entry for a switch/VLAN write. Best-effort: a failure to
 * record the audit must never break the actual inventory write, so errors are
 * logged, not thrown. No-ops when nothing changed (except rollbacks).
 */
export async function recordInventoryAudit(opts: {
  entityType: InventoryEntityType;
  entityId: number;
  entityLabel: string;
  action: InventoryAction;
  source: InventorySource;
  actor: InventoryActor;
  changes: AuditFieldChange[];
}): Promise<void> {
  if (opts.changes.length === 0 && opts.action !== "rollback") return;
  try {
    await db.insert(inventoryAuditTable).values({
      entityType: opts.entityType,
      entityId: opts.entityId,
      entityLabel: opts.entityLabel.slice(0, 255),
      action: opts.action,
      source: opts.source,
      actorId: opts.actor.id ?? undefined,
      actorName: opts.actor.name ?? undefined,
      changes: opts.changes,
    });
  } catch (err) {
    logger.error({ err, entityType: opts.entityType, entityId: opts.entityId }, "Failed to record inventory audit");
  }
}

export function vlanLabel(vlanId: number, name?: string | null): string {
  return name ? `VLAN ${vlanId} ${name}` : `VLAN ${vlanId}`;
}

// ---- Switch upsert (match by hostname) ------------------------------------

export interface SwitchUpsertInput {
  hostname: string;
  building?: string | null;
  ipAddress?: string | null;
  model?: string | null;
  status?: string | null;
  location?: string | null;
  notes?: string | null;
  configFile?: string | null;
}

type UpsertResult =
  | { ok: true; update: NetworkUpdate; result: string }
  | { ok: false; error: string };

function applySwitchInput(target: any, input: SwitchUpsertInput): void {
  if (input.building !== undefined) target.building = input.building;
  if (input.ipAddress !== undefined) target.ipAddress = input.ipAddress;
  if (input.model !== undefined) target.model = input.model;
  if (input.location !== undefined) target.location = input.location;
  if (input.notes !== undefined) target.notes = input.notes;
  if (input.configFile !== undefined) target.configFile = input.configFile;
  if (input.status !== undefined && input.status !== null) {
    const s = String(input.status).toLowerCase();
    if (SWITCH_STATUSES.has(s)) target.status = s;
  }
}

export async function upsertSwitchByHostname(
  input: SwitchUpsertInput,
  ctx: { actor: InventoryActor; source: InventorySource },
): Promise<UpsertResult> {
  const hostname = input.hostname?.trim();
  if (!hostname) return { ok: false, error: "hostname is required" };

  const [existing] = await db
    .select()
    .from(networkSwitchesTable)
    .where(ilike(networkSwitchesTable.hostname, hostname));

  if (existing) {
    const updates: any = {};
    applySwitchInput(updates, input);
    if (Object.keys(updates).length === 0) {
      return { ok: false, error: `No changes provided for switch "${hostname}".` };
    }
    const [row] = await db
      .update(networkSwitchesTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(networkSwitchesTable.id, existing.id))
      .returning();
    const changes = diffFields(existing, row, SWITCH_AUDIT_FIELDS);
    await recordInventoryAudit({
      entityType: "switch",
      entityId: row.id,
      entityLabel: row.hostname,
      action: "update",
      source: ctx.source,
      actor: ctx.actor,
      changes,
    });
    logger.info({ id: row.id, hostname: row.hostname, source: ctx.source }, "Switch updated");
    return {
      ok: true,
      result: `Updated switch "${row.hostname}" (id ${row.id}).`,
      update: { kind: "switch", id: row.id, label: row.hostname, action: "updated" },
    };
  }

  const building = input.building?.trim() || undefined;
  const ipAddress = input.ipAddress?.trim() || undefined;
  if (!building || !ipAddress) {
    return {
      ok: false,
      error: `Switch "${hostname}" does not exist yet; creating it requires both building and ipAddress.`,
    };
  }
  const values: any = { hostname, building, ipAddress, status: "unknown" };
  applySwitchInput(values, input);
  const [row] = await db.insert(networkSwitchesTable).values(values).returning();
  const changes = diffFields(null, row, SWITCH_AUDIT_FIELDS);
  await recordInventoryAudit({
    entityType: "switch",
    entityId: row.id,
    entityLabel: row.hostname,
    action: "create",
    source: ctx.source,
    actor: ctx.actor,
    changes,
  });
  logger.info({ id: row.id, hostname: row.hostname, source: ctx.source }, "Switch created");
  return {
    ok: true,
    result: `Added switch "${row.hostname}" in ${row.building} (id ${row.id}).`,
    update: { kind: "switch", id: row.id, label: row.hostname, action: "created" },
  };
}

export async function previewSwitchByHostname(
  input: SwitchUpsertInput,
): Promise<{ ok: true; pending: PendingNetworkChange } | { ok: false; error: string }> {
  const hostname = input.hostname?.trim();
  if (!hostname) return { ok: false, error: "hostname is required" };

  const [existing] = await db
    .select()
    .from(networkSwitchesTable)
    .where(ilike(networkSwitchesTable.hostname, hostname));

  if (existing) {
    const after: any = { ...existing };
    applySwitchInput(after, input);
    const changes = diffFields(existing, after, SWITCH_AUDIT_FIELDS);
    if (changes.length === 0) {
      return { ok: false, error: `No changes to apply for switch "${hostname}".` };
    }
    return {
      ok: true,
      pending: {
        kind: "switch",
        action: "update",
        targetId: existing.id,
        label: existing.hostname,
        changes,
        payload: { ...input, hostname: existing.hostname },
      },
    };
  }

  const building = input.building?.trim() || undefined;
  const ipAddress = input.ipAddress?.trim() || undefined;
  if (!building || !ipAddress) {
    return {
      ok: false,
      error: `Switch "${hostname}" does not exist yet; creating it requires both building and ipAddress.`,
    };
  }
  const after: any = { hostname, building, ipAddress, status: "unknown" };
  applySwitchInput(after, input);
  const changes = diffFields(null, after, SWITCH_AUDIT_FIELDS);
  return {
    ok: true,
    pending: {
      kind: "switch",
      action: "create",
      targetId: null,
      label: hostname,
      changes,
      payload: { ...input, hostname },
    },
  };
}

// ---- VLAN upsert (match by numeric vlanId) --------------------------------

export interface VlanUpsertInput {
  vlanId: number;
  name?: string | null;
  building?: string | null;
  type?: string | null;
  description?: string | null;
  subnet?: string | null;
  gateway?: string | null;
  notes?: string | null;
}

function applyVlanInput(target: any, input: VlanUpsertInput): void {
  if (input.name !== undefined) target.name = input.name;
  if (input.building !== undefined) target.building = input.building;
  if (input.description !== undefined) target.description = input.description;
  if (input.subnet !== undefined) target.subnet = input.subnet;
  if (input.gateway !== undefined) target.gateway = input.gateway;
  if (input.notes !== undefined) target.notes = input.notes;
  if (input.type !== undefined && input.type !== null) {
    const t = String(input.type).toLowerCase();
    if (VLAN_TYPES.has(t)) target.type = t;
  }
}

export async function upsertVlanByVlanId(
  input: VlanUpsertInput,
  ctx: { actor: InventoryActor; source: InventorySource },
): Promise<UpsertResult> {
  const vlanId = Number.isInteger(input.vlanId) ? input.vlanId : NaN;
  if (Number.isNaN(vlanId)) return { ok: false, error: "a numeric vlanId is required" };

  const [existing] = await db.select().from(vlansTable).where(eq(vlansTable.vlanId, vlanId));

  if (existing) {
    const updates: any = {};
    applyVlanInput(updates, input);
    if (Object.keys(updates).length === 0) {
      return { ok: false, error: `No changes provided for VLAN ${vlanId}.` };
    }
    const [row] = await db
      .update(vlansTable)
      .set(updates)
      .where(eq(vlansTable.id, existing.id))
      .returning();
    const changes = diffFields(existing, row, VLAN_AUDIT_FIELDS);
    await recordInventoryAudit({
      entityType: "vlan",
      entityId: row.id,
      entityLabel: vlanLabel(row.vlanId, row.name),
      action: "update",
      source: ctx.source,
      actor: ctx.actor,
      changes,
    });
    logger.info({ id: row.id, vlanId: row.vlanId, source: ctx.source }, "VLAN updated");
    return {
      ok: true,
      result: `Updated VLAN ${row.vlanId} "${row.name}" (id ${row.id}).`,
      update: { kind: "vlan", id: row.id, label: `VLAN ${row.vlanId}`, action: "updated" },
    };
  }

  const name = input.name?.trim() || undefined;
  const building = input.building?.trim() || undefined;
  const type = input.type ? String(input.type).toLowerCase() : undefined;
  if (!name || !building || !type || !VLAN_TYPES.has(type)) {
    return {
      ok: false,
      error: `VLAN ${vlanId} does not exist yet; creating it requires name, building, and a valid type.`,
    };
  }
  const values: any = { vlanId, name, building, type };
  applyVlanInput(values, input);
  const [row] = await db.insert(vlansTable).values(values).returning();
  const changes = diffFields(null, row, VLAN_AUDIT_FIELDS);
  await recordInventoryAudit({
    entityType: "vlan",
    entityId: row.id,
    entityLabel: vlanLabel(row.vlanId, row.name),
    action: "create",
    source: ctx.source,
    actor: ctx.actor,
    changes,
  });
  logger.info({ id: row.id, vlanId: row.vlanId, source: ctx.source }, "VLAN created");
  return {
    ok: true,
    result: `Added VLAN ${row.vlanId} "${row.name}" (id ${row.id}).`,
    update: { kind: "vlan", id: row.id, label: `VLAN ${row.vlanId}`, action: "created" },
  };
}

export async function previewVlanByVlanId(
  input: VlanUpsertInput,
): Promise<{ ok: true; pending: PendingNetworkChange } | { ok: false; error: string }> {
  const vlanId = Number.isInteger(input.vlanId) ? input.vlanId : NaN;
  if (Number.isNaN(vlanId)) return { ok: false, error: "a numeric vlanId is required" };

  const [existing] = await db.select().from(vlansTable).where(eq(vlansTable.vlanId, vlanId));

  if (existing) {
    const after: any = { ...existing };
    applyVlanInput(after, input);
    const changes = diffFields(existing, after, VLAN_AUDIT_FIELDS);
    if (changes.length === 0) {
      return { ok: false, error: `No changes to apply for VLAN ${vlanId}.` };
    }
    return {
      ok: true,
      pending: {
        kind: "vlan",
        action: "update",
        targetId: existing.id,
        label: vlanLabel(existing.vlanId, existing.name),
        changes,
        payload: { ...input, vlanId },
      },
    };
  }

  const name = input.name?.trim() || undefined;
  const building = input.building?.trim() || undefined;
  const type = input.type ? String(input.type).toLowerCase() : undefined;
  if (!name || !building || !type || !VLAN_TYPES.has(type)) {
    return {
      ok: false,
      error: `VLAN ${vlanId} does not exist yet; creating it requires name, building, and a valid type.`,
    };
  }
  const after: any = { vlanId, name, building, type };
  applyVlanInput(after, input);
  const changes = diffFields(null, after, VLAN_AUDIT_FIELDS);
  return {
    ok: true,
    pending: {
      kind: "vlan",
      action: "create",
      targetId: null,
      label: vlanLabel(vlanId, name),
      changes,
      payload: { ...input, vlanId },
    },
  };
}

// ---- Audit query + rollback ------------------------------------------------

export async function listInventoryAudit(opts: {
  entityType?: InventoryEntityType;
  entityId?: number;
  limit: number;
}) {
  const conditions: any[] = [];
  if (opts.entityType) conditions.push(eq(inventoryAuditTable.entityType, opts.entityType));
  if (opts.entityId != null) conditions.push(eq(inventoryAuditTable.entityId, opts.entityId));
  const query = db.select().from(inventoryAuditTable);
  const rows = conditions.length
    ? await query.where(and(...conditions)).orderBy(desc(inventoryAuditTable.createdAt)).limit(opts.limit)
    : await query.orderBy(desc(inventoryAuditTable.createdAt)).limit(opts.limit);
  return rows;
}

type RollbackResult =
  | { ok: true; update: NetworkUpdate; result: string }
  | { ok: false; error: string; status: number };

/**
 * Restore the prior field values captured in an audit entry. Only "update" and
 * "rollback" entries are reversible; a create has no prior state (all `from`
 * values are null) and rolling one back would null required columns, so it is
 * rejected. Records a new "rollback" audit entry for the reversal.
 */
export async function rollbackInventoryChange(
  auditId: number,
  actor: InventoryActor,
): Promise<RollbackResult> {
  const [entry] = await db
    .select()
    .from(inventoryAuditTable)
    .where(eq(inventoryAuditTable.id, auditId));
  if (!entry) return { ok: false, error: "Audit entry not found.", status: 404 };

  if (entry.action === "create") {
    return { ok: false, error: "A record creation cannot be rolled back — delete the record instead.", status: 400 };
  }
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  if (changes.length === 0) {
    return { ok: false, error: "This change has no field values to restore.", status: 400 };
  }

  const required = entry.entityType === "switch" ? SWITCH_REQUIRED_FIELDS : VLAN_REQUIRED_FIELDS;
  for (const c of changes) {
    if (required.has(c.field) && (c.from === null || c.from === undefined || c.from === "")) {
      return { ok: false, error: `Cannot roll back: required field "${c.field}" would become empty.`, status: 400 };
    }
  }

  const restore: Record<string, unknown> = {};
  for (const c of changes) restore[c.field] = c.from ?? null;

  if (entry.entityType === "switch") {
    const [existing] = await db
      .select()
      .from(networkSwitchesTable)
      .where(eq(networkSwitchesTable.id, entry.entityId));
    if (!existing) return { ok: false, error: "The switch no longer exists.", status: 404 };
    const [row] = await db
      .update(networkSwitchesTable)
      .set({ ...restore, updatedAt: new Date() })
      .where(eq(networkSwitchesTable.id, entry.entityId))
      .returning();
    const applied = diffFields(existing, row, SWITCH_AUDIT_FIELDS);
    await recordInventoryAudit({
      entityType: "switch",
      entityId: row.id,
      entityLabel: row.hostname,
      action: "rollback",
      source: "manual",
      actor,
      changes: applied,
    });
    logger.info({ id: row.id, auditId }, "Switch change rolled back");
    return {
      ok: true,
      result: `Rolled back switch "${row.hostname}".`,
      update: { kind: "switch", id: row.id, label: row.hostname, action: "updated" },
    };
  }

  const [existing] = await db.select().from(vlansTable).where(eq(vlansTable.id, entry.entityId));
  if (!existing) return { ok: false, error: "The VLAN no longer exists.", status: 404 };
  const [row] = await db
    .update(vlansTable)
    .set(restore)
    .where(eq(vlansTable.id, entry.entityId))
    .returning();
  const applied = diffFields(existing, row, VLAN_AUDIT_FIELDS);
  await recordInventoryAudit({
    entityType: "vlan",
    entityId: row.id,
    entityLabel: vlanLabel(row.vlanId, row.name),
    action: "rollback",
    source: "manual",
    actor,
    changes: applied,
  });
  logger.info({ id: row.id, auditId }, "VLAN change rolled back");
  return {
    ok: true,
    result: `Rolled back VLAN ${row.vlanId} "${row.name}".`,
    update: { kind: "vlan", id: row.id, label: `VLAN ${row.vlanId}`, action: "updated" },
  };
}
