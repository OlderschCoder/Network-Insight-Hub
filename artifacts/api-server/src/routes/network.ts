import { Router } from "express";
import {
  db,
  networkSwitchesTable,
  vlansTable,
  networkLayoutPositionsTable,
} from "@workspace/db";
import type { MaintenanceLogEntry } from "@workspace/db";
import { eq, and, or, ilike, desc, inArray, sql } from "drizzle-orm";
import { requireAuth, requireCIO, requireNetworkAdmin } from "./auth";
import {
  getFortiGateConfig,
  whitelistUrl,
  listWhitelistEntries,
  normalizeUrlPattern,
  FortiGateError,
} from "../lib/fortigate";
import { z } from "zod";
import crypto from "crypto";
import type OpenAI from "openai";
import { getOpenAI, isAIConfigured } from "../lib/openai";
import { getKnowledgeContext, runChatWithMemory, messageRequestsCapture } from "../lib/ai_knowledge";
import {
  upsertSwitchByHostname,
  upsertVlanByVlanId,
  listInventoryAudit,
  rollbackInventoryChange,
  recordInventoryAudit,
  diffFields,
  SWITCH_AUDIT_FIELDS,
  VLAN_AUDIT_FIELDS,
  type InventoryActor,
} from "../lib/inventory";
import { buildInventoryHealth } from "../lib/inventory_health";
import {
  getLockStatus,
  acquireLock,
  releaseLock,
  resetLayout,
  listLayoutEvents,
  restoreLayout,
} from "../lib/layout_governance";
import fs from "fs";
import path from "path";

const router = Router();

function reqActor(req: any): InventoryActor {
  return { id: req.user?.id ?? null, name: req.user?.name ?? null };
}

const MAINTENANCE_EDIT_ROLES = new Set(["cio", "network", "network_engineer"]);

function visibleMaintenanceLog(log: unknown): MaintenanceLogEntry[] {
  if (!Array.isArray(log)) return [];
  return (log as MaintenanceLogEntry[]).filter((e) => !e?.deletedAt);
}

function withVisibleMaintenanceLog<T extends { maintenanceLog?: unknown }>(row: T): T {
  return { ...row, maintenanceLog: visibleMaintenanceLog(row.maintenanceLog) };
}

function canEditMaintenanceEntry(user: any, entry: MaintenanceLogEntry): boolean {
  if (!user) return false;
  if (entry.authorId != null && entry.authorId === user.id) return true;
  return MAINTENANCE_EDIT_ROLES.has(user.role);
}

let cachedMapDataUrl: string | null = null;
function getCampusMapDataUrl(): string | null {
  if (cachedMapDataUrl) return cachedMapDataUrl;
  const candidates = [
    path.resolve(process.cwd(), "attached_assets/image_1776715156641.png"),
    path.resolve(process.cwd(), "../../attached_assets/image_1776715156641.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        cachedMapDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
        return cachedMapDataUrl;
      }
    } catch {}
  }
  return null;
}

router.get("/switches", requireAuth, async (req: any, res) => {
  const { q, building, status } = req.query;
  let switches;
  if (q) {
    switches = await db.select().from(networkSwitchesTable).where(
      or(
        ilike(networkSwitchesTable.hostname, `%${q}%`),
        ilike(networkSwitchesTable.building, `%${q}%`),
        ilike(networkSwitchesTable.ipAddress, `%${q}%`),
        ilike(networkSwitchesTable.model, `%${q}%`)
      )
    ).orderBy(networkSwitchesTable.building);
  } else {
    const conditions: any[] = [];
    if (building) conditions.push(ilike(networkSwitchesTable.building, `%${building}%`));
    if (status) conditions.push(eq(networkSwitchesTable.status, status as string));
    switches = conditions.length > 0
      ? await db.select().from(networkSwitchesTable).where(and(...conditions)).orderBy(networkSwitchesTable.building)
      : await db.select().from(networkSwitchesTable).orderBy(networkSwitchesTable.building);
  }
  return res.json(switches.map(withVisibleMaintenanceLog));
});

