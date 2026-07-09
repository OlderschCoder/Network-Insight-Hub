import { Router } from "express";
import { db, netNodesTable, netLinksTable, vlansTable } from "@workspace/db";
import { eq, or, ilike, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireNetworkAdmin } from "./auth";
import { z } from "zod";

const router = Router();

// ---------------------------------------------------------------------------
// InfluxDB helpers (stubbed until server is inside the SCCC network)
// ---------------------------------------------------------------------------
const INFLUX_URL   = process.env.INFLUXDB_URL;      // e.g. http://10.0.0.22:8086
const INFLUX_TOKEN = process.env.INFLUXDB_TOKEN;     // read-only token
const INFLUX_ORG   = process.env.INFLUXDB_ORG ?? "SCCC";
const INFLUX_BUCKET = process.env.INFLUXDB_BUCKET ?? "telegraf";

async function queryInflux(flux: string): Promise<string | null> {
  if (!INFLUX_URL || !INFLUX_TOKEN) return null;
  try {
    const res = await fetch(`${INFLUX_URL}/api/v2/query?org=${encodeURIComponent(INFLUX_ORG)}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${INFLUX_TOKEN}`,
        "Content-Type": "application/vnd.flux",
        Accept: "application/csv",
      },
      body: flux,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Parse InfluxDB CSV response into array of objects */
function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] ?? "").trim(); });
    return obj;
  });
}

/** Returns device status from InfluxDB or null if unavailable */
async function getDeviceStatus(hosts: string[]): Promise<Record<string, "up" | "degraded" | "down" | "unknown">> {
  if (!INFLUX_URL || !INFLUX_TOKEN || hosts.length === 0) return {};

  const hostFilter = hosts.map((h) => `r.source == "${h}" or r._value == "${h}"`).join(" or ");
  const flux = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -10m)
  |> filter(fn: (r) => r._measurement == "ping")
  |> filter(fn: (r) => r._field == "percent_packet_loss")
  |> last()
  |> filter(fn: (r) => ${hostFilter})
