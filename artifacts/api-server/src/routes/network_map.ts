/**
 * Network Map API — nodes, links, OSPF adjacencies, LLDP import, seed.
 * All writes gated to network admin / CIO roles.
 */
import { Router } from "express";
import { db, netNodesTable, netLinksTable, netRoutingAdjacenciesTable, networkSwitchesTable, networkTelemetryRunsTable } from "@workspace/db";
import { netPortsTable } from "@workspace/db/net_ports";
import { eq, and, or, desc } from "drizzle-orm";
import { requireAuth, requireNetworkAdmin } from "./auth";
import { z } from "zod";
import { isIP } from "node:net";
import crypto from "node:crypto";
import { normalizeNetworkIdentityData, saveNetLinkByIdentity, saveNetNodeByIdentity } from "../lib/network_identity";
import { computeTelemetryPortDelta } from "../lib/network_telemetry_delta";

const router = Router();

// ──────────────────────────────────────────────────────────────
// Validation schemas
// ──────────────────────────────────────────────────────────────

const nodeKinds = ["switch", "firewall", "router", "server", "svi", "patch_panel", "isp", "other"] as const;
const nodeRoles = ["core", "distribution", "access", "edge", "firewall", "controller", "svi"] as const;
const criticalities = ["critical", "high", "medium", "low"] as const;
const statuses = ["online", "offline", "unknown"] as const;

const nodeCreateSchema = z.object({
  hostname: z.string().min(1).max(80),
  displayName: z.string().min(1).max(120),
  nodeKind: z.enum(nodeKinds),
  vendor: z.string().max(20).optional().nullable(),
  model: z.string().max(80).optional().nullable(),
  mgmtIp: z.string().max(45).optional().nullable(),
  building: z.string().min(1).max(80),
  location: z.string().max(120).optional().nullable(),
  role: z.enum(nodeRoles),
  function: z.string().max(30).optional().nullable(),
  criticality: z.enum(criticalities).optional().default("medium"),
  tags: z.array(z.string()).optional().nullable(),
  status: z.enum(statuses).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const nodeUpdateSchema = nodeCreateSchema.partial();

const linkKinds = ["fiber", "dac", "copper", "wireless", "vpn", "virtual", "unknown"] as const;
const confidences = ["confirmed_lldp", "confirmed_cdp", "confirmed_manual", "inferred", "stale"] as const;
const portModes = ["trunk", "access", "routed", "peerlink", "heartbeat", "unknown"] as const;

const linkCreateSchema = z.object({
  aNodeId: z.string().uuid(),
  aPort: z.string().min(1).max(40),
  bNodeId: z.string().uuid(),
  bPort: z.string().min(1).max(40),
  linkKind: z.enum(linkKinds),
  speedMbps: z.number().int().optional().nullable(),
  portMode: z.enum(portModes).optional().nullable(),
  nativeVlan: z.number().int().optional().nullable(),
  allowedVlans: z.array(z.number().int()).optional().nullable(),
  portchannel: z.string().max(20).optional().nullable(),
  lldpPeerHostname: z.string().max(80).optional().nullable(),
  lldpPeerMgmtIp: z.string().max(45).optional().nullable(),
  confidence: z.enum(confidences),
  lastVerifiedAt: z.string().datetime(),
  evidenceRef: z.string().max(200).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const linkUpdateSchema = linkCreateSchema.partial();

const ospfProtocols = ["ospf", "bgp", "static"] as const;
const ospfStates = ["FULL", "DOWN", "INIT", "2WAY", "EXSTART", "EXCHANGE", "LOADING", "ATTEMPT"] as const;

const adjCreateSchema = z.object({
  deviceNodeId: z.string().uuid(),
  protocol: z.enum(ospfProtocols),
  process: z.string().max(20).optional().nullable(),
  area: z.string().max(16).optional().nullable(),
  localInterface: z.string().min(1).max(40),
  localIp: z.string().max(45).optional().nullable(),
  peerRouterId: z.string().max(45).optional().nullable(),
  peerIp: z.string().max(45).optional().nullable(),
  state: z.string().max(10),
  lastSeenAt: z.string().datetime(),
  evidenceRef: z.string().max(200).optional().nullable(),
  notes: z.string().optional().nullable(),
});

// ──────────────────────────────────────────────────────────────
// Nodes
// ──────────────────────────────────────────────────────────────

router.get("/nodes", requireAuth, async (req: any, res) => {
  const { q, building, role, kind } = req.query;
  let nodes = await db.select().from(netNodesTable);

  if (q) {
    const lq = (q as string).toLowerCase();
    nodes = nodes.filter(
      (n) =>
        n.hostname.toLowerCase().includes(lq) ||
        n.displayName.toLowerCase().includes(lq) ||
        (n.mgmtIp ?? "").includes(lq) ||
        n.building.toLowerCase().includes(lq),
    );
  }
  if (building) nodes = nodes.filter((n) => n.building.toLowerCase().includes((building as string).toLowerCase()));
  if (role) nodes = nodes.filter((n) => n.role === role);
  if (kind) nodes = nodes.filter((n) => n.nodeKind === kind);

  nodes.sort((a, b) => a.building.localeCompare(b.building) || a.hostname.localeCompare(b.hostname));
  return res.json(nodes);
});

router.post("/nodes", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = nodeCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const result = await saveNetNodeByIdentity(parsed.data);
  return res.status(result.action === "created" ? 201 : 200).json(result.row);
});

router.patch("/nodes/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = nodeUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [existing] = await db.select().from(netNodesTable).where(eq(netNodesTable.id, req.params.id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const result = await saveNetNodeByIdentity({
    hostname: parsed.data.hostname ?? existing.hostname,
    displayName: parsed.data.displayName ?? existing.displayName,
    nodeKind: parsed.data.nodeKind ?? existing.nodeKind,
    vendor: parsed.data.vendor ?? existing.vendor,
    model: parsed.data.model ?? existing.model,
    mgmtIp: parsed.data.mgmtIp ?? existing.mgmtIp,
    building: parsed.data.building ?? existing.building,
    location: parsed.data.location ?? existing.location,
    role: parsed.data.role ?? existing.role,
    function: parsed.data.function ?? existing.function,
    criticality: parsed.data.criticality ?? existing.criticality,
    tags: parsed.data.tags ?? existing.tags,
    status: parsed.data.status ?? existing.status,
    notes: parsed.data.notes ?? existing.notes,
  }, existing.id);
  return res.json(result.row);
});

