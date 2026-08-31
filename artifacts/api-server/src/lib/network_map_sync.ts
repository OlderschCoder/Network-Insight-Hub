import { db, netNodesTable, networkSwitchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface NetworkMapSyncResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  logs: string[];
}

function canonicalHostname(hostname: string): string {
  return hostname.toLowerCase().trim().replace(/\.sccc\.edu$/i, "");
}

function inferSwitchShape(sw: typeof networkSwitchesTable.$inferSelect) {
  let role: "core" | "distribution" | "access" | "edge" | "firewall" | "controller" | "svi" = "access";
  let nodeKind: "switch" | "firewall" | "router" | "server" | "svi" | "patch_panel" | "isp" | "other" = "switch";
  let criticality: "critical" | "high" | "medium" | "low" = "medium";

  if (/nexus|9[0-9]{3}|a48|a24/i.test(sw.hostname + (sw.model ?? ""))) {
    role = "core";
    criticality = "critical";
  } else if (/dist|distribution/i.test(sw.hostname)) {
    role = "distribution";
    criticality = "high";
  } else if (/fortigate|fgt|firewall/i.test(sw.hostname + (sw.model ?? ""))) {
    role = "edge";
    nodeKind = "firewall";
    criticality = "critical";
  }

  let vendor: string | null = null;
  if (/cisco|nexus/i.test(sw.model ?? "")) vendor = "Cisco";
  else if (/aruba|hpe/i.test(sw.model ?? "")) vendor = "Aruba";
  else if (/fortinet|fortigate/i.test(sw.model ?? "")) vendor = "Fortinet";
  else if (/dell/i.test(sw.model ?? "")) vendor = "Dell";

  return { role, nodeKind, criticality, vendor };
}

export async function syncNetworkNodesFromSwitchInventory(
  options: { log?: (line: string) => void } = {},
): Promise<NetworkMapSyncResult> {
  const switches = await db.select().from(networkSwitchesTable);
  const existingNodes = await db.select().from(netNodesTable);
  const nodeByHostname = new Map(existingNodes.map((node) => [canonicalHostname(node.hostname), node]));
  const logs: string[] = [];
  const log = (line: string) => {
    logs.push(line);
    options.log?.(line);
  };

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const sw of switches) {
    const hostname = canonicalHostname(sw.hostname);
    const inferred = inferSwitchShape(sw);
    const existing = nodeByHostname.get(hostname);

    if (!existing) {
      const [createdNode] = await db.insert(netNodesTable).values({
        hostname,
        displayName: sw.hostname,
        nodeKind: inferred.nodeKind,
        vendor: inferred.vendor,
        model: sw.model ?? null,
        mgmtIp: sw.ipAddress || null,
        building: sw.building,
        location: sw.location ?? null,
        role: inferred.role,
        criticality: inferred.criticality,
        status: (sw.status as "online" | "offline" | "unknown") ?? "unknown",
        notes: sw.notes ?? null,
      }).returning();
      nodeByHostname.set(hostname, createdNode);
      created++;
      log(`CREATE ${hostname} -> ${sw.building}`);
      continue;
    }

    const updates: Record<string, unknown> = {};
    if ((existing.building ?? "") !== (sw.building ?? "")) updates.building = sw.building;
    if ((existing.mgmtIp ?? null) !== (sw.ipAddress || null)) updates.mgmtIp = sw.ipAddress || null;
    if ((existing.model ?? null) !== (sw.model ?? null)) updates.model = sw.model ?? null;
    if ((existing.location ?? null) !== (sw.location ?? null)) updates.location = sw.location ?? null;
    if ((existing.status ?? null) !== (sw.status ?? null)) updates.status = sw.status ?? null;
    if (!existing.displayName) updates.displayName = sw.hostname;
    if (!existing.vendor && inferred.vendor) updates.vendor = inferred.vendor;
    if (!existing.notes && sw.notes) updates.notes = sw.notes;
    if (existing.nodeKind === "other" && inferred.nodeKind !== "other") updates.nodeKind = inferred.nodeKind;
    if (
      (existing.role === "access" || !existing.role) &&
      inferred.role !== "access"
    ) {
      updates.role = inferred.role;
    }
    if (
      (existing.criticality === "low" || existing.criticality === "medium" || !existing.criticality) &&
      (inferred.criticality === "high" || inferred.criticality === "critical")
    ) {
      updates.criticality = inferred.criticality;
    }

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    const [updatedNode] = await db
      .update(netNodesTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(netNodesTable.id, existing.id))
      .returning();
    nodeByHostname.set(hostname, updatedNode);
    updated++;
    log(`UPDATE ${hostname} -> ${Object.keys(updates).join(", ")}`);
  }

  return { total: switches.length, created, updated, skipped, logs };
}