`;
  const csv = await queryInflux(flux);
  if (!csv) return {};

  const rows = parseCsv(csv);
  const result: Record<string, "up" | "degraded" | "down" | "unknown"> = {};
  for (const row of rows) {
    const host = row.source ?? row._value ?? "";
    const loss = parseFloat(row._value ?? "100");
    if (!host) continue;
    result[host] = loss === 0 ? "up" : loss < 50 ? "degraded" : "down";
  }
  return result;
}

// ---------------------------------------------------------------------------
// NET NODES – CRUD
// ---------------------------------------------------------------------------

const nodeInsertSchema = z.object({
  hostname:    z.string().min(1).max(80),
  displayName: z.string().min(1).max(120),
  nodeKind:    z.enum(["switch", "firewall", "router", "server", "svi", "patch_panel", "isp", "other"]),
  vendor:      z.string().max(20).optional(),
  model:       z.string().max(80).optional(),
  mgmtIp:      z.string().max(45).optional(),
  building:    z.string().min(1).max(80),
  location:    z.string().max(120).optional(),
  role:        z.enum(["core", "distribution", "access", "edge", "firewall", "controller", "svi"]),
  function:    z.string().max(30).optional(),
  criticality: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  tags:        z.array(z.string()).optional(),
  status:      z.enum(["online", "offline", "unknown"]).optional(),
  notes:       z.string().optional(),
});

const nodePatchSchema = nodeInsertSchema.partial();

/** GET /network/nodes – list all nodes, optionally filtered */
router.get("/nodes", requireAuth, async (req: any, res) => {
  const { q, building, kind, role } = req.query;
  const conds: any[] = [];
  if (q) {
    conds.push(or(
      ilike(netNodesTable.hostname, `%${q}%`),
      ilike(netNodesTable.displayName, `%${q}%`),
      ilike(netNodesTable.building, `%${q}%`),
      ilike(netNodesTable.mgmtIp, `%${q}%`),
    ));
  }
  if (building) conds.push(ilike(netNodesTable.building, `%${building}%`));
  if (kind)     conds.push(eq(netNodesTable.nodeKind, kind as string));
  if (role)     conds.push(eq(netNodesTable.role, role as string));

  const nodes = conds.length
    ? await db.select().from(netNodesTable).where(and(...conds)).orderBy(netNodesTable.building, netNodesTable.hostname)
    : await db.select().from(netNodesTable).orderBy(netNodesTable.building, netNodesTable.hostname);

  return res.json(nodes);
});

/** POST /network/nodes – create a node */
router.post("/nodes", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = nodeInsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const [node] = await db.insert(netNodesTable).values(parsed.data).returning();
  return res.status(201).json(node);
});

/** GET /network/nodes/:id – node detail with links */
router.get("/nodes/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const [node] = await db.select().from(netNodesTable).where(eq(netNodesTable.id, id));
  if (!node) return res.status(404).json({ error: "Not found" });

  // All links where this node is either endpoint
  const links = await db.select().from(netLinksTable).where(
    or(eq(netLinksTable.aNodeId, id), eq(netLinksTable.bNodeId, id))
  );

  // Resolve peer node details
  const peerIds = [...new Set(links.flatMap((l) =>
    [l.aNodeId === id ? l.bNodeId : l.aNodeId]
  ))];
  const peers = peerIds.length
    ? await db.select({
        id: netNodesTable.id,
        hostname: netNodesTable.hostname,
        displayName: netNodesTable.displayName,
        building: netNodesTable.building,
        mgmtIp: netNodesTable.mgmtIp,
        nodeKind: netNodesTable.nodeKind,
        role: netNodesTable.role,
      }).from(netNodesTable).where(
        or(...peerIds.map((pid) => eq(netNodesTable.id, pid)))
      )
    : [];

  const peerMap = Object.fromEntries(peers.map((p) => [p.id, p]));

  const enrichedLinks = links.map((l) => ({
    ...l,
    localPort:  l.aNodeId === id ? l.aPort : l.bPort,
    remotePort: l.aNodeId === id ? l.bPort : l.aPort,
    peerNode:   peerMap[l.aNodeId === id ? l.bNodeId : l.aNodeId] ?? null,
    direction:  l.aNodeId === id ? "a" : "b",
  }));

  // Live status from InfluxDB (best-effort)
  let liveStatus: "up" | "degraded" | "down" | "unknown" = "unknown";
  if (node.mgmtIp) {
    const statuses = await getDeviceStatus([node.mgmtIp, node.hostname]);
    liveStatus = statuses[node.mgmtIp] ?? statuses[node.hostname] ?? "unknown";
  }

  return res.json({ ...node, links: enrichedLinks, liveStatus });
});

/** PATCH /network/nodes/:id – update node fields */
router.patch("/nodes/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const { id } = req.params;
  const parsed = nodePatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const [node] = await db.update(netNodesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(netNodesTable.id, id))
    .returning();
  if (!node) return res.status(404).json({ error: "Not found" });
  return res.json(node);
});

/** DELETE /network/nodes/:id */
router.delete("/nodes/:id", requireAuth, requireNetworkAdmin, async (req, res) => {
  const { id } = req.params;
  await db.delete(netNodesTable).where(eq(netNodesTable.id, id));
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// NET LINKS – CRUD
// ---------------------------------------------------------------------------

const linkInsertSchema = z.object({
  aNodeId:         z.string().uuid(),
  aPort:           z.string().min(1).max(40),
  bNodeId:         z.string().uuid(),
  bPort:           z.string().min(1).max(40),
  linkKind:        z.enum(["fiber", "dac", "copper", "wireless", "vpn", "virtual", "unknown"]),
  speedMbps:       z.number().int().positive().optional(),
  portMode:        z.enum(["trunk", "access", "routed", "peerlink", "heartbeat", "unknown"]).optional(),
  nativeVlan:      z.number().int().optional(),
  allowedVlans:    z.array(z.number().int()).optional(),
  portchannel:     z.string().max(20).optional(),
  lldpPeerHostname: z.string().max(80).optional(),
  lldpPeerMgmtIp:  z.string().max(45).optional(),
  confidence:      z.enum(["confirmed_lldp", "confirmed_cdp", "confirmed_manual", "inferred", "stale"]),
  lastVerifiedAt:  z.string().datetime(),
  evidenceRef:     z.string().max(200).optional(),
  notes:           z.string().optional(),
});

const linkPatchSchema = linkInsertSchema.partial().omit({ aNodeId: true, bNodeId: true });

/** POST /network/nodes/:id/links – add a link from this node */
router.post("/nodes/:id/links", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const { id } = req.params;
  const parsed = linkInsertSchema.safeParse({ ...req.body, aNodeId: req.body.aNodeId ?? id });
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const [link] = await db.insert(netLinksTable).values({
    ...parsed.data,
    lastVerifiedAt: new Date(parsed.data.lastVerifiedAt),
  }).returning();
  return res.status(201).json(link);
});

/** PATCH /network/links/:id – update a link */
router.patch("/links/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const { id } = req.params;
  const parsed = linkPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const [link] = await db.update(netLinksTable)
    .set({
      ...parsed.data,
      ...(parsed.data.lastVerifiedAt ? { lastVerifiedAt: new Date(parsed.data.lastVerifiedAt) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(netLinksTable.id, id))
    .returning();
  if (!link) return res.status(404).json({ error: "Not found" });
  return res.json(link);
});

/** DELETE /network/links/:id */
router.delete("/links/:id", requireAuth, requireNetworkAdmin, async (req, res) => {
  const { id } = req.params;
  await db.delete(netLinksTable).where(eq(netLinksTable.id, id));
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// BUILDINGS – summary + detail
// ---------------------------------------------------------------------------

/** GET /network/buildings – all buildings with node/vlan counts + live status */
router.get("/buildings", requireAuth, async (_req, res) => {
  // Aggregate nodes per building
  const nodeCounts = await db
    .select({
      building: netNodesTable.building,
      total:    sql<number>`count(*)`,
    })
    .from(netNodesTable)
    .groupBy(netNodesTable.building);

  // Aggregate vlans per building
  const vlanCounts = await db
    .select({
      building: vlansTable.building,
      total:    sql<number>`count(*)`,
    })
    .from(vlansTable)
    .groupBy(vlansTable.building);

  // All buildings (union of nodes + vlans)
  const buildingSet = new Set([
    ...nodeCounts.map((r) => r.building),
    ...vlanCounts.map((r) => r.building),
  ]);

  const nodeMap  = Object.fromEntries(nodeCounts.map((r) => [r.building, Number(r.total)]));
  const vlanMap  = Object.fromEntries(vlanCounts.map((r) => [r.building, Number(r.total)]));

  // Pull mgmt IPs for live status check
  const nodeRows = await db
    .select({ building: netNodesTable.building, mgmtIp: netNodesTable.mgmtIp, hostname: netNodesTable.hostname })
    .from(netNodesTable);

  const buildingHosts: Record<string, string[]> = {};
  for (const n of nodeRows) {
    if (!buildingHosts[n.building]) buildingHosts[n.building] = [];
    if (n.mgmtIp) buildingHosts[n.building].push(n.mgmtIp);
    else buildingHosts[n.building].push(n.hostname);
  }

  // Live status (best-effort, only if InfluxDB configured)
  const allHosts = nodeRows.map((n) => n.mgmtIp ?? n.hostname).filter(Boolean) as string[];
  const liveStatuses = allHosts.length ? await getDeviceStatus(allHosts) : {};

  const buildings = Array.from(buildingSet).sort().map((name) => {
    const hosts = buildingHosts[name] ?? [];
    const statuses = hosts.map((h) => liveStatuses[h] ?? "unknown");
    const hasDown     = statuses.includes("down");
    const hasDegraded = statuses.includes("degraded");
    const allUp       = statuses.length > 0 && statuses.every((s) => s === "up");
    const healthColor = allUp ? "green" : (hasDown || hasDegraded) ? "amber" : "unknown";

    return {
      name,
      nodeCount: nodeMap[name] ?? 0,
      vlanCount: vlanMap[name] ?? 0,
      healthColor,
      influxConfigured: !!(INFLUX_URL && INFLUX_TOKEN),
    };
  });

  return res.json(buildings);
});

/** GET /network/buildings/:name – all nodes, vlans, and live status for a building */
router.get("/buildings/:name", requireAuth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);

  const [nodes, vlans] = await Promise.all([
    db.select().from(netNodesTable).where(ilike(netNodesTable.building, name)).orderBy(netNodesTable.role, netNodesTable.hostname),
    db.select().from(vlansTable).where(ilike(vlansTable.building, name)).orderBy(vlansTable.vlanId),
  ]);

  // Links for all nodes in this building
  const nodeIds = nodes.map((n) => n.id);
  const links = nodeIds.length
    ? await db.select().from(netLinksTable).where(
        or(
          ...nodeIds.map((id) => eq(netLinksTable.aNodeId, id)),
          ...nodeIds.map((id) => eq(netLinksTable.bNodeId, id)),
        )
      )
    : [];

  // Live status
  const hosts = nodes.map((n) => n.mgmtIp ?? n.hostname).filter(Boolean) as string[];
  const liveStatuses = hosts.length ? await getDeviceStatus(hosts) : {};

  const nodesWithStatus = nodes.map((n) => ({
    ...n,
    liveStatus: liveStatuses[n.mgmtIp ?? ""] ?? liveStatuses[n.hostname] ?? "unknown",
  }));

  return res.json({
    building: name,
    nodes: nodesWithStatus,
    vlans,
    links,
    influxConfigured: !!(INFLUX_URL && INFLUX_TOKEN),
  });
});

// ---------------------------------------------------------------------------
// INFLUX – device status (stub/live)
// ---------------------------------------------------------------------------

/** GET /network/influx/status – overall device health from InfluxDB */
router.get("/influx/status", requireAuth, async (_req, res) => {
  if (!INFLUX_URL || !INFLUX_TOKEN) {
    return res.json({
      configured: false,
      message: "Set INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG env vars to enable live status",
      devices: [],
    });
  }

  const flux = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -10m)
  |> filter(fn: (r) => r._measurement == "ping")
  |> filter(fn: (r) => r._field == "percent_packet_loss")
  |> last()
  |> keep(columns: ["source", "_value", "_time"])
`;
  const csv = await queryInflux(flux);
  if (!csv) {
    return res.json({ configured: true, reachable: false, devices: [] });
  }

  const rows = parseCsv(csv);
  const devices = rows.map((r) => {
    const loss = parseFloat(r._value ?? "100");
    return {
      host: r.source,
      packetLoss: loss,
      status: loss === 0 ? "up" : loss < 50 ? "degraded" : "down",
      lastSeen: r._time,
    };
  });

  return res.json({ configured: true, reachable: true, devices });
});