router.delete("/nodes/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const [node] = await db
    .delete(netNodesTable)
    .where(eq(netNodesTable.id, req.params.id))
    .returning();
  if (!node) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────
// Links
// ──────────────────────────────────────────────────────────────

router.get("/links", requireAuth, async (req: any, res) => {
  const { nodeId } = req.query;
  let links = await db.select().from(netLinksTable);
  if (nodeId) {
    links = links.filter((l) => l.aNodeId === nodeId || l.bNodeId === nodeId);
  }
  // Stale: mark links not verified in 90 days
  const staleThreshold = Date.now() - 90 * 24 * 60 * 60 * 1000;
  links = links.map((l) => ({
    ...l,
    isStale: new Date(l.lastVerifiedAt).getTime() < staleThreshold,
  })) as typeof links;
  return res.json(links);
});

router.post("/links", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = linkCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const result = await saveNetLinkByIdentity(parsed.data);
  return res.status(result.action === "created" ? 201 : 200).json(result.row);
});

router.patch("/links/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = linkUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [existing] = await db.select().from(netLinksTable).where(eq(netLinksTable.id, req.params.id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const result = await saveNetLinkByIdentity({
    aNodeId: parsed.data.aNodeId ?? existing.aNodeId,
    aPort: parsed.data.aPort ?? existing.aPort,
    bNodeId: parsed.data.bNodeId ?? existing.bNodeId,
    bPort: parsed.data.bPort ?? existing.bPort,
    linkKind: parsed.data.linkKind ?? existing.linkKind,
    speedMbps: parsed.data.speedMbps ?? existing.speedMbps,
    portMode: parsed.data.portMode ?? existing.portMode,
    nativeVlan: parsed.data.nativeVlan ?? existing.nativeVlan,
    allowedVlans: parsed.data.allowedVlans ?? existing.allowedVlans,
    portchannel: parsed.data.portchannel ?? existing.portchannel,
    lldpPeerHostname: parsed.data.lldpPeerHostname ?? existing.lldpPeerHostname,
    lldpPeerMgmtIp: parsed.data.lldpPeerMgmtIp ?? existing.lldpPeerMgmtIp,
    confidence: parsed.data.confidence ?? existing.confidence,
    lastVerifiedAt: parsed.data.lastVerifiedAt ?? existing.lastVerifiedAt,
    evidenceRef: parsed.data.evidenceRef ?? existing.evidenceRef,
    notes: parsed.data.notes ?? existing.notes,
  }, existing.id);
  return res.json(result.row);
});

