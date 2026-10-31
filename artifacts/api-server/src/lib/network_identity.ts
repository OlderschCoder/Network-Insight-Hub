import {
  db,
  deviceConfigsTable,
  inventoryAuditTable,
  netLinksTable,
  netNodesTable,
  netRoutingAdjacenciesTable,
  networkLayoutPositionsTable,
  networkSwitchesTable,
} from "@workspace/db";
import { netPortsTable } from "@workspace/db/net_ports";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";

const NON_AUTHORITATIVE_IPS = new Set(["", "-", "unknown", "n/a", "na", "none", "null", "0.0.0.0"]);

const ROLE_RANK: Record<string, number> = {
  core: 100,
  distribution: 80,
  edge: 70,
  firewall: 70,
  controller: 60,
  access: 40,
  svi: 30,
};

const CRITICALITY_RANK: Record<string, number> = {
  critical: 100,
  high: 80,
  medium: 60,
  low: 40,
};

const CONFIDENCE_RANK: Record<string, number> = {
  confirmed_lldp: 100,
  confirmed_cdp: 95,
  confirmed_manual: 90,
  inferred: 60,
  stale: 20,
};

export function normalizeHostname(raw: string | null | undefined) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.sccc\.edu$/i, "")
    .replace(/\s+/g, "")
    .trim();
}

export function normalizeIp(raw: string | null | undefined) {
  const value = String(raw ?? "").trim().toLowerCase();
  return value || null;
}

export function hasAuthoritativeIp(raw: string | null | undefined) {
  const value = normalizeIp(raw);
  return !!value && !NON_AUTHORITATIVE_IPS.has(value);
}

function isMeaningfulText(raw: string | null | undefined) {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  return !NON_AUTHORITATIVE_IPS.has(value.toLowerCase());
}

function pickFirstMeaningful(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (isMeaningfulText(value)) return String(value).trim();
  }
  return null;
}

function mergeStatus(values: Array<string | null | undefined>) {
  const normalized = values
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (normalized.includes("online")) return "online";
  if (normalized.includes("unknown")) return "unknown";
  if (normalized.includes("offline")) return "offline";
  return null;
}

function pickStrongestRole(values: Array<string | null | undefined>) {
  return values
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => (ROLE_RANK[b] ?? 0) - (ROLE_RANK[a] ?? 0))[0] ?? null;
}

function pickStrongestCriticality(values: Array<string | null | undefined>) {
  return values
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => (CRITICALITY_RANK[b] ?? 0) - (CRITICALITY_RANK[a] ?? 0))[0] ?? null;
}

function pickBestNodeKind(values: Array<string | null | undefined>) {
  const normalized = values
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (normalized.includes("firewall")) return "firewall";
  if (normalized.includes("router")) return "router";
  if (normalized.includes("switch")) return "switch";
  return normalized[0] ?? null;
}

function mergeStringArrays(values: Array<string[] | null | undefined>) {
  const merged = [...new Set(values.flatMap((value) => (Array.isArray(value) ? value : [])))];
  return merged.length > 0 ? merged : null;
}

