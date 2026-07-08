/**
 * Network Map API — nodes, links, OSPF adjacencies, LLDP import, seed.
 * All writes gated to network admin / CIO roles.
 */
import { Router } from "express";
import { db, netNodesTable, netLinksTable, netRoutingAdjacenciesTable, networkSwitchesTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { requireAuth, requireNetworkAdmin } from "./auth";
import { z } from "zod";

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

  // Normalise hostname: lowercase, trim, strip .sccc.edu suffix
  const data = {
    ...parsed.data,
    hostname: parsed.data.hostname.toLowerCase().trim().replace(/\.sccc\.edu$/i, ""),
  };

  try {
    const [node] = await db.insert(netNodesTable).values(data).returning();
    return res.status(201).json(node);
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ error: "A node with that hostname already exists." });
    throw err;
  }
});

router.patch("/nodes/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = nodeUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  const data: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (data.hostname) data.hostname = (data.hostname as string).toLowerCase().trim().replace(/\.sccc\.edu$/i, "");

  const [node] = await db
    .update(netNodesTable)
    .set(data)
    .where(eq(netNodesTable.id, req.params.id))
    .returning();
  if (!node) return res.status(404).json({ error: "Not found" });
  return res.json(node);
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

  // Canonical ordering to avoid A-B / B-A duplicates: sort node ids lexicographically
  let data = { ...parsed.data, lastVerifiedAt: new Date(parsed.data.lastVerifiedAt) };
  if (data.aNodeId > data.bNodeId) {
    [data.aNodeId, data.bNodeId] = [data.bNodeId, data.aNodeId];
    [data.aPort, data.bPort] = [data.bPort, data.aPort];
  }

  const [link] = await db.insert(netLinksTable).values(data).returning();
  return res.status(201).json(link);
});

router.patch("/links/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = linkUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const data: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (data.lastVerifiedAt) data.lastVerifiedAt = new Date(data.lastVerifiedAt as string);

  const [link] = await db
    .update(netLinksTable)
    .set(data)
    .where(eq(netLinksTable.id, req.params.id))
    .returning();
  if (!link) return res.status(404).json({ error: "Not found" });
  return res.json(link);
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
    // Auto-create a placeholder node for the source device
    const [created] = await db
      .insert(netNodesTable)
      .values({
        hostname: srcHostname,
        displayName: srcHostname,
        nodeKind: "switch",
        building: "Unknown",
        role: "access",
        criticality: "medium",
        notes: `Auto-created from LLDP import on ${capturedAt}`,
      })
      .returning();
    srcNode = created;
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
        .where(eq(netNodesTable.hostname, nbr.systemName));

      if (!nbrNode) {
        const [created] = await db
          .insert(netNodesTable)
          .values({
            hostname: nbr.systemName,
            displayName: nbr.systemName,
            nodeKind: "switch",
            building: "Unknown",
            role: "access",
            criticality: "medium",
            mgmtIp: nbr.mgmtAddress,
            notes: `Auto-created from LLDP import via ${srcHostname} on ${capturedAt}`,
          })
          .returning();
        nbrNode = created;
        results.nodesUpserted++;
      } else if (nbr.mgmtAddress && !nbrNode.mgmtIp) {
        // Fill in mgmt IP if we learned it from LLDP
        await db
          .update(netNodesTable)
          .set({ mgmtIp: nbr.mgmtAddress, updatedAt: new Date() })
          .where(eq(netNodesTable.id, nbrNode.id));
        results.nodesUpserted++;
      }

      // Canonical ordering for new inserts (ensures consistent a<b UUID order)
      let aId = srcNode.id;
      let aPort = nbr.localPort;
      let bId = nbrNode.id;
      let bPort = nbr.remotePort;
      if (aId > bId) {
        [aId, bId] = [bId, aId];
        [aPort, bPort] = [bPort, aPort];
      }

      // Dedup: search BOTH directions — seed data may not have used canonical order
      const existingLinks = await db
        .select()
        .from(netLinksTable)
        .where(
          or(
            and(eq(netLinksTable.aNodeId, aId), eq(netLinksTable.bNodeId, bId)),
            and(eq(netLinksTable.aNodeId, bId), eq(netLinksTable.bNodeId, aId)),
          ),
        );

      // Match on ports regardless of which side they're stored on
      const existing = existingLinks.find(
        (l) =>
          (l.aPort === aPort && l.bPort === bPort) ||
          (l.aPort === bPort && l.bPort === aPort),
      );

      if (existing) {
        // Update confidence and timestamp; don't overwrite manual notes
        await db
          .update(netLinksTable)
          .set({
            confidence: "confirmed_lldp",
            lastVerifiedAt: capturedDate,
            evidenceRef: evidenceRef ?? existing.evidenceRef,
            lldpPeerHostname: nbr.systemName,
            lldpPeerMgmtIp: nbr.mgmtAddress ?? existing.lldpPeerMgmtIp,
            updatedAt: new Date(),
          })
          .where(eq(netLinksTable.id, existing.id));
      } else {
        await db.insert(netLinksTable).values({
          aNodeId: aId,
          aPort,
          bNodeId: bId,
          bPort,
          linkKind: "fiber",
          confidence: "confirmed_lldp",
          lastVerifiedAt: capturedDate,
          evidenceRef: evidenceRef ?? null,
          lldpPeerHostname: nbr.systemName,
          lldpPeerMgmtIp: nbr.mgmtAddress,
        });
      }
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
    const [existing] = await db
      .select()
      .from(netNodesTable)
      .where(eq(netNodesTable.hostname, hostname));

    if (existing) { skipped++; continue; }

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

    await db.insert(netNodesTable).values({
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
    created++;
  }

  return res.json({ created, skipped, total: switches.length });
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