router.delete("/links/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const [link] = await db
    .delete(netLinksTable)
    .where(eq(netLinksTable.id, req.params.id))
    .returning();
  if (!link) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────
// Port inventory — merged configuration + live SNMP telemetry
// ──────────────────────────────────────────────────────────────

router.get("/ports", requireAuth, async (req: any, res) => {
  const nodeId = String(req.query.nodeId ?? "").trim();
  if (!z.string().uuid().safeParse(nodeId).success) {
    return res.status(400).json({ error: "A valid nodeId is required" });
  }
  const ports = await db.select().from(netPortsTable).where(eq(netPortsTable.nodeId, nodeId));
  ports.sort((a, b) => {
    if (a.ifIndex != null && b.ifIndex != null && a.ifIndex !== b.ifIndex) return a.ifIndex - b.ifIndex;
    return a.interfaceName.localeCompare(b.interfaceName, undefined, { numeric: true });
  });
  return res.json(ports);
});

// ──────────────────────────────────────────────────────────────
// SSH collector telemetry import — one compact switch per request
// ──────────────────────────────────────────────────────────────

function telemetryServiceAuthorized(req: any): boolean {
  const expected = process.env.NOC_PROBE_TOKEN?.trim();
  const supplied = String(req.headers.authorization ?? "");
  const remoteAddress = String(req.socket?.remoteAddress ?? "").replace(/^::ffff:/, "");
  if (!expected || remoteAddress !== "10.0.0.22") return false;
  const expectedHeader = Buffer.from(`Bearer ${expected}`);
  const suppliedHeader = Buffer.from(supplied);
  return expectedHeader.length === suppliedHeader.length
    && crypto.timingSafeEqual(expectedHeader, suppliedHeader);
}

async function requireTelemetryImporter(req: any, res: any, next: any) {
  if (telemetryServiceAuthorized(req)) {
    req.telemetryService = "10.0.0.22";
    return next();
  }
  return requireAuth(req, res, () => requireNetworkAdmin(req, res, next));
}

const telemetryInterfaceSchema = z.object({
  port: z.string().min(1).max(80),
  description: z.string().max(255).optional().nullable(),
  name: z.string().max(255).optional().nullable(),
  admin_status: z.string().max(20).optional().nullable(),
  oper_status: z.string().max(20).optional().nullable(),
  status: z.string().max(30).optional().nullable(),
  reason: z.string().max(120).optional().nullable(),
  mode: z.string().max(20).optional().nullable(),
  native_vlan: z.number().int().optional().nullable(),
  vlan: z.union([z.string(), z.number()]).optional().nullable(),
  duplex: z.string().max(20).optional().nullable(),
  speed_mbps: z.number().int().nonnegative().optional().nullable(),
  speed: z.string().max(30).optional().nullable(),
  media_type: z.string().max(80).optional().nullable(),
  type: z.string().max(80).optional().nullable(),
  is_physical: z.boolean().optional(),
});

const telemetryNeighborSchema = z.object({
  local_port: z.string().max(80).optional().nullable(),
  system_name: z.string().max(160).optional().nullable(),
  management_addresses: z.array(z.string().max(80)).optional().default([]),
  port_id: z.string().max(80).optional().nullable(),
  chassis_id: z.string().max(160).optional().nullable(),
});

const telemetryImportSchema = z.object({
  schema: z.literal("sccc.network.switchport_telemetry.v1"),
  runId: z.string().min(1).max(100),
  generatedAt: z.string().datetime({ offset: true }),
  collectionScope: z.enum(["full", "partial"]).default("partial"),
  targetIps: z.array(z.string().max(45)).max(500).default([]),
  dryRun: z.boolean().optional().default(true),
  switch: z.object({
    switch_name: z.string().min(1).max(160),
    switch_ip: z.string().min(1).max(45),
    building: z.string().min(1).max(80).optional().nullable(),
    device_type: z.string().max(40).optional().nullable(),
    device: z.object({
      hostname: z.string().max(160).optional().nullable(),
      vendor: z.string().max(40).optional().nullable(),
      model: z.string().max(255).optional().nullable(),
      models: z.array(z.string().max(120)).optional().default([]),
      serial_numbers: z.array(z.string().max(120)).optional().default([]),
      os_version: z.string().max(120).optional().nullable(),
    }).optional().nullable(),
    polled_at: z.string().datetime({ offset: true }),
    interfaces: z.array(telemetryInterfaceSchema).max(2000),
    lldp_neighbors: z.array(telemetryNeighborSchema).max(5000).optional().default([]),
    mac_counts: z.array(z.object({
      port: z.string().min(1).max(80),
      count: z.number().int().nonnegative(),
    })).max(2000).optional().default([]),
  }),
});

function telemetryHostname(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase().replace(/\.sccc\.edu$/i, "");
}

function telemetryPort(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^gigabitethernet/, "gi")
    .replace(/^fastethernet/, "fa")
    .replace(/^tengigabitethernet/, "te")
    .replace(/^ethernet/, "eth");
}

function looksPhysicalTelemetryPort(raw: string): boolean {
  return /^(?:\d+(?:\/\d+){2,3}(?::\d+)?|\d+|(?:eth(?:ernet)?|fa(?:stethernet)?|gi(?:gabitethernet)?|te(?:ngigabitethernet)?|twe(?:ntyfivegige)?|fo(?:rtygigabitethernet)?|hu(?:ndredgige)?|twogigabitethernet)\d+(?:\/\d+){1,3}(?::\d+)?)$/i.test(raw.trim());
}

function telemetryInteger(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

function telemetrySpeed(value: string | null | undefined): number | null {
  const text = String(value ?? "").trim().toLowerCase().replace(/^a-/, "");
  const match = text.match(/^(\d+(?:\.\d+)?)([kmgt]?)/);
  if (!match || ["auto", "--", "unknown"].includes(text)) return null;
  const unit = match[2].trim();
  const scale = unit === "t" ? 1_000_000 : unit === "g" ? 1000 : unit === "k" ? 0.001 : 1;
  return Math.round(Number(match[1]) * scale);
}

function telemetryOperStatus(value: string | null | undefined): string | null {
  const status = String(value ?? "").trim().toLowerCase();
  if (!status) return null;
  return status === "up" || status === "connected" ? "up" : "down";
}

function telemetryVendor(deviceType: string | null | undefined): string | null {
  const value = String(deviceType ?? "").toLowerCase();
  if (value.includes("aruba")) return "Aruba";
  if (value.includes("cisco")) return "Cisco";
  return null;
}

function telemetryLinkKind(mediaType: string | null | undefined): "fiber" | "dac" | "copper" | "unknown" {
  const value = String(mediaType ?? "").toLowerCase();
  if (/cu|dac|twinax/.test(value)) return "dac";
  if (/sfp|qsfp|lr|sr|sx|lx|fiber|optical/.test(value)) return "fiber";
  if (/base-?t|smart.?rate|rj-?45|copper/.test(value)) return "copper";
  return "unknown";
}

const telemetryRunSchema = z.object({
  runId: z.string().min(1).max(100),
  generatedAt: z.string().datetime({ offset: true }),
  sourceRecords: z.number().int().nonnegative(),
  successfulRecords: z.number().int().nonnegative(),
  failedRecords: z.number().int().nonnegative(),
  appliedSwitches: z.number().int().nonnegative(),
  physicalPorts: z.number().int().nonnegative(),
  deviceDeltas: z.array(z.object({
    hostname: z.string().max(160), managementIp: z.string().max(45),
    downToUp: z.number().int().nonnegative(), upToDown: z.number().int().nonnegative(),
    adminChanges: z.number().int().nonnegative(), vlanChanges: z.number().int().nonnegative(),
    descriptionChanges: z.number().int().nonnegative(), portsAdded: z.number().int().nonnegative(),
    portsMissing: z.number().int().nonnegative(),
    changes: z.array(z.object({ port: z.string().max(80), kind: z.enum(["oper", "admin", "native_vlan", "description", "added", "missing"]), before: z.union([z.string(), z.number(), z.null()]), after: z.union([z.string(), z.number(), z.null()]) })).max(5000),
  })).max(500),
  failures: z.array(z.object({ hostname: z.string().max(160), managementIp: z.string().max(45), error: z.string().max(500) })).max(500),
});

router.get("/telemetry-runs/latest", requireAuth, async (_req, res) => {
  const [latest] = await db.select().from(networkTelemetryRunsTable).orderBy(desc(networkTelemetryRunsTable.importedAt)).limit(1);
  return res.json(latest ?? null);
});

router.post("/telemetry-runs", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = telemetryRunSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const data = parsed.data;
  const sum = (field: keyof (typeof data.deviceDeltas)[number]) => data.deviceDeltas.reduce((total, row) => total + Number(row[field] ?? 0), 0);
  const changedDevices = data.deviceDeltas.filter((row) => row.changes.length > 0).length;
  const values = {
    runId: data.runId, generatedAt: new Date(data.generatedAt), collectionScope: data.collectionScope,
    targetIps: data.targetIps, sourceRecords: data.sourceRecords,
    successfulRecords: data.successfulRecords, failedRecords: data.failedRecords, appliedSwitches: data.appliedSwitches,
    physicalPorts: data.physicalPorts, downToUp: sum("downToUp"), upToDown: sum("upToDown"),
    adminChanges: sum("adminChanges"), vlanChanges: sum("vlanChanges"), descriptionChanges: sum("descriptionChanges"),
    portsAdded: sum("portsAdded"), portsMissing: sum("portsMissing"), changedDevices,
    deviceDeltas: data.deviceDeltas, failures: data.failures,
    actorId: req.user?.id ?? null, actorName: req.user?.name ?? req.user?.email ?? "Network administrator",
    importedAt: new Date(),
  };
  const [row] = await db.insert(networkTelemetryRunsTable).values(values).onConflictDoUpdate({
    target: networkTelemetryRunsTable.runId, set: values,
  }).returning();
  return res.json(row);
});