function mergeNotes(values: Array<string | null | undefined>) {
  const merged = [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
  return merged.length > 0 ? merged.join("\n\n") : null;
}

function rowWeight(row: {
  hostname?: string | null;
  building?: string | null;
  role?: string | null;
  nodeKind?: string | null;
  model?: string | null;
  vendor?: string | null;
  notes?: string | null;
  mgmtIp?: string | null;
  updatedAt?: Date | string | null;
}, linkCount = 0) {
  let weight = linkCount * 20;
  if (isMeaningfulText(row.model)) weight += 10;
  if (isMeaningfulText(row.vendor)) weight += 6;
  if (isMeaningfulText(row.notes)) weight += 4;
  if (isMeaningfulText(row.building) && String(row.building).trim().toLowerCase() !== "unknown") weight += 8;
  weight += ROLE_RANK[String(row.role ?? "").toLowerCase()] ?? 0;
  if (String(row.nodeKind ?? "").toLowerCase() === "firewall") weight += 15;
  if (hasAuthoritativeIp(row.mgmtIp ?? null)) weight += 25;
  const updatedAt = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
  if (!Number.isNaN(updatedAt)) weight += Math.floor(updatedAt / 1000000000);
  return weight;
}

function linkWeight(row: {
  confidence?: string | null;
  speedMbps?: number | null;
  portMode?: string | null;
  evidenceRef?: string | null;
  lldpPeerHostname?: string | null;
  lastVerifiedAt?: Date | string | null;
}) {
  let weight = CONFIDENCE_RANK[String(row.confidence ?? "").toLowerCase()] ?? 0;
  weight += Number(row.speedMbps ?? 0);
  if (isMeaningfulText(row.portMode)) weight += 10;
  if (isMeaningfulText(row.evidenceRef)) weight += 6;
  if (isMeaningfulText(row.lldpPeerHostname)) weight += 4;
  const verifiedAt = row.lastVerifiedAt ? new Date(row.lastVerifiedAt).getTime() : 0;
  if (!Number.isNaN(verifiedAt)) weight += Math.floor(verifiedAt / 1000000000);
  return weight;
}

function pickCanonicalRowByWeight<T extends { id: string | number }>(
  rows: T[],
  score: (row: T) => number,
) {
  return rows
    .slice()
    .sort((a, b) => score(b) - score(a))[0];
}

export async function findSwitchByIdentity(
  input: { hostname?: string | null; ipAddress?: string | null; excludeId?: number | null },
  client: any = db,
) {
  const rows = await client.select().from(networkSwitchesTable);
  const authoritativeIp = hasAuthoritativeIp(input.ipAddress) ? normalizeIp(input.ipAddress) : null;
  if (authoritativeIp) {
    const byIp = rows.find((row: any) => row.id !== input.excludeId && normalizeIp(row.ipAddress) === authoritativeIp);
    if (byIp) return byIp;
  }
  const hostnameKey = normalizeHostname(input.hostname);
  if (!hostnameKey) return null;
  return rows.find((row: any) => row.id !== input.excludeId && normalizeHostname(row.hostname) === hostnameKey) ?? null;
}

export async function mergeSwitchRows(
  primaryId: number,
  duplicateIds: number[],
  overrides: Record<string, unknown> = {},
) {
  if (duplicateIds.length === 0) return null;
  return db.transaction(async (tx: any) => {
    const rows = await tx.select().from(networkSwitchesTable).where(
      or(
        eq(networkSwitchesTable.id, primaryId),
        ...duplicateIds.map((id) => eq(networkSwitchesTable.id, id)),
      ),
    );
    const primary = rows.find((row: any) => row.id === primaryId);
    if (!primary) throw new Error("Primary switch row not found during merge.");
    const duplicates = rows.filter((row: any) => row.id !== primaryId);
    const merged = {
      hostname: normalizeHostname(String(overrides.hostname ?? primary.hostname ?? "")) || normalizeHostname(primary.hostname),
      building: pickFirstMeaningful(String(overrides.building ?? ""), primary.building, ...duplicates.map((row: any) => row.building)) ?? primary.building,
      ipAddress: pickFirstMeaningful(
        String(overrides.ipAddress ?? ""),
        hasAuthoritativeIp(primary.ipAddress) ? primary.ipAddress : null,
        ...duplicates.map((row: any) => (hasAuthoritativeIp(row.ipAddress) ? row.ipAddress : null)),
        primary.ipAddress,
        ...duplicates.map((row: any) => row.ipAddress),
      ) ?? primary.ipAddress,
      model: pickFirstMeaningful(String(overrides.model ?? ""), primary.model, ...duplicates.map((row: any) => row.model)),
      status: mergeStatus([String(overrides.status ?? ""), primary.status, ...duplicates.map((row: any) => row.status)]) ?? primary.status,
      configFile: pickFirstMeaningful(String(overrides.configFile ?? ""), primary.configFile, ...duplicates.map((row: any) => row.configFile)),
      notes: mergeNotes([String(overrides.notes ?? ""), primary.notes, ...duplicates.map((row: any) => row.notes)]),
      location: pickFirstMeaningful(String(overrides.location ?? ""), primary.location, ...duplicates.map((row: any) => row.location)),
      maintenanceLog: [
        ...new Map(
          [...(Array.isArray(primary.maintenanceLog) ? primary.maintenanceLog : []), ...duplicates.flatMap((row: any) => (Array.isArray(row.maintenanceLog) ? row.maintenanceLog : []))]
            .filter((entry: any) => entry?.id)
            .map((entry: any) => [entry.id, entry]),
        ).values(),
      ],
      updatedAt: new Date(),
    };

    const [updated] = await tx
      .update(networkSwitchesTable)
      .set(merged)
      .where(eq(networkSwitchesTable.id, primaryId))
      .returning();

    await tx.update(deviceConfigsTable).set({ switchId: primaryId }).where(inArray(deviceConfigsTable.switchId, duplicateIds));
    await tx
      .update(inventoryAuditTable)
      .set({ entityId: primaryId, entityLabel: updated.hostname })
      .where(and(eq(inventoryAuditTable.entityType, "switch"), inArray(inventoryAuditTable.entityId, duplicateIds)));
    await tx.delete(networkSwitchesTable).where(inArray(networkSwitchesTable.id, duplicateIds));
    return updated;
  });
}

export async function saveSwitchByIdentity(
  input: {
    hostname: string;
    building?: string | null;
    ipAddress?: string | null;
    model?: string | null;
    status?: string | null;
    configFile?: string | null;
    notes?: string | null;
    location?: string | null;
  },
  existingId?: number | null,
) {
  const hostname = normalizeHostname(input.hostname);
  if (!hostname) throw new Error("hostname is required");
  const payload = {
    hostname,
    building: input.building?.trim() || null,
    ipAddress: input.ipAddress?.trim() || null,
    model: input.model?.trim() || null,
    status: input.status?.trim().toLowerCase() || null,
    configFile: input.configFile?.trim() || null,
    notes: input.notes?.trim() || null,
    location: input.location?.trim() || null,
  };

  const current = existingId != null
    ? (await db.select().from(networkSwitchesTable).where(eq(networkSwitchesTable.id, existingId)))[0] ?? null
    : null;
  if (existingId != null && !current) throw new Error("Switch not found");

  const match = await findSwitchByIdentity({ hostname, ipAddress: payload.ipAddress, excludeId: existingId ?? null });
  if (current && match && match.id !== current.id) {
    const merged = await mergeSwitchRows(match.id, [current.id], payload);
    return { row: merged, action: "merged" as const };
  }

  const target = match ?? current;
  if (target) {
    const [row] = await db
      .update(networkSwitchesTable)
      .set({
        hostname,
        building: payload.building ?? target.building,
        ipAddress: payload.ipAddress ?? target.ipAddress,
        model: payload.model ?? target.model,
        status: payload.status ?? target.status,
        configFile: payload.configFile ?? target.configFile,
        notes: payload.notes ?? target.notes,
        location: payload.location ?? target.location,
        updatedAt: new Date(),
      })
      .where(eq(networkSwitchesTable.id, target.id))
      .returning();
    return { row, action: match ? "merged" as const : "updated" as const };
  }

  const [row] = await db.insert(networkSwitchesTable).values({
    hostname,
    building: payload.building ?? "Unassigned",
    ipAddress: payload.ipAddress ?? "unknown",
    model: payload.model,
    status: payload.status ?? "unknown",
    configFile: payload.configFile,
    notes: payload.notes,
    location: payload.location,
  }).returning();
  return { row, action: "created" as const };
}

async function fetchNodeLinkCounts(client: any = db) {
  const rows = await client
    .select({
      nodeId: sql<string>`coalesce(${netLinksTable.aNodeId}::text, ${netLinksTable.bNodeId}::text)`,
      count: sql<number>`count(*)::int`,
    })
    .from(netLinksTable)
    .groupBy(netLinksTable.aNodeId, netLinksTable.bNodeId);
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.nodeId, (counts.get(row.nodeId) ?? 0) + Number(row.count ?? 0));
  }
  const links = await client.select().from(netLinksTable);
  for (const link of links) {
    counts.set(link.aNodeId, (counts.get(link.aNodeId) ?? 0) + 1);
    counts.set(link.bNodeId, (counts.get(link.bNodeId) ?? 0) + 1);
  }
  return counts;
}