router.post("/switches", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const schema = z.object({
    hostname: z.string().min(1),
    building: z.string().min(1),
    ipAddress: z.string().min(1),
    model: z.string().optional(),
    status: z.enum(["online", "offline", "unknown"]).optional(),
    configFile: z.string().optional(),
    notes: z.string().optional(),
    location: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [sw] = await db.insert(networkSwitchesTable).values(parsed.data).returning();
  await recordInventoryAudit({
    entityType: "switch",
    entityId: sw.id,
    entityLabel: sw.hostname,
    action: "create",
    source: "manual",
    actor: reqActor(req),
    changes: diffFields(null, sw, SWITCH_AUDIT_FIELDS),
  });
  return res.status(201).json(sw);
});

router.get("/switches/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const [sw] = await db.select().from(networkSwitchesTable).where(eq(networkSwitchesTable.id, id));
  if (!sw) return res.status(404).json({ error: "Not found" });
  return res.json(withVisibleMaintenanceLog(sw));
});

router.patch("/switches/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const schema = z.object({
    hostname: z.string().optional(),
    building: z.string().optional(),
    ipAddress: z.string().optional(),
    model: z.string().optional(),
    status: z.enum(["online", "offline", "unknown"]).optional(),
    configFile: z.string().optional(),
    notes: z.string().optional(),
    location: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [before] = await db.select().from(networkSwitchesTable).where(eq(networkSwitchesTable.id, id));
  if (!before) return res.status(404).json({ error: "Not found" });
  const [sw] = await db.update(networkSwitchesTable).set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(networkSwitchesTable.id, id)).returning();
  if (!sw) return res.status(404).json({ error: "Not found" });
  await recordInventoryAudit({
    entityType: "switch",
    entityId: sw.id,
    entityLabel: sw.hostname,
    action: "update",
    source: "manual",
    actor: reqActor(req),
    changes: diffFields(before, sw, SWITCH_AUDIT_FIELDS),
  });
  return res.json(sw);
});