router.post("/import/telemetry/switch", requireTelemetryImporter, async (req: any, res) => {
  const parsed = telemetryImportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  }

  const { dryRun, runId, switch: telemetry } = parsed.data;
  const sourceHostname = telemetryHostname(telemetry.switch_name);
  const collectedModel = telemetry.device?.model?.slice(0, 80) ?? null;
  const polledAt = new Date(telemetry.polled_at);
  const allNodes = await db.select().from(netNodesTable);
  const allInventory = await db.select().from(networkSwitchesTable);

  const nodeByIp = allNodes.find((node) => node.mgmtIp === telemetry.switch_ip);
  const nodeByName = allNodes.find((node) => telemetryHostname(node.hostname) === sourceHostname);
  const inventoryByIp = allInventory.find((sw) => sw.ipAddress === telemetry.switch_ip);
  const inventoryByName = allInventory.find((sw) => telemetryHostname(sw.hostname) === sourceHostname);
  const preliminaryInventory = inventoryByIp ?? inventoryByName ?? null;
  const inventoryNode = preliminaryInventory
    ? allNodes.find((node) => telemetryHostname(node.hostname) === telemetryHostname(preliminaryInventory.hostname))
    : null;

  if (nodeByIp && nodeByName && nodeByIp.id !== nodeByName.id) {
    return res.status(409).json({
      error: "IDENTITY_CONFLICT",
      message: `${telemetry.switch_ip} resolves to ${nodeByIp.hostname}, while ${sourceHostname} resolves to a different node.`,
      sourceHostname,
      switchIp: telemetry.switch_ip,
    });
  }

  let sourceNode = nodeByIp ?? nodeByName ?? inventoryNode ?? null;
  // Once a node is known, its current management IP is authoritative over an
  // alternate/SVI collector target or a duplicate inventory row.
  const inventory = (
    sourceNode?.mgmtIp
      ? allInventory.find((sw) => sw.ipAddress === sourceNode!.mgmtIp)
      : null
  ) ?? preliminaryInventory;
  if (/svi/i.test(sourceHostname) || sourceNode?.nodeKind === "svi" || sourceNode?.role === "svi") {
    const aliasPreview = {
      dryRun,
      skipped: !sourceNode,
      metadataOnly: Boolean(sourceNode),
      reason: sourceNode ? "SVI_METADATA_ONLY" : "SVI_ALIAS_UNMATCHED",
      sourceHostname,
      switchIp: telemetry.switch_ip,
      matchedNodeId: sourceNode?.id ?? null,
      matchedNodeHostname: sourceNode?.hostname ?? inventory?.hostname ?? null,
      matchedNodeMgmtIp: sourceNode?.mgmtIp ?? inventory?.ipAddress ?? null,
      building: telemetry.building ?? sourceNode?.building ?? inventory?.building ?? null,
      nodeWillBeCreated: false,
      physicalInterfaces: 0,
      logicalInterfacesIgnored: telemetry.interfaces.length,
      lldpNeighborsSeen: telemetry.lldp_neighbors.length,
      infrastructureNeighborsResolved: 0,
      endpointNeighborsIgnored: telemetry.lldp_neighbors.length,
      linksUpserted: 0,
    };
    if (dryRun || !sourceNode) return res.json(aliasPreview);

    await db.update(netNodesTable).set({
      status: "online",
      building: telemetry.building ?? sourceNode.building,
      updatedAt: new Date(),
    }).where(eq(netNodesTable.id, sourceNode.id));
    if (inventory) {
      await db.update(networkSwitchesTable).set({
        status: "online",
        building: telemetry.building ?? inventory.building,
        lastSeen: polledAt,
        updatedAt: new Date(),
      }).where(eq(networkSwitchesTable.id, inventory.id));
    }
    return res.json({ ...aliasPreview, dryRun: false });
  }

  if (!sourceNode && !inventory) {
    return res.status(422).json({
      error: "UNMATCHED_SWITCH",
      message: "No Network Map node or switch-inventory row matches this hostname or management IP.",
      sourceHostname,
      switchIp: telemetry.switch_ip,
    });
  }

  const physicalInterfaces = telemetry.interfaces.filter(
    (iface) => iface.is_physical === true || (iface.is_physical !== false && looksPhysicalTelemetryPort(iface.port)),
  );
  if (physicalInterfaces.length === 0) {
    return res.status(422).json({
      error: "NO_PHYSICAL_INTERFACES",
      message: "The collector record contains no physical interfaces; existing port data was not changed.",
      sourceHostname,
      switchIp: telemetry.switch_ip,
    });
  }

  const macCounts = new Map(telemetry.mac_counts.map((entry) => [telemetryPort(entry.port), entry.count]));
  const lldpCounts = new Map<string, number>();
  for (const neighbor of telemetry.lldp_neighbors) {
    const localPort = telemetryPort(neighbor.local_port);
    if (localPort) lldpCounts.set(localPort, (lldpCounts.get(localPort) ?? 0) + 1);
  }

  const nodeCandidates = [...allNodes];
  const resolveNeighbor = (neighbor: z.infer<typeof telemetryNeighborSchema>) => {
    for (const address of neighbor.management_addresses) {
      if (isIP(address)) {
        const byIp = nodeCandidates.find((node) => node.mgmtIp === address);
        if (byIp) return byIp;
      }
    }
    if (neighbor.system_name) {
      const hostname = telemetryHostname(neighbor.system_name);
      return nodeCandidates.find((node) => telemetryHostname(node.hostname) === hostname) ?? null;
    }
    return null;
  };
  const resolvedNeighbors = telemetry.lldp_neighbors.filter(
    (neighbor) => neighbor.local_port && neighbor.port_id && resolveNeighbor(neighbor),
  );

  const existingPorts = sourceNode
    ? await db.select().from(netPortsTable).where(eq(netPortsTable.nodeId, sourceNode.id))
    : [];
  const delta = computeTelemetryPortDelta(existingPorts, physicalInterfaces.map((iface) => ({
    interfaceName: iface.port,
    operStatus: iface.oper_status ?? telemetryOperStatus(iface.status),
    adminStatus: iface.admin_status && iface.admin_status !== "unknown" ? iface.admin_status : null,
    nativeVlan: iface.native_vlan ?? telemetryInteger(iface.vlan),
    description: (iface.description ?? iface.name ?? "").trim() || null,
  })));
  const preview = {
    dryRun,
    skipped: false,
    metadataOnly: false,
    sourceHostname,
    switchIp: telemetry.switch_ip,
    matchedNodeId: sourceNode?.id ?? null,
    matchedNodeHostname: sourceNode?.hostname ?? inventory?.hostname ?? null,
    matchedNodeMgmtIp: sourceNode?.mgmtIp ?? inventory?.ipAddress ?? null,
    building: telemetry.building ?? sourceNode?.building ?? inventory?.building ?? null,
    nodeWillBeCreated: !sourceNode,
    physicalInterfaces: physicalInterfaces.length,
    logicalInterfacesIgnored: telemetry.interfaces.length - physicalInterfaces.length,
    lldpNeighborsSeen: telemetry.lldp_neighbors.length,
    infrastructureNeighborsResolved: resolvedNeighbors.length,
    endpointNeighborsIgnored: telemetry.lldp_neighbors.length - resolvedNeighbors.length,
    linksUpserted: 0,
    delta,
  };
  if (dryRun) return res.json(preview);

  if (!sourceNode) {
    const result = await saveNetNodeByIdentity({
      hostname: inventory!.hostname,
      displayName: inventory!.hostname,
      nodeKind: "switch",
      vendor: telemetry.device?.vendor ?? telemetryVendor(telemetry.device_type),
      model: collectedModel ?? inventory!.model?.slice(0, 80) ?? null,
      mgmtIp: inventory!.ipAddress,
      building: telemetry.building ?? inventory!.building,
      location: inventory!.location ?? null,
      role: "access",
      criticality: "medium",
      status: "online",
      notes: inventory!.notes ?? null,
    });
    sourceNode = result.row;
    nodeCandidates.push(sourceNode);
  }

  const nodeUpdates: Record<string, unknown> = { status: "online", updatedAt: new Date() };
  if (inventory) {
    nodeUpdates.displayName = inventory.hostname;
    nodeUpdates.building = telemetry.building ?? inventory.building;
    nodeUpdates.model = collectedModel ?? inventory.model?.slice(0, 80) ?? sourceNode.model;
    nodeUpdates.location = inventory.location ?? sourceNode.location;
    nodeUpdates.mgmtIp = sourceNode.mgmtIp && sourceNode.mgmtIp !== "0.0.0.0"
      ? sourceNode.mgmtIp
      : inventory.ipAddress;
  } else if (!sourceNode.mgmtIp || sourceNode.mgmtIp === "0.0.0.0") {
    nodeUpdates.mgmtIp = telemetry.switch_ip;
  }
  if (!sourceNode.vendor || telemetry.device?.vendor) {
    nodeUpdates.vendor = telemetry.device?.vendor ?? telemetryVendor(telemetry.device_type);
  }
  if (telemetry.building) nodeUpdates.building = telemetry.building;
  if (collectedModel) nodeUpdates.model = collectedModel;
  await db.update(netNodesTable).set(nodeUpdates).where(eq(netNodesTable.id, sourceNode.id));

  if (inventory) {
    await db.update(networkSwitchesTable).set({
      status: "online",
      building: telemetry.building ?? inventory.building,
      model: telemetry.device?.model ?? inventory.model,
      lastSeen: polledAt,
      updatedAt: new Date(),
    }).where(eq(networkSwitchesTable.id, inventory.id));
  }

  for (const iface of physicalInterfaces) {
    const adminStatus = iface.admin_status && iface.admin_status !== "unknown" ? iface.admin_status : null;
    const operStatus = iface.oper_status ?? telemetryOperStatus(iface.status);
    const nativeVlan = iface.native_vlan ?? telemetryInteger(iface.vlan);
    const speedMbps = iface.speed_mbps ?? telemetrySpeed(iface.speed);
    const mediaType = iface.media_type ?? iface.type ?? null;
    const description = (iface.description ?? iface.name ?? "").trim() || null;
    const portMode = iface.mode && ["trunk", "access", "routed", "peerlink", "heartbeat", "unknown"].includes(iface.mode)
      ? iface.mode
      : null;
    const values: any = {
      nodeId: sourceNode.id,
      interfaceName: iface.port.trim(),
      isPhysical: true,
      description,
      adminStatus,
      operStatus,
      statusReason: iface.reason ?? null,
      speedMbps,
      duplex: iface.duplex ?? null,
      mediaType,
      portMode,
      nativeVlan,
      macCount: macCounts.get(telemetryPort(iface.port)) ?? 0,
      lldpNeighborCount: lldpCounts.get(telemetryPort(iface.port)) ?? 0,
      telemetryEvidence: `collector:${runId}:${sourceHostname}`,
      telemetryUpdatedAt: polledAt,
      updatedAt: new Date(),
    };
    const updates: any = {
      isPhysical: true,
      operStatus,
      statusReason: iface.reason ?? null,
      speedMbps,
      duplex: iface.duplex ?? null,
      mediaType,
      macCount: values.macCount,
      lldpNeighborCount: values.lldpNeighborCount,
      telemetryEvidence: values.telemetryEvidence,
      telemetryUpdatedAt: polledAt,
      updatedAt: new Date(),
    };
    if (description) updates.description = description;
    if (adminStatus) updates.adminStatus = adminStatus;
    if (portMode) updates.portMode = portMode;
    if (nativeVlan != null) updates.nativeVlan = nativeVlan;
    await db.insert(netPortsTable).values(values).onConflictDoUpdate({
      target: [netPortsTable.nodeId, netPortsTable.interfaceName],
      set: updates,
    });
  }

  const interfaceByPort = new Map(physicalInterfaces.map((iface) => [telemetryPort(iface.port), iface]));
  for (const neighbor of telemetry.lldp_neighbors) {
    if (!neighbor.local_port || !neighbor.port_id) continue;
    const neighborNode = resolveNeighbor(neighbor);
    if (!neighborNode || neighborNode.id === sourceNode.id) continue;
    const localInterface = interfaceByPort.get(telemetryPort(neighbor.local_port));
    await saveNetLinkByIdentity({
      aNodeId: sourceNode.id,
      aPort: neighbor.local_port,
      bNodeId: neighborNode.id,
      bPort: neighbor.port_id,
      linkKind: telemetryLinkKind(localInterface?.media_type ?? localInterface?.type),
      speedMbps: localInterface?.speed_mbps ?? telemetrySpeed(localInterface?.speed),
      portMode: localInterface?.mode && ["trunk", "access", "routed", "peerlink", "heartbeat", "unknown"].includes(localInterface.mode)
        ? localInterface.mode
        : null,
      nativeVlan: localInterface?.native_vlan ?? telemetryInteger(localInterface?.vlan),
      confidence: "confirmed_lldp",
      lastVerifiedAt: polledAt,
      evidenceRef: `collector:${runId}`,
      lldpPeerHostname: neighbor.system_name ? telemetryHostname(neighbor.system_name) : neighborNode.hostname,
      lldpPeerMgmtIp: neighbor.management_addresses.find((address) => isIP(address)) ?? neighborNode.mgmtIp,
    });
    preview.linksUpserted++;
  }

  return res.json({ ...preview, dryRun: false, matchedNodeId: sourceNode.id });
});