export async function findNetNodeByIdentity(
  input: { hostname?: string | null; mgmtIp?: string | null; excludeId?: string | null },
  client: any = db,
) {
  const rows = await client.select().from(netNodesTable);
  const authoritativeIp = hasAuthoritativeIp(input.mgmtIp) ? normalizeIp(input.mgmtIp) : null;
  if (authoritativeIp) {
    const byIp = rows.find((row: any) => row.id !== input.excludeId && normalizeIp(row.mgmtIp) === authoritativeIp);
    if (byIp) return byIp;
  }
  const hostnameKey = normalizeHostname(input.hostname);
  if (!hostnameKey) return null;
  return rows.find((row: any) => row.id !== input.excludeId && normalizeHostname(row.hostname) === hostnameKey) ?? null;
}

async function normalizeNetLinksTx(tx: any) {
  const links = await tx.select().from(netLinksTable);
  for (const link of links) {
    if (link.aNodeId > link.bNodeId) {
      await tx
        .update(netLinksTable)
        .set({
          aNodeId: link.bNodeId,
          aPort: link.bPort,
          bNodeId: link.aNodeId,
          bPort: link.aPort,
          updatedAt: new Date(),
        })
        .where(eq(netLinksTable.id, link.id));
    }
  }

  const normalized = await tx.select().from(netLinksTable);
  const byKey = new Map<string, any[]>();
  for (const link of normalized) {
    if (link.aNodeId === link.bNodeId) continue;
    const key = `${link.aNodeId}|${String(link.aPort).trim().toLowerCase()}|${link.bNodeId}|${String(link.bPort).trim().toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(link);
  }

  let deleted = 0;
  let updated = 0;
  for (const group of byKey.values()) {
    if (group.length <= 1) continue;
    const keep = pickCanonicalRowByWeight(group, (row) => linkWeight(row));
    const drop = group.filter((row) => row.id !== keep.id);
    const merged = {
      linkKind: pickFirstMeaningful(keep.linkKind, ...drop.map((row) => row.linkKind)) ?? keep.linkKind,
      speedMbps: Math.max(keep.speedMbps ?? 0, ...drop.map((row) => row.speedMbps ?? 0)) || null,
      portMode: pickFirstMeaningful(keep.portMode, ...drop.map((row) => row.portMode)),
      nativeVlan: keep.nativeVlan ?? drop.map((row) => row.nativeVlan).find((value) => value != null) ?? null,
      allowedVlans: [...new Set(group.flatMap((row) => Array.isArray(row.allowedVlans) ? row.allowedVlans : []))],
      portchannel: pickFirstMeaningful(keep.portchannel, ...drop.map((row) => row.portchannel)),
      lldpPeerHostname: pickFirstMeaningful(keep.lldpPeerHostname, ...drop.map((row) => row.lldpPeerHostname)),
      lldpPeerMgmtIp: pickFirstMeaningful(keep.lldpPeerMgmtIp, ...drop.map((row) => row.lldpPeerMgmtIp)),
      confidence: group.slice().sort((a, b) => linkWeight(b) - linkWeight(a))[0].confidence,
      lastVerifiedAt: group
        .map((row) => new Date(row.lastVerifiedAt))
        .sort((a, b) => b.getTime() - a.getTime())[0],
      evidenceRef: pickFirstMeaningful(keep.evidenceRef, ...drop.map((row) => row.evidenceRef)),
      notes: mergeNotes([keep.notes, ...drop.map((row) => row.notes)]),
      updatedAt: new Date(),
    };
    await tx.update(netLinksTable).set(merged).where(eq(netLinksTable.id, keep.id));
    await tx.delete(netLinksTable).where(inArray(netLinksTable.id, drop.map((row) => row.id)));
    updated += 1;
    deleted += drop.length;
  }

  const selfLinks = normalized.filter((link) => link.aNodeId === link.bNodeId).map((link) => link.id);
  if (selfLinks.length > 0) {
    await tx.delete(netLinksTable).where(inArray(netLinksTable.id, selfLinks));
    deleted += selfLinks.length;
  }

  return { updated, deleted };
}

export async function mergeNetNodeRows(
  primaryId: string,
  duplicateIds: string[],
  overrides: Record<string, unknown> = {},
) {
  if (duplicateIds.length === 0) return null;
  return db.transaction(async (tx: any) => {
    const linkCounts = await fetchNodeLinkCounts(tx);
    const rows = await tx.select().from(netNodesTable).where(
      or(
        eq(netNodesTable.id, primaryId),
        ...duplicateIds.map((id) => eq(netNodesTable.id, id)),
      ),
    );
    const primary = rows.find((row: any) => row.id === primaryId);
    if (!primary) throw new Error("Primary node not found during merge.");
    const duplicates = rows.filter((row: any) => row.id !== primaryId);
    const primaryHostname = String(primary.hostname ?? "").trim();
    const requestedHostname =
      normalizeHostname(String(overrides.hostname ?? primaryHostname ?? "")) || normalizeHostname(primaryHostname);
    const duplicateHostnameKeys = new Set(duplicates.map((row: any) => normalizeHostname(row.hostname)).filter(Boolean));
    const allRows = await tx.select().from(netNodesTable);
    const externalHostnameConflict = requestedHostname
      ? allRows.find((row: any) =>
        ![primaryId, ...duplicateIds].includes(String(row.id)) && normalizeHostname(row.hostname) === requestedHostname,
      ) ?? null
      : null;
    const safeHostname =
      requestedHostname && !duplicateHostnameKeys.has(requestedHostname) && !externalHostnameConflict
        ? requestedHostname
        : primaryHostname;

    const merged = {
      // IP remains authoritative during normalize; if another node already owns the requested
      // hostname, keep the current primary hostname verbatim so the merge can complete.
      hostname: safeHostname,
      displayName:
        pickFirstMeaningful(
          String(overrides.displayName ?? ""),
          primary.displayName,
          ...duplicates.map((row: any) => row.displayName),
          primary.hostname,
          ...duplicates.map((row: any) => row.hostname),
        ) ?? normalizeHostname(primary.hostname),
      nodeKind: pickBestNodeKind([String(overrides.nodeKind ?? ""), primary.nodeKind, ...duplicates.map((row: any) => row.nodeKind)]) ?? primary.nodeKind,
      vendor: pickFirstMeaningful(String(overrides.vendor ?? ""), primary.vendor, ...duplicates.map((row: any) => row.vendor)),
      model: pickFirstMeaningful(String(overrides.model ?? ""), primary.model, ...duplicates.map((row: any) => row.model)),
      mgmtIp:
        pickFirstMeaningful(
          String(overrides.mgmtIp ?? ""),
          hasAuthoritativeIp(primary.mgmtIp) ? primary.mgmtIp : null,
          ...duplicates.map((row: any) => (hasAuthoritativeIp(row.mgmtIp) ? row.mgmtIp : null)),
          primary.mgmtIp,
          ...duplicates.map((row: any) => row.mgmtIp),
        ) ?? primary.mgmtIp,
      building: pickFirstMeaningful(String(overrides.building ?? ""), primary.building, ...duplicates.map((row: any) => row.building)) ?? primary.building,
      location: pickFirstMeaningful(String(overrides.location ?? ""), primary.location, ...duplicates.map((row: any) => row.location)),
      role: pickStrongestRole([String(overrides.role ?? ""), primary.role, ...duplicates.map((row: any) => row.role)]) ?? primary.role,
      function: pickFirstMeaningful(String(overrides.function ?? ""), primary.function, ...duplicates.map((row: any) => row.function)),
      criticality:
        pickStrongestCriticality([String(overrides.criticality ?? ""), primary.criticality, ...duplicates.map((row: any) => row.criticality)]) ??
        primary.criticality,
      tags: mergeStringArrays([primary.tags, ...duplicates.map((row: any) => row.tags)]),
      status: mergeStatus([String(overrides.status ?? ""), primary.status, ...duplicates.map((row: any) => row.status)]) ?? primary.status,
      notes: mergeNotes([String(overrides.notes ?? ""), primary.notes, ...duplicates.map((row: any) => row.notes)]),
      updatedAt: new Date(),
    };

    const [updated] = await tx.update(netNodesTable).set(merged).where(eq(netNodesTable.id, primaryId)).returning();

    await tx.update(netLinksTable).set({ aNodeId: primaryId, updatedAt: new Date() }).where(inArray(netLinksTable.aNodeId, duplicateIds));
    await tx.update(netLinksTable).set({ bNodeId: primaryId, updatedAt: new Date() }).where(inArray(netLinksTable.bNodeId, duplicateIds));
    await tx
      .update(netRoutingAdjacenciesTable)
      .set({ deviceNodeId: primaryId, updatedAt: new Date() })
      .where(inArray(netRoutingAdjacenciesTable.deviceNodeId, duplicateIds));

    const positions = await tx
      .select()
      .from(networkLayoutPositionsTable)
      .where(or(eq(networkLayoutPositionsTable.nodeId, primaryId), ...duplicateIds.map((id) => eq(networkLayoutPositionsTable.nodeId, id))));
    const primaryPosition = positions.find((row: any) => row.nodeId === primaryId);
    const duplicatePositions = positions.filter((row: any) => row.nodeId !== primaryId);
    if (!primaryPosition) {
      const keepPosition = duplicatePositions[0];
      if (keepPosition) {
        await tx
          .update(networkLayoutPositionsTable)
          .set({ nodeId: primaryId, updatedAt: new Date() })
          .where(eq(networkLayoutPositionsTable.nodeId, keepPosition.nodeId));
      }
    }
    const extraPositionIds = duplicatePositions
      .slice(primaryPosition ? 0 : 1)
      .map((row: any) => row.nodeId)
      .filter((value: string) => value !== primaryId);
    if (extraPositionIds.length > 0) {
      await tx.delete(networkLayoutPositionsTable).where(inArray(networkLayoutPositionsTable.nodeId, extraPositionIds));
    }

    const primaryPorts = await tx.select().from(netPortsTable).where(eq(netPortsTable.nodeId, primaryId));
    const primaryPortByName = new Map<string, any>(
      primaryPorts.map((port: any) => [String(port.interfaceName).trim().toLowerCase(), port]),
    );
    const duplicatePorts = await tx.select().from(netPortsTable).where(inArray(netPortsTable.nodeId, duplicateIds));
    for (const port of duplicatePorts) {
      const key = String(port.interfaceName).trim().toLowerCase();
      const keep = primaryPortByName.get(key);
      if (!keep) {
        await tx.update(netPortsTable).set({ nodeId: primaryId, updatedAt: new Date() }).where(eq(netPortsTable.id, port.id));
        primaryPortByName.set(key, { ...port, nodeId: primaryId });
        continue;
      }
      const newerTelemetry = !keep.telemetryUpdatedAt || !!(port.telemetryUpdatedAt && new Date(port.telemetryUpdatedAt).getTime() > new Date(keep.telemetryUpdatedAt).getTime());
      const newerConfig = !keep.configUpdatedAt || !!(port.configUpdatedAt && new Date(port.configUpdatedAt).getTime() > new Date(keep.configUpdatedAt).getTime());
      await tx.update(netPortsTable).set({
        description: newerConfig ? port.description ?? keep.description : keep.description ?? port.description,
        portMode: newerConfig ? port.portMode ?? keep.portMode : keep.portMode ?? port.portMode,
        nativeVlan: newerConfig ? port.nativeVlan ?? keep.nativeVlan : keep.nativeVlan ?? port.nativeVlan,
        allowedVlans: newerConfig ? port.allowedVlans ?? keep.allowedVlans : keep.allowedVlans ?? port.allowedVlans,
        portchannel: newerConfig ? port.portchannel ?? keep.portchannel : keep.portchannel ?? port.portchannel,
        vpcId: newerConfig ? port.vpcId ?? keep.vpcId : keep.vpcId ?? port.vpcId,
        adminStatus: newerTelemetry ? port.adminStatus ?? keep.adminStatus : keep.adminStatus ?? port.adminStatus,
        operStatus: newerTelemetry ? port.operStatus ?? keep.operStatus : keep.operStatus ?? port.operStatus,
        statusReason: newerTelemetry ? port.statusReason ?? keep.statusReason : keep.statusReason ?? port.statusReason,
        speedMbps: newerTelemetry ? port.speedMbps ?? keep.speedMbps : keep.speedMbps ?? port.speedMbps,
        duplex: newerTelemetry ? port.duplex ?? keep.duplex : keep.duplex ?? port.duplex,
        mediaType: newerTelemetry ? port.mediaType ?? keep.mediaType : keep.mediaType ?? port.mediaType,
        macCount: newerTelemetry ? port.macCount ?? keep.macCount : keep.macCount ?? port.macCount,
        lldpNeighborCount: newerTelemetry ? port.lldpNeighborCount ?? keep.lldpNeighborCount : keep.lldpNeighborCount ?? port.lldpNeighborCount,
        telemetryEvidence: newerTelemetry ? port.telemetryEvidence ?? keep.telemetryEvidence : keep.telemetryEvidence ?? port.telemetryEvidence,
        telemetryUpdatedAt: newerTelemetry ? port.telemetryUpdatedAt ?? keep.telemetryUpdatedAt : keep.telemetryUpdatedAt,
        configUpdatedAt: newerConfig ? port.configUpdatedAt ?? keep.configUpdatedAt : keep.configUpdatedAt,
        updatedAt: new Date(),
      }).where(eq(netPortsTable.id, keep.id));
      await tx.delete(netPortsTable).where(eq(netPortsTable.id, port.id));
    }

    await tx.delete(netNodesTable).where(inArray(netNodesTable.id, duplicateIds));
    await normalizeNetLinksTx(tx);
    return updated;
  });
}

export async function saveNetNodeByIdentity(
  input: {
    hostname: string;
    displayName: string;
    nodeKind: string;
    vendor?: string | null;
    model?: string | null;
    mgmtIp?: string | null;
    building: string;
    location?: string | null;
    role: string;
    function?: string | null;
    criticality?: string | null;
    tags?: string[] | null;
    status?: string | null;
    notes?: string | null;
  },
  existingId?: string | null,
) {
  const payload = {
    ...input,
    hostname: normalizeHostname(input.hostname),
    displayName: input.displayName?.trim() || normalizeHostname(input.hostname),
    vendor: input.vendor?.trim() || null,
    model: input.model?.trim() || null,
    mgmtIp: input.mgmtIp?.trim() || null,
    building: input.building?.trim() || "Unknown",
    location: input.location?.trim() || null,
    function: input.function?.trim() || null,
    criticality: input.criticality?.trim().toLowerCase() || "medium",
    status: input.status?.trim().toLowerCase() || null,
    notes: input.notes?.trim() || null,
    tags: input.tags ?? null,
  };

  const current = existingId
    ? (await db.select().from(netNodesTable).where(eq(netNodesTable.id, existingId)))[0] ?? null
    : null;
  if (existingId && !current) throw new Error("Node not found");

  const match = await findNetNodeByIdentity({ hostname: payload.hostname, mgmtIp: payload.mgmtIp, excludeId: existingId ?? null });
  if (current && match && match.id !== current.id) {
    const merged = await mergeNetNodeRows(match.id, [current.id], payload);
    return { row: merged, action: "merged" as const };
  }

  const target = match ?? current;
  if (target) {
    const hostnameConflict =
      payload.hostname
        ? await findNetNodeByIdentity({ hostname: payload.hostname, mgmtIp: null, excludeId: target.id })
        : null;
    if (hostnameConflict && hostnameConflict.id !== target.id) {
      const merged = await mergeNetNodeRows(target.id, [hostnameConflict.id], payload);
      return { row: merged, action: "merged" as const };
    }
    const [row] = await db
      .update(netNodesTable)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(netNodesTable.id, target.id))
      .returning();
    return { row, action: match ? "merged" as const : "updated" as const };
  }

  const [row] = await db.insert(netNodesTable).values(payload).returning();
  return { row, action: "created" as const };
}

export async function saveNetLinkByIdentity(
  input: {
    aNodeId: string;
    aPort: string;
    bNodeId: string;
    bPort: string;
    linkKind: string;
    speedMbps?: number | null;
    portMode?: string | null;
    nativeVlan?: number | null;
    allowedVlans?: number[] | null;
    portchannel?: string | null;
    lldpPeerHostname?: string | null;
    lldpPeerMgmtIp?: string | null;
    confidence: string;
    lastVerifiedAt: string | Date;
    evidenceRef?: string | null;
    notes?: string | null;
  },
  existingId?: string | null,
) {
  let payload = {
    ...input,
    aPort: input.aPort.trim(),
    bPort: input.bPort.trim(),
    portMode: input.portMode?.trim() || null,
    portchannel: input.portchannel?.trim() || null,
    lldpPeerHostname: input.lldpPeerHostname?.trim() || null,
    lldpPeerMgmtIp: input.lldpPeerMgmtIp?.trim() || null,
    evidenceRef: input.evidenceRef?.trim() || null,
    notes: input.notes?.trim() || null,
    lastVerifiedAt: new Date(input.lastVerifiedAt),
    allowedVlans: input.allowedVlans ?? null,
    speedMbps: input.speedMbps ?? null,
    nativeVlan: input.nativeVlan ?? null,
  };
  if (payload.aNodeId > payload.bNodeId) {
    payload = {
      ...payload,
      aNodeId: input.bNodeId,
      aPort: input.bPort.trim(),
      bNodeId: input.aNodeId,
      bPort: input.aPort.trim(),
    };
  }

  const links = await db.select().from(netLinksTable);
  const current = existingId ? links.find((row) => row.id === existingId) ?? null : null;
  const existing = links.find((row) =>
    row.id !== existingId &&
    row.aNodeId === payload.aNodeId &&
    row.bNodeId === payload.bNodeId &&
    String(row.aPort).trim().toLowerCase() === payload.aPort.trim().toLowerCase() &&
    String(row.bPort).trim().toLowerCase() === payload.bPort.trim().toLowerCase(),
  ) ?? null;

  if (current && existing && existing.id !== current.id) {
    await db.delete(netLinksTable).where(eq(netLinksTable.id, current.id));
    const [row] = await db
      .update(netLinksTable)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(netLinksTable.id, existing.id))
      .returning();
    return { row, action: "merged" as const };
  }

  const target = existing ?? current;
  if (target) {
    const [row] = await db
      .update(netLinksTable)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(netLinksTable.id, target.id))
      .returning();
    return { row, action: existing ? "merged" as const : "updated" as const };
  }

  const [row] = await db.insert(netLinksTable).values(payload as any).returning();
  return { row, action: "created" as const };
}

export async function normalizeNetworkIdentityData() {
  const summary = {
    switchGroupsMerged: 0,
    switchRowsDeleted: 0,
    nodeGroupsMerged: 0,
    nodeRowsDeleted: 0,
    linkRowsDeleted: 0,
    linkRowsNormalized: 0,
  };

  const switches = await db.select().from(networkSwitchesTable);
  const switchesByIp = new Map<string, typeof switches>();
  for (const row of switches) {
    if (!hasAuthoritativeIp(row.ipAddress)) continue;
    const key = normalizeIp(row.ipAddress)!;
    if (!switchesByIp.has(key)) switchesByIp.set(key, []);
    switchesByIp.get(key)!.push(row);
  }

  for (const group of switchesByIp.values()) {
    if (group.length <= 1) continue;
    const primary = pickCanonicalRowByWeight(group, (row) => rowWeight({
      hostname: row.hostname,
      building: row.building,
      model: row.model,
      notes: row.notes,
      updatedAt: row.updatedAt,
      mgmtIp: row.ipAddress,
    }));
    const duplicates = group.filter((row) => row.id !== primary.id);
    await mergeSwitchRows(primary.id, duplicates.map((row) => row.id));
    summary.switchGroupsMerged += 1;
    summary.switchRowsDeleted += duplicates.length;
  }

  const switchRows = await db.select().from(networkSwitchesTable);
  const switchByIp = new Map<string, any>();
  for (const row of switchRows) {
    if (hasAuthoritativeIp(row.ipAddress)) switchByIp.set(normalizeIp(row.ipAddress)!, row);
  }

  const nodes = await db.select().from(netNodesTable);
  const linkCounts = await fetchNodeLinkCounts();
  const groups = new Map<string, typeof nodes>();
  for (const row of nodes) {
    const key = hasAuthoritativeIp(row.mgmtIp) ? `ip:${normalizeIp(row.mgmtIp)}` : `host:${normalizeHostname(row.hostname)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  for (const [key, group] of groups) {
    if (group.length <= 1) continue;
    const authoritativeIp = key.startsWith("ip:") ? key.slice(3) : null;
    const inventoryRow = authoritativeIp ? switchByIp.get(authoritativeIp) ?? null : null;
    const primary =
      group.find((row) => inventoryRow && normalizeHostname(row.hostname) === normalizeHostname(inventoryRow.hostname)) ??
      pickCanonicalRowByWeight(group, (row) =>
        rowWeight(row, linkCounts.get(row.id) ?? 0) + (inventoryRow && normalizeHostname(row.hostname) === normalizeHostname(inventoryRow.hostname) ? 50 : 0),
      );
    const duplicates = group.filter((row) => row.id !== primary.id);
    await mergeNetNodeRows(primary.id, duplicates.map((row) => row.id), inventoryRow ? {
      hostname: inventoryRow.hostname,
      displayName: inventoryRow.hostname,
      mgmtIp: inventoryRow.ipAddress,
      building: inventoryRow.building,
      model: inventoryRow.model,
      notes: inventoryRow.notes,
      location: inventoryRow.location,
      status: inventoryRow.status,
    } : {});
    summary.nodeGroupsMerged += 1;
    summary.nodeRowsDeleted += duplicates.length;
  }

  const linkSummary = await db.transaction(async (tx: any) => normalizeNetLinksTx(tx));
  summary.linkRowsDeleted += linkSummary.deleted;
  summary.linkRowsNormalized += linkSummary.updated;

  return summary;
}