router.post("/switches/:id/maintenance-log", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const schema = z.object({
    body: z.string().min(1).max(4000),
    windowStart: z.string().datetime().optional().nullable(),
    windowEnd: z.string().datetime().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  const [existing] = await db.select().from(networkSwitchesTable).where(eq(networkSwitchesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const entry: MaintenanceLogEntry = {
    id: crypto.randomUUID(),
    body: parsed.data.body,
    authorId: req.user?.id ?? null,
    authorName: req.user?.name ?? req.user?.email ?? "Unknown",
    createdAt: new Date().toISOString(),
    windowStart: parsed.data.windowStart ?? null,
    windowEnd: parsed.data.windowEnd ?? null,
  };

  const log = Array.isArray(existing.maintenanceLog) ? existing.maintenanceLog : [];
  const nextLog = [entry, ...log];

  const [sw] = await db.update(networkSwitchesTable)
    .set({ maintenanceLog: nextLog, updatedAt: new Date() })
    .where(eq(networkSwitchesTable.id, id))
    .returning();
  return res.json(withVisibleMaintenanceLog(sw));
});

router.patch("/switches/:id/maintenance-log/:entryId", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const entryId = req.params.entryId;
  if (Number.isNaN(id) || !entryId) return res.status(400).json({ error: "Invalid id" });
  const schema = z.object({
    body: z.string().min(1).max(4000),
    windowStart: z.string().datetime().optional().nullable(),
    windowEnd: z.string().datetime().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  const [existing] = await db.select().from(networkSwitchesTable).where(eq(networkSwitchesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const log = Array.isArray(existing.maintenanceLog) ? existing.maintenanceLog : [];
  const idx = log.findIndex((e) => e?.id === entryId);
  if (idx === -1 || log[idx]?.deletedAt) return res.status(404).json({ error: "Entry not found" });

  if (!canEditMaintenanceEntry(req.user, log[idx])) {
    return res.status(403).json({ error: "Not allowed to edit this entry" });
  }

  const updated: MaintenanceLogEntry = {
    ...log[idx],
    body: parsed.data.body,
    windowStart: parsed.data.windowStart ?? null,
    windowEnd: parsed.data.windowEnd ?? null,
    editedAt: new Date().toISOString(),
  };
  const nextLog = log.slice();
  nextLog[idx] = updated;

  const [sw] = await db.update(networkSwitchesTable)
    .set({ maintenanceLog: nextLog, updatedAt: new Date() })
    .where(eq(networkSwitchesTable.id, id))
    .returning();
  return res.json(withVisibleMaintenanceLog(sw));
});

router.delete("/switches/:id/maintenance-log/:entryId", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const entryId = req.params.entryId;
  if (Number.isNaN(id) || !entryId) return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db.select().from(networkSwitchesTable).where(eq(networkSwitchesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const log = Array.isArray(existing.maintenanceLog) ? existing.maintenanceLog : [];
  const idx = log.findIndex((e) => e?.id === entryId);
  if (idx === -1 || log[idx]?.deletedAt) return res.status(404).json({ error: "Entry not found" });

  if (!canEditMaintenanceEntry(req.user, log[idx])) {
    return res.status(403).json({ error: "Not allowed to delete this entry" });
  }

  const nextLog = log.slice();
  nextLog[idx] = { ...log[idx], deletedAt: new Date().toISOString() };

  const [sw] = await db.update(networkSwitchesTable)
    .set({ maintenanceLog: nextLog, updatedAt: new Date() })
    .where(eq(networkSwitchesTable.id, id))
    .returning();
  return res.json(withVisibleMaintenanceLog(sw));
});

router.get("/vlans", requireAuth, async (req: any, res) => {
  const { q, building, type } = req.query;
  let vlans;
  if (q) {
    vlans = await db.select().from(vlansTable).where(
      or(
        ilike(vlansTable.name, `%${q}%`),
        ilike(vlansTable.building, `%${q}%`),
        ilike(vlansTable.description, `%${q}%`),
        ilike(vlansTable.subnet, `%${q}%`)
      )
    ).orderBy(vlansTable.vlanId);
  } else {
    const conditions: any[] = [];
    if (building) conditions.push(ilike(vlansTable.building, `%${building}%`));
    if (type) conditions.push(eq(vlansTable.type, type as string));
    vlans = conditions.length > 0
      ? await db.select().from(vlansTable).where(and(...conditions)).orderBy(vlansTable.vlanId)
      : await db.select().from(vlansTable).orderBy(vlansTable.vlanId);
  }
  return res.json(vlans.map(withVisibleMaintenanceLog));
});

router.post("/vlans", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const schema = z.object({
    vlanId: z.number().int(),
    name: z.string().min(1),
    description: z.string().optional(),
    building: z.string().min(1),
    type: z.enum(["data", "voice", "ospf", "management", "security", "other"]),
    subnet: z.string().optional(),
    gateway: z.string().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [vlan] = await db.insert(vlansTable).values(parsed.data).returning();
  await recordInventoryAudit({
    entityType: "vlan",
    entityId: vlan.id,
    entityLabel: `VLAN ${vlan.vlanId} ${vlan.name}`,
    action: "create",
    source: "manual",
    actor: reqActor(req),
    changes: diffFields(null, vlan, VLAN_AUDIT_FIELDS),
  });
  return res.status(201).json(withVisibleMaintenanceLog(vlan));
});

router.post("/vlans/:id/maintenance-log", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const schema = z.object({
    body: z.string().min(1).max(4000),
    windowStart: z.string().datetime().optional().nullable(),
    windowEnd: z.string().datetime().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  const [existing] = await db.select().from(vlansTable).where(eq(vlansTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const entry: MaintenanceLogEntry = {
    id: crypto.randomUUID(),
    body: parsed.data.body,
    authorId: req.user?.id ?? null,
    authorName: req.user?.name ?? req.user?.email ?? "Unknown",
    createdAt: new Date().toISOString(),
    windowStart: parsed.data.windowStart ?? null,
    windowEnd: parsed.data.windowEnd ?? null,
  };

  const log = Array.isArray(existing.maintenanceLog) ? existing.maintenanceLog : [];
  const nextLog = [entry, ...log];

  const [vlan] = await db.update(vlansTable)
    .set({ maintenanceLog: nextLog })
    .where(eq(vlansTable.id, id))
    .returning();
  return res.json(withVisibleMaintenanceLog(vlan));
});

router.patch("/vlans/:id/maintenance-log/:entryId", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const entryId = req.params.entryId;
  if (Number.isNaN(id) || !entryId) return res.status(400).json({ error: "Invalid id" });
  const schema = z.object({
    body: z.string().min(1).max(4000),
    windowStart: z.string().datetime().optional().nullable(),
    windowEnd: z.string().datetime().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  const [existing] = await db.select().from(vlansTable).where(eq(vlansTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const log = Array.isArray(existing.maintenanceLog) ? existing.maintenanceLog : [];
  const idx = log.findIndex((e) => e?.id === entryId);
  if (idx === -1 || log[idx]?.deletedAt) return res.status(404).json({ error: "Entry not found" });

  if (!canEditMaintenanceEntry(req.user, log[idx])) {
    return res.status(403).json({ error: "Not allowed to edit this entry" });
  }

  const updated: MaintenanceLogEntry = {
    ...log[idx],
    body: parsed.data.body,
    windowStart: parsed.data.windowStart ?? null,
    windowEnd: parsed.data.windowEnd ?? null,
    editedAt: new Date().toISOString(),
  };
  const nextLog = log.slice();
  nextLog[idx] = updated;

  const [vlan] = await db.update(vlansTable)
    .set({ maintenanceLog: nextLog })
    .where(eq(vlansTable.id, id))
    .returning();
  return res.json(withVisibleMaintenanceLog(vlan));
});

router.delete("/vlans/:id/maintenance-log/:entryId", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const entryId = req.params.entryId;
  if (Number.isNaN(id) || !entryId) return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db.select().from(vlansTable).where(eq(vlansTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const log = Array.isArray(existing.maintenanceLog) ? existing.maintenanceLog : [];
  const idx = log.findIndex((e) => e?.id === entryId);
  if (idx === -1 || log[idx]?.deletedAt) return res.status(404).json({ error: "Entry not found" });

  if (!canEditMaintenanceEntry(req.user, log[idx])) {
    return res.status(403).json({ error: "Not allowed to delete this entry" });
  }

  const nextLog = log.slice();
  nextLog[idx] = { ...log[idx], deletedAt: new Date().toISOString() };

  const [vlan] = await db.update(vlansTable)
    .set({ maintenanceLog: nextLog })
    .where(eq(vlansTable.id, id))
    .returning();
  return res.json(withVisibleMaintenanceLog(vlan));
});

// ----- FortiGate website whitelist (Network Tool) -----

router.get("/whitelist", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const cfg = getFortiGateConfig();
  if (!cfg) {
    return res.json({ configured: false, host: null, profile: null, entries: [] });
  }
  try {
    const entries = await listWhitelistEntries(cfg);
    return res.json({ configured: true, host: cfg.host, profile: cfg.profile, entries });
  } catch (err: any) {
    req.log.error({ err }, "FortiGate whitelist fetch failed");
    return res.status(502).json({
      error: "FORTIGATE_ERROR",
      message: err instanceof FortiGateError ? err.message : "Failed to read whitelist from FortiGate.",
    });
  }
});

router.post("/whitelist", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const schema = z.object({
    url: z.string().min(1).max(500),
    action: z.enum(["exempt", "allow", "monitor"]).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  const cfg = getFortiGateConfig();
  if (!cfg) {
    return res.status(503).json({
      error: "FORTIGATE_NOT_CONFIGURED",
      message:
        "FortiGate is not configured. Set FORTIGATE_HOST and FORTIGATE_API_TOKEN (optionally FORTIGATE_VDOM, FORTIGATE_WEBFILTER_PROFILE) to enable this tool.",
    });
  }

  let pattern: string;
  try {
    pattern = normalizeUrlPattern(parsed.data.url);
  } catch (err: any) {
    return res.status(400).json({ error: "INVALID_URL", message: err?.message ?? "Invalid URL." });
  }

  const action = parsed.data.action ?? "exempt";
  try {
    const result = await whitelistUrl(cfg, pattern, action);
    req.log.info(
      { url: pattern, action, tableId: result.tableId, added: result.added, by: req.user?.email },
      "FortiGate whitelist add",
    );
    return res.json({
      url: pattern,
      action,
      tableId: result.tableId,
      tableName: result.tableName,
      added: result.added,
    });
  } catch (err: any) {
    req.log.error({ err }, "FortiGate whitelist add failed");
    return res.status(502).json({
      error: "FORTIGATE_ERROR",
      message: err instanceof FortiGateError ? err.message : "Failed to update FortiGate.",
    });
  }
});

// ----- Inventory audit trail & AI change application -----

// Read the audit history for switch/VLAN inventory changes.
router.get("/inventory/audit", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const entityTypeRaw = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
  const entityType = entityTypeRaw === "switch" || entityTypeRaw === "vlan" ? entityTypeRaw : undefined;
  const entityIdRaw = typeof req.query.entityId === "string" ? parseInt(req.query.entityId) : NaN;
  const entityId = Number.isNaN(entityIdRaw) ? undefined : entityIdRaw;
  const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit) : NaN;
  const limit = Number.isNaN(limitRaw) ? 100 : Math.min(Math.max(limitRaw, 1), 500);
  try {
    const rows = await listInventoryAudit({ entityType, entityId, limit });
    return res.json(rows);
  } catch (err: any) {
    console.error("[inventory audit list]", err);
    return res.status(500).json({ error: err?.message || "Failed to load audit history" });
  }
});

// Roll back a prior inventory change to its recorded "from" values.
router.post("/inventory/audit/:id/rollback", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const result = await rollbackInventoryChange(id, reqActor(req));
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json({ ok: true, result: result.result, update: result.update });
  } catch (err: any) {
    console.error("[inventory rollback]", err);
    return res.status(500).json({ error: err?.message || "Rollback failed" });
  }
});

// Apply a pending AI-proposed inventory change (from a preview chat turn).
router.post("/inventory/apply", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const schema = z.object({
    kind: z.enum(["switch", "vlan"]),
    payload: z.record(z.string(), z.any()),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid apply payload" });
  const actor = reqActor(req);
  try {
    if (parsed.data.kind === "switch") {
      const result = await upsertSwitchByHostname(parsed.data.payload as any, { actor, source: "chat_ai" });
      if (!result.ok) return res.status(400).json({ error: result.error });
      return res.json({ ok: true, result: result.result, update: result.update });
    }
    const result = await upsertVlanByVlanId(parsed.data.payload as any, { actor, source: "chat_ai" });
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true, result: result.result, update: result.update });
  } catch (err: any) {
    console.error("[inventory apply]", err);
    return res.status(500).json({ error: err?.message || "Failed to apply change" });
  }
});

// ----- AI Network Engineer chat -----

router.post("/ai-chat", requireAuth, async (req: any, res) => {
  const schema = z.object({
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(8000),
    })).min(1).max(40),
    previewInventory: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid messages payload" });
  }

  if (!isAIConfigured()) {
    return res.status(503).json({ error: "AI service is not configured." });
  }

  try {
    const switches = await db.select().from(networkSwitchesTable).orderBy(networkSwitchesTable.building);
    const vlans = await db.select().from(vlansTable).orderBy(vlansTable.vlanId);

    const buildingsMap = new Map<string, { switches: any[]; vlans: any[] }>();
    for (const s of switches) {
      const b = s.building || "Unassigned";
      if (!buildingsMap.has(b)) buildingsMap.set(b, { switches: [], vlans: [] });
      buildingsMap.get(b)!.switches.push(s);
    }
    for (const v of vlans) {
      const b = v.building || "Unassigned";
      if (!buildingsMap.has(b)) buildingsMap.set(b, { switches: [], vlans: [] });
      buildingsMap.get(b)!.vlans.push(v);
    }

    let inventoryText = "";
    const buildings = Array.from(buildingsMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    for (const [name, { switches: sws, vlans: vls }] of buildings) {
      inventoryText += `\n## ${name}\n`;
      if (sws.length) {
        inventoryText += "Switches:\n";
        for (const s of sws) {
          inventoryText += `  - ${s.hostname} (${s.ipAddress})${s.model ? ` [${s.model}]` : ""}${s.status ? ` status=${s.status}` : ""}${s.location ? ` loc=${s.location}` : ""}${s.notes ? ` — ${s.notes}` : ""}\n`;
        }
      }
      if (vls.length) {
        inventoryText += "VLANs:\n";
        for (const v of vls) {
          inventoryText += `  - VLAN ${v.vlanId} ${v.name} [${v.type}]${v.subnet ? ` ${v.subnet}` : ""}${v.gateway ? ` gw=${v.gateway}` : ""}${v.description ? ` — ${v.description}` : ""}\n`;
        }
      }
    }
    if (!inventoryText.trim()) {
      inventoryText = "(No switches or VLANs have been entered yet.)";
    }

    const RECENT_PER_DEVICE = 3;
    const formatRecentEntries = (log: unknown): string => {
      const entries = visibleMaintenanceLog(log)
        .slice()
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .slice(0, RECENT_PER_DEVICE);
      return entries
        .map((e) => {
          const when = e.createdAt ? e.createdAt.slice(0, 10) : "unknown date";
          const who = e.authorName || "unknown";
          const body = (e.body || "").replace(/\s+/g, " ").trim().slice(0, 280);
          return `    • [${when}] ${who}: ${body}`;
        })
        .join("\n");
    };

    let maintenanceText = "";
    for (const s of switches) {
      const recent = formatRecentEntries(s.maintenanceLog);
      if (recent) {
        maintenanceText += `  ${s.hostname} (${s.ipAddress}):\n${recent}\n`;
      }
    }
    for (const v of vlans) {
      const recent = formatRecentEntries(v.maintenanceLog);
      if (recent) {
        maintenanceText += `  VLAN ${v.vlanId} ${v.name}:\n${recent}\n`;
      }
    }
    if (!maintenanceText.trim()) {
      maintenanceText = "(No maintenance log entries recorded yet.)";
    }

    const knowledgeContext = await getKnowledgeContext();

    const authUser = (req as any).user;
    const identityLine = authUser
      ? `\n\nYou are advising ${authUser.name || authUser.email}${authUser.email ? ` (${authUser.email})` : ""} — role "${authUser.role}"${authUser.jobTitle ? `, ${authUser.jobTitle}` : ""}. You already know who they are; address them by name when natural and attribute their reports to them.`
      : "";

    const systemPrompt = `You are an expert enterprise network engineer with deep experience in campus network design, OSPF, VLAN segmentation, Cisco Nexus, Aruba, FortiGate, and wireless deployments. You work as the network advisor for **Seward County Community College (SCCC)**.${identityLine}

You have direct knowledge of the SCCC campus map (provided as an image in the first user turn). Key context:
- Main campus is laid out around Circle Drive. The Hobble Academic Building (codes A and AA) houses IT and the network core.
- Other main-campus buildings: Humanities (H), Student Union complex (SU/SA/SW), Calvin Allied Health (CAH), Cosmetology (COS), Student Life Center (SLC), Agriculture (V), Industrial Technology campus (T/TA/TB/TD/TT) to the northwest, Sharp Family Champion Center (SFCC), Student Health Center (SHC), Mansions, plus athletic fields (French/softball, Brent Gould/baseball, tennis).
- The network core lives in Hobble: Nexus pair sw-aa144-a48 (192.168.2.70) and sw-aa144-a24 (192.168.2.71), VPC peer-linked. They distribute via OSPF /30 transit links (VLAN 611–628) to building access switches. VLAN 611 reaches the legacy 6509 core; 612 reaches the Industrial Tech Nexus; the rest land at building edge switches.
- Edge platforms are mostly Aruba (CX 6100/6300 family) with a FortiGate handling internet edge (ports 35/36 on the Nexus pair to IDEATEK and United ISP). Two Aruba 7205 wireless controllers terminate on a48 ports 43/44.
- Remote sites (NOT on the campus map): **Epworth** (VLAN 773, 192.168.2.24, fiber/OSPF) and **West** (172.25.x, FortiGate West_FGT, VLAN 910).

Below is the **live network reference data** currently entered in this app (single source of truth — prefer this over your prior knowledge when they conflict):
${inventoryText}

Below is the **recent maintenance log** — the most recent ${RECENT_PER_DEVICE} entries per switch and VLAN (oldest entries omitted). Use this to answer questions about recent changes, who worked on a device, and incident triage:
${maintenanceText}

You also have a persistent memory: the SCCC Environment Knowledge Base below contains institutional and environment-specific knowledge (network design guidance, FortiGate, wireless, Azure, identity, monitoring, procedures). Prefer it over generic IT advice. When the user tells you a durable new fact about the environment (a device, configuration, procedure, contact, or policy) or explicitly asks you to remember something, call the save_memory tool to persist it. Never save secrets or passwords.
${knowledgeContext ? `\n# SCCC Environment Knowledge Base\n${knowledgeContext}\n` : ""}
You can keep the live network inventory current as you talk. When a network administrator reports a real change to a switch (added, replaced, moved to a different building/location, went online/offline, or an IP/model change) or a VLAN (a new VLAN, or a changed subnet/gateway/name/type), call upsert_switch or upsert_vlan so the switch and VLAN reference data stays accurate — match a switch by its hostname and a VLAN by its numeric id, and only send the fields that changed. Only do this for concrete changes the user actually states; never invent inventory. If the user lacks a network-admin role the update will be refused — tell them plainly. After a successful change, confirm what you updated.

Guidelines for your answers:
- Be concise, technical, and direct — you are talking to other IT staff.
- When asked about a building, look it up in the inventory above and identify the building's switches, VLANs, and likely uplink path back to the AA144 Nexus pair.
- When the user asks about the map, refer to the building codes (e.g. "AA144 in Hobble", "TA107 in the Industrial Tech campus").
- When you make assumptions, call them out so the user can correct the underlying data.
- If the data doesn't contain what's needed, say so plainly and suggest what to add to the network reference.
- Use Markdown for structure (headings, bullet lists, fenced code blocks for IPs/CLI).`;

    const userMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    const mapUrl = getCampusMapDataUrl();
    if (mapUrl) {
      userMessages.push({
        role: "user",
        content: [
          { type: "text", text: "For reference throughout this conversation, here is the SCCC main-campus map. Use it to orient any building question." },
          { type: "image_url", image_url: { url: mapUrl } },
        ],
      });
      userMessages.push({
        role: "assistant",
        content: "Got it — I have the SCCC campus map and the live network inventory loaded. Ask me anything about the network.",
      });
    }
    for (const m of parsed.data.messages) {
      userMessages.push({ role: m.role, content: m.content });
    }

    // The CIO's chat does not auto-capture work into their task list unless they
    // explicitly ask; ordinary staff always auto-capture.
    const lastUserMsg = [...parsed.data.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const authRole = req.user?.role ?? null;
    const allowTaskCapture = authRole !== "cio" || messageRequestsCapture(lastUserMsg);

    const { reply: rawReply, savedMemories, createdTasks, networkUpdates, savedShadowNotes, pendingNetworkChanges } =
      await runChatWithMemory(getOpenAI(), {
        model: "gpt-5.2",
        maxCompletionTokens: 2048,
        messages: [
          { role: "system", content: systemPrompt },
          ...userMessages,
        ],
        userId: req.user?.id ?? null,
        userRole: authRole,
        userName: req.user?.name ?? null,
        allowTaskCapture,
        previewInventory: parsed.data.previewInventory === true,
      });

    const reply = rawReply.trim() || "(no response)";
    return res.json({ reply, savedMemories, createdTasks, networkUpdates, savedShadowNotes, pendingNetworkChanges });
  } catch (err: any) {
    console.error("[network ai-chat]", err);
    return res.status(500).json({ error: err?.message || "AI request failed" });
  }
});

// ---- Network diagram layout (shared across team) --------------------------
// Stores the dragged x/y of each React Flow node id so the network visualizer
// remembers manual positioning between visits / users.

router.get("/layout", requireAuth, async (_req, res) => {
  const rows = await db.select().from(networkLayoutPositionsTable);
  return res.json(
    rows.map((r) => ({
      nodeId: r.nodeId,
      x: r.x,
      y: r.y,
      width: r.width ?? null,
      height: r.height ?? null,
      updatedAt: r.updatedAt.toISOString(),
    })),
  );
});

const layoutPutSchema = z.object({
  positions: z
    .array(
      z.object({
        nodeId: z.string().min(1).max(255),
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().optional().nullable(),
        height: z.number().finite().optional().nullable(),
      }),
    )
    .min(1)
    .max(2000),
});

router.put("/layout", requireAuth, async (req: any, res) => {
  const parsed = layoutPutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const userId = req.user?.id ?? null;
  const now = new Date();

  // Honor the advisory edit lock server-side: if another user is actively
  // editing the shared diagram, reject the write so their arrangement isn't
  // clobbered. The client acquires the lock on drag; a stale poll can't slip
  // a conflicting save past this check.
  const lock = await getLockStatus(userId, now);
  if (lock.locked && !lock.heldByMe) {
    return res.status(409).json({
      error: "LAYOUT_LOCKED",
      message: `${lock.lockedByName ?? "Another user"} is currently editing the diagram layout.`,
      lock,
    });
  }

  const values = parsed.data.positions.map((p) => ({
    nodeId: p.nodeId,
    x: p.x,
    y: p.y,
    width: p.width ?? null,
    height: p.height ?? null,
    updatedAt: now,
    updatedBy: userId,
  }));

  await db
    .insert(networkLayoutPositionsTable)
    .values(values)
    .onConflictDoUpdate({
      target: networkLayoutPositionsTable.nodeId,
      set: {
        x: sql`excluded.x`,
        y: sql`excluded.y`,
        width: sql`excluded.width`,
        height: sql`excluded.height`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    });
  return res.json({ saved: values.length });
});

const layoutDeleteSchema = z.object({
  nodeIds: z.array(z.string().min(1)).optional(),
});

router.delete("/layout", requireAuth, requireCIO, async (req: any, res) => {
  const parsed = layoutDeleteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  // Don't let a delete land on top of another user's active arrangement.
  const lock = await getLockStatus(req.user?.id ?? null);
  if (lock.locked && !lock.heldByMe) {
    return res.status(409).json({
      error: "LAYOUT_LOCKED",
      message: `${lock.lockedByName ?? "Another user"} is currently editing the diagram layout.`,
      lock,
    });
  }

  if (parsed.data.nodeIds && parsed.data.nodeIds.length > 0) {
    // Targeted removal of specific nodes (not a full wipe).
    await db
      .delete(networkLayoutPositionsTable)
      .where(inArray(networkLayoutPositionsTable.nodeId, parsed.data.nodeIds));
    return res.json({ ok: true });
  }

  // Full wipe must go through the governed reset path so it is snapshotted,
  // recorded in the change log, and performed transactionally — never a raw
  // unrecoverable delete.
  const result = await resetLayout(reqActor(req));
  return res.json({ ok: true, removed: result.removed, eventId: result.eventId });
});

// ---- Inventory health / data-quality report -------------------------------

const DEFAULT_STALE_DAYS = (() => {
  const raw = parseInt(process.env.INVENTORY_STALE_DAYS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
})();

router.get("/inventory/health", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const q = parseInt(String(req.query.staleDays ?? ""), 10);
  const staleDays = Number.isFinite(q) && q > 0 && q <= 3650 ? q : DEFAULT_STALE_DAYS;
  try {
    const switches = await db.select().from(networkSwitchesTable);
    const vlans = await db.select().from(vlansTable);
    const report = buildInventoryHealth(switches, vlans, { staleDays });
    return res.json(report);
  } catch (err: any) {
    req.log?.error({ err }, "inventory health failed");
    return res.status(500).json({ error: err?.message || "Failed to build inventory health report" });
  }
});

// ---- Shared-layout governance: advisory edit lock + reset change log -------

router.get("/layout/lock", requireAuth, async (req: any, res) => {
  const status = await getLockStatus(req.user?.id ?? null);
  return res.json(status);
});

router.post("/layout/lock", requireAuth, async (req: any, res) => {
  const result = await acquireLock(reqActor(req));
  if (!result.ok) return res.status(409).json(result.status);
  return res.json(result.status);
});

router.delete("/layout/lock", requireAuth, async (req: any, res) => {
  await releaseLock(reqActor(req));
  return res.json({ ok: true });
});

router.get("/layout/events", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
  const rows = await listLayoutEvents(limit);
  return res.json(
    rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorId: r.actorId,
      actorName: r.actorName,
      nodeCount: r.nodeCount,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

const layoutResetSchema = z.object({ confirm: z.literal(true) });

router.post("/layout/reset", requireAuth, requireCIO, async (req: any, res) => {
  const parsed = layoutResetSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Reset must be explicitly confirmed." });
  }
  const result = await resetLayout(reqActor(req));
  return res.json({ ok: true, ...result });
});

router.post("/layout/events/:id/restore", requireAuth, requireCIO, async (req: any, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const result = await restoreLayout(id, reqActor(req));
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ ok: true, restored: result.restored });
});

export default router;