// ──────────────────────────────────────────────────────────────
// OSPF / routing adjacencies
// ──────────────────────────────────────────────────────────────

router.get("/ospf", requireAuth, async (req: any, res) => {
  const adjs = await db.select().from(netRoutingAdjacenciesTable);
  return res.json(adjs);
});

router.post("/ospf", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = adjCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [adj] = await db
    .insert(netRoutingAdjacenciesTable)
    .values({ ...parsed.data, lastSeenAt: new Date(parsed.data.lastSeenAt) })
    .returning();
  return res.status(201).json(adj);
});

router.delete("/ospf/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const [adj] = await db
    .delete(netRoutingAdjacenciesTable)
    .where(eq(netRoutingAdjacenciesTable.id, req.params.id))
    .returning();
  if (!adj) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────
// LLDP import — NX-OS parser
// ──────────────────────────────────────────────────────────────

const lldpImportSchema = z.object({
  sourceDeviceHostname: z.string().min(1),
  capturedAt: z.string().datetime(),
  evidenceRef: z.string().max(200).optional(),
  rawText: z.string().min(1),
});

interface LldpNeighbor {
  localPort: string;
  systemName: string;
  mgmtAddress: string | null;
  remotePort: string;
  systemDescription: string | null;
}

/**
 * Parse NX-OS "show lldp neighbors detail" output into structured neighbors.
 * Handles the block-per-neighbor format used on Nexus 9000 series.
 */
/** Strip trailing prompt chars, domain suffix, and whitespace from any hostname */
function canonHostname(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.sccc\.edu$/i, "")   // drop domain
    .replace(/[#>()\s]+$/, "")      // strip trailing prompt junk: # > ( ) spaces
    .trim();
}

function parseNxosLldp(raw: string): LldpNeighbor[] {
  const neighbors: LldpNeighbor[] = [];

  // Split on the separator line that NX-OS puts between neighbor blocks
  const blocks = raw.split(/[-]{20,}/);

  for (const block of blocks) {
    if (!block.trim()) continue;

    const localPortMatch  = block.match(/Local Port id:\s*(\S+)/i);
    const systemNameMatch = block.match(/System Name:\s*(\S+)/i);
    const mgmtAddrMatch   = block.match(/Management Address[^:]*:\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i);
    // BUG FIX: match "Port id:" only at start of a line, NOT as part of "Local Port id:"
    const remotePortMatch = block.match(/^[\t ]*Port id:\s*(\S+)/im);
    const sysDescMatch    = block.match(/System Description:\s*(.+)/i);

    if (!localPortMatch || !systemNameMatch || !remotePortMatch) continue;

    neighbors.push({
      localPort:         localPortMatch[1].trim(),
      systemName:        canonHostname(systemNameMatch[1]),
      mgmtAddress:       mgmtAddrMatch ? mgmtAddrMatch[1].trim() : null,
      remotePort:        remotePortMatch[1].trim(),
      systemDescription: sysDescMatch ? sysDescMatch[1].trim().slice(0, 200) : null,
    });
  }

  // Also handle Aruba format: "Interface: eth1/X, via LLDP, ..."
  // The Aruba format has "System Name" too, so the above block parsing handles it
  // when block boundaries are found. As a fallback, try line-by-line for Aruba:
  if (neighbors.length === 0) {
    const lines = raw.split("\n");
    let current: Partial<LldpNeighbor> = {};
    for (const line of lines) {
      const localM = line.match(/^\s*Interface:\s*(\S+)/i);
      const sysNameM = line.match(/^\s*System Name[:\s]+(\S+)/i);
      const portIdM = line.match(/^\s*Port ID[:\s]+(\S+)/i);
      const mgmtM = line.match(/^\s*(?:IPv4 )?Management Address[:\s]+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i);

      if (localM) {
        if (current.localPort && current.systemName && current.remotePort) {
          neighbors.push(current as LldpNeighbor);
        }
        current = { localPort: localM[1].trim(), mgmtAddress: null, systemDescription: null };
      }
      if (sysNameM) current.systemName = canonHostname(sysNameM[1]);
      if (portIdM && !current.remotePort) current.remotePort = portIdM[1].trim();
      if (mgmtM) current.mgmtAddress = mgmtM[1].trim();
    }
    if (current.localPort && current.systemName && current.remotePort) {
      neighbors.push(current as LldpNeighbor);
    }
  }

  return neighbors;
}

router.post("/import/lldp", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = lldpImportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });

  const { sourceDeviceHostname, capturedAt, evidenceRef, rawText } = parsed.data;
  const capturedDate = new Date(capturedAt);
  const srcHostname = canonHostname(sourceDeviceHostname);

  // Resolve or create the source device node
  let [srcNode] = await db
    .select()
    .from(netNodesTable)
    .where(eq(netNodesTable.hostname, srcHostname));

  if (!srcNode) {
    const created = await saveNetNodeByIdentity({
      hostname: srcHostname,
      displayName: srcHostname,
      nodeKind: "switch",
      building: "Unknown",
      role: "access",
      criticality: "medium",
      notes: `Auto-created from LLDP import on ${capturedAt}`,
    });
    srcNode = created.row;
  }

  const neighbors = parseNxosLldp(rawText);
  const results = {
    neighborsFound: neighbors.length,
    nodesUpserted: 0,
    linksUpserted: 0,
    errors: [] as string[],
  };

  for (const nbr of neighbors) {
    try {
      // Resolve or create neighbor node
      let [nbrNode] = await db
        .select()
        .from(netNodesTable)
        .where(or(eq(netNodesTable.hostname, nbr.systemName), eq(netNodesTable.mgmtIp, nbr.mgmtAddress ?? "")));

      if (!nbrNode) {
        const created = await saveNetNodeByIdentity({
          hostname: nbr.systemName,
          displayName: nbr.systemName,
          nodeKind: "switch",
          building: "Unknown",
          role: "access",
          criticality: "medium",
          mgmtIp: nbr.mgmtAddress,
          notes: `Auto-created from LLDP import via ${srcHostname} on ${capturedAt}`,
        });
        nbrNode = created.row;
        results.nodesUpserted++;
      } else if (nbr.mgmtAddress && !nbrNode.mgmtIp) {
        const updated = await saveNetNodeByIdentity({
          hostname: nbrNode.hostname,
          displayName: nbrNode.displayName,
          nodeKind: nbrNode.nodeKind,
          vendor: nbrNode.vendor,
          model: nbrNode.model,
          mgmtIp: nbr.mgmtAddress,
          building: nbrNode.building,
          location: nbrNode.location,
          role: nbrNode.role,
          function: nbrNode.function,
          criticality: nbrNode.criticality,
          tags: nbrNode.tags,
          status: nbrNode.status,
          notes: nbrNode.notes,
        }, nbrNode.id);
        nbrNode = updated.row;
        results.nodesUpserted++;
      }
      await saveNetLinkByIdentity({
        aNodeId: srcNode.id,
        aPort: nbr.localPort,
        bNodeId: nbrNode.id,
        bPort: nbr.remotePort,
        linkKind: "fiber",
        confidence: "confirmed_lldp",
        lastVerifiedAt: capturedDate,
        evidenceRef: evidenceRef ?? null,
        lldpPeerHostname: nbr.systemName,
        lldpPeerMgmtIp: nbr.mgmtAddress,
      });
      results.linksUpserted++;
    } catch (err: any) {
      results.errors.push(`${nbr.systemName}: ${err?.message ?? "unknown error"}`);
    }
  }

  return res.json(results);
});