/** GET /network/influx/device/:host – single device detail from InfluxDB */
router.get("/influx/device/:host", requireAuth, async (req, res) => {
  const host = req.params.host;
  if (!INFLUX_URL || !INFLUX_TOKEN) {
    return res.json({ configured: false, host, metrics: null });
  }

  const flux = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -15m)
  |> filter(fn: (r) => r.source == "${host}" or r.agent_host == "${host}")
  |> filter(fn: (r) =>
      r._field == "percent_packet_loss" or
      r._field == "average_response_ms" or
      r._field == "uptime" or
      r._field == "ifOperStatus"
  )
  |> last()
  |> keep(columns: ["_measurement", "_field", "_value", "ifName", "_time"])
`;
  const csv = await queryInflux(flux);
  if (!csv) return res.json({ configured: true, reachable: false, host, metrics: null });

  const rows = parseCsv(csv);
  const metrics: Record<string, any> = {};
  const interfaces: Record<string, any> = {};

  for (const r of rows) {
    if (r._measurement === "ping") {
      metrics[r._field] = r._value;
    } else if (r._measurement === "interface" && r.ifName) {
      if (!interfaces[r.ifName]) interfaces[r.ifName] = {};
      interfaces[r.ifName][r._field] = r._value;
    } else {
      metrics[r._field] = r._value;
    }
  }

  return res.json({ configured: true, reachable: true, host, metrics, interfaces, lastPolled: new Date().toISOString() });
});

export default router;