// ──────────────────────────────────────────────────────────────
// Seed from existing switches inventory
// ──────────────────────────────────────────────────────────────

router.post("/seed-from-switches", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const switches = await db.select().from(networkSwitchesTable);
  let created = 0;
  let skipped = 0;

  for (const sw of switches) {
    const hostname = sw.hostname.toLowerCase().trim().replace(/\.sccc\.edu$/i, "");

    // Infer role from hostname/model heuristics
    let role: "core" | "distribution" | "access" | "edge" | "firewall" | "controller" | "svi" = "access";
    let nodeKind: "switch" | "firewall" | "router" | "server" | "svi" | "patch_panel" | "isp" | "other" = "switch";
    let criticality: "critical" | "high" | "medium" | "low" = "medium";

    if (/nexus|9[0-9]{3}|a48|a24/i.test(hostname + (sw.model ?? ""))) {
      role = "core";
      criticality = "critical";
    } else if (/dist|distribution/i.test(hostname)) {
      role = "distribution";
      criticality = "high";
    } else if (/fortigate|fgt|firewall/i.test(hostname + (sw.model ?? ""))) {
      role = "edge";
      nodeKind = "firewall";
      criticality = "critical";
    }

    // Infer vendor from model
    let vendor: string | null = null;
    if (/cisco|nexus/i.test(sw.model ?? "")) vendor = "Cisco";
    else if (/aruba|hpe/i.test(sw.model ?? "")) vendor = "Aruba";
    else if (/fortinet|fortigate/i.test(sw.model ?? "")) vendor = "Fortinet";
    else if (/dell/i.test(sw.model ?? "")) vendor = "Dell";

    const result = await saveNetNodeByIdentity({
      hostname,
      displayName: sw.hostname,
      nodeKind,
      vendor,
      model: sw.model ?? null,
      mgmtIp: sw.ipAddress,
      building: sw.building,
      location: sw.location ?? null,
      role,
      criticality,
      status: (sw.status as "online" | "offline" | "unknown") ?? "unknown",
      notes: sw.notes ?? null,
    });
    if (result.action === "created") created++;
    else skipped++;
  }

  return res.json({ created, skipped, total: switches.length });
});

router.post("/normalize", requireAuth, requireNetworkAdmin, async (_req, res) => {
  return res.json(await normalizeNetworkIdentityData());
});

// ──────────────────────────────────────────────────────────────
// Upstream path — BFS from node to core
// ──────────────────────────────────────────────────────────────

router.get("/nodes/:id/upstream-path", requireAuth, async (req: any, res) => {
  const startId = req.params.id;
  const [startNode] = await db.select().from(netNodesTable).where(eq(netNodesTable.id, startId));
  if (!startNode) return res.status(404).json({ error: "Not found" });

  const allNodes = await db.select().from(netNodesTable);
  const allLinks = await db.select().from(netLinksTable);
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  // Build adjacency list
  const adj = new Map<string, { nodeId: string; port: string; peerPort: string }[]>();
  for (const link of allLinks) {
    if (!adj.has(link.aNodeId)) adj.set(link.aNodeId, []);
    if (!adj.has(link.bNodeId)) adj.set(link.bNodeId, []);
    adj.get(link.aNodeId)!.push({ nodeId: link.bNodeId, port: link.aPort, peerPort: link.bPort });
    adj.get(link.bNodeId)!.push({ nodeId: link.aNodeId, port: link.bPort, peerPort: link.aPort });
  }

  // BFS toward core
  const visited = new Set<string>([startId]);
  const path: { node: typeof allNodes[0]; port: string; peerPort: string }[] = [];
  const queue: { nodeId: string; depth: number }[] = [{ nodeId: startId, depth: 0 }];
  const parent = new Map<string, { nodeId: string; port: string; peerPort: string }>();

  let coreId: string | null = null;
  outer: while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;
    if (depth > 10) break; // safety limit
    const node = nodeById.get(nodeId);
    if (!node) continue;
    if (node.role === "core" && nodeId !== startId) {
      coreId = nodeId;
      break outer;
    }
    for (const neighbor of adj.get(nodeId) ?? []) {
      if (visited.has(neighbor.nodeId)) continue;
      visited.add(neighbor.nodeId);
      parent.set(neighbor.nodeId, { nodeId, port: neighbor.peerPort, peerPort: neighbor.port });
      queue.push({ nodeId: neighbor.nodeId, depth: depth + 1 });
    }
  }

  if (!coreId) {
    return res.json({ found: false, path: [], message: "No core node reachable from this device in the network map." });
  }

  // Reconstruct path
  const segments: { from: typeof allNodes[0]; fromPort: string; to: typeof allNodes[0]; toPort: string }[] = [];
  let cur = coreId;
  while (parent.has(cur)) {
    const p = parent.get(cur)!;
    segments.unshift({
      from: nodeById.get(p.nodeId)!,
      fromPort: p.port,
      to: nodeById.get(cur)!,
      toPort: p.peerPort,
    });
    cur = p.nodeId;
  }

  return res.json({ found: true, path: segments });
});

export default router;
