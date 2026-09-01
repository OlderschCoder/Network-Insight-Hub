import { sql } from "drizzle-orm";

type Entity = { entity_type: string; natural_key: string; name: string; building?: string | null; attributes: unknown; source: string; source_timestamp?: string | null };
type Relationship = { relationship_type: string; from_type: string; from_key: string; to_type: string; to_key: string; attributes: unknown; source: string };

const value = (input: unknown) => String(input ?? "").trim();
const key = (...parts: unknown[]) => parts.map(value).filter(Boolean).join(":");

export function buildArchitectureProjection(evidence: any): { entities: Entity[]; relationships: Relationship[] } {
  const generatedAt = value(evidence?.generatedAt) || new Date().toISOString();
  const inventory = evidence?.inventory ?? {};
  const switchHostnameCounts = new Map<string, number>();
  for (const row of inventory.switches ?? []) {
    const hostname = value(row.hostname).toLowerCase();
    if (hostname) switchHostnameCounts.set(hostname, (switchHostnameCounts.get(hostname) ?? 0) + 1);
  }
  const entities: Entity[] = [];
  const relationships: Relationship[] = [];
  const add = (entity_type: string, natural_key: string, name: string, attributes: unknown, source: string, building?: string | null, source_timestamp?: string | null) => {
    if (!natural_key) return;
    entities.push({ entity_type, natural_key, name: name || natural_key, building: building || null, attributes, source, source_timestamp: source_timestamp || generatedAt });
  };
  const contains = (building: unknown, entity_type: string, natural_key: string, source: string) => {
    const buildingName = value(building);
    if (buildingName && natural_key) relationships.push({ relationship_type: "building_contains", from_type: "building", from_key: buildingName, to_type: entity_type, to_key: natural_key, attributes: {}, source });
  };

  for (const row of inventory.buildingCoverage ?? []) add("building", value(row.building), value(row.building), row, "Buildings", row.building);
  for (const row of inventory.switches ?? []) {
    const hostname = value(row.hostname) || value(row.id);
    const natural_key = (switchHostnameCounts.get(hostname.toLowerCase()) ?? 0) > 1
      ? key(hostname, row.ipAddress || row.id)
      : hostname;
    add("switch", natural_key, value(row.hostname), row, "Network Inventory", row.building, row.updatedAt);
    contains(row.building, "switch", natural_key, "Network Inventory");
  }
  for (const row of inventory.nodes ?? []) {
    const natural_key = value(row.id) || value(row.hostname);
    add("network_node", natural_key, value(row.displayName) || value(row.hostname), row, "Network Map", row.building, row.updatedAt);
    contains(row.building, "network_node", natural_key, "Network Map");
  }
  for (const row of inventory.vlans ?? []) {
    const natural_key = key(row.building || "global", row.vlanId);
    add("vlan", natural_key, `${value(row.vlanId)} ${value(row.name)}`.trim(), row, "Network Inventory", row.building, row.updatedAt);
    contains(row.building, "vlan", natural_key, "Network Inventory");
  }
  for (const row of inventory.ports ?? []) {
    const natural_key = key(row.nodeId, row.name || row.id);
    add("port", natural_key, value(row.name) || value(row.id), row, "Port Map", null, row.telemetryUpdatedAt || row.updatedAt);
    relationships.push({ relationship_type: "node_has_port", from_type: "network_node", from_key: value(row.nodeId), to_type: "port", to_key: natural_key, attributes: {}, source: "Port Map" });
  }
  for (const row of inventory.links ?? []) {
    const natural_key = value(row.id) || key(row.aNodeId, row.aPort, row.zNodeId, row.zPort);
    add("network_link", natural_key, natural_key, row, "Network Map", null, row.lastVerifiedAt);
    relationships.push({ relationship_type: "network_link", from_type: "network_node", from_key: value(row.aNodeId), to_type: "network_node", to_key: value(row.zNodeId), attributes: row, source: "Network Map" });
  }
  for (const row of inventory.routing ?? []) add("routing_adjacency", value(row.id) || key(row.localNodeId, row.neighborId), value(row.neighborId) || "Routing adjacency", row, "Network Map", null, row.lastSeenAt);
  for (const row of inventory.phoneAssignments ?? []) add("phone_building", value(row.building), `${value(row.building)} phones`, row, "Cisco Calling", row.building);
  for (const row of inventory.configFacts ?? []) add("device_configuration", value(row.hostname) || value(row.id), value(row.hostname) || "Device configuration", row, "Configuration Backups", row.building, row.capturedAt);
  for (const row of evidence?.cloud?.azureResources ?? []) add("azure_resource", value(row.resourceId) || value(row.id) || key(row.type, row.name), value(row.name), row, "Azure ARM", null, row.updatedAt);
  for (const row of evidence?.operations?.processes ?? []) add("process", value(row.id) || value(row.name), value(row.name) || value(row.title), row, "Process Library", null, row.updatedAt);
  for (const row of evidence?.operations?.projects ?? []) add("project", value(row.id) || value(row.name), value(row.name) || value(row.title), row, "Projects", null, row.updatedAt);
  const uniqueEntities = [...new Map(entities.map((row) => [`${row.entity_type}\u0000${row.natural_key}`, row])).values()];
  const uniqueRelationships = [...new Map(relationships.map((row) => [
    `${row.relationship_type}\u0000${row.from_type}\u0000${row.from_key}\u0000${row.to_type}\u0000${row.to_key}`,
    row,
  ])).values()];
  return { entities: uniqueEntities, relationships: uniqueRelationships };
}

export async function storeArchitectureProjection(snapshotId: number, evidence: any): Promise<{ entities: number; relationships: number }> {
  const { db } = await import("@workspace/db");
  const projection = buildArchitectureProjection(evidence);
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM fred_architecture_relationships WHERE snapshot_id = ${snapshotId}`);
    await tx.execute(sql`DELETE FROM fred_architecture_entities WHERE snapshot_id = ${snapshotId}`);
    if (projection.entities.length) await tx.execute(sql`
      INSERT INTO fred_architecture_entities (snapshot_id, entity_type, natural_key, name, building, attributes, source, source_timestamp)
      SELECT ${snapshotId}, x.entity_type, x.natural_key, x.name, NULLIF(x.building, ''), x.attributes, x.source, NULLIF(x.source_timestamp, '')::timestamptz
      FROM jsonb_to_recordset(${JSON.stringify(projection.entities)}::jsonb)
      AS x(entity_type text, natural_key text, name text, building text, attributes jsonb, source text, source_timestamp text)
      ON CONFLICT (snapshot_id, entity_type, natural_key) DO UPDATE SET attributes = EXCLUDED.attributes, source_timestamp = EXCLUDED.source_timestamp
    `);
    if (projection.relationships.length) await tx.execute(sql`
      INSERT INTO fred_architecture_relationships (snapshot_id, relationship_type, from_type, from_key, to_type, to_key, attributes, source)
      SELECT ${snapshotId}, x.relationship_type, x.from_type, x.from_key, x.to_type, x.to_key, x.attributes, x.source
      FROM jsonb_to_recordset(${JSON.stringify(projection.relationships)}::jsonb)
      AS x(relationship_type text, from_type text, from_key text, to_type text, to_key text, attributes jsonb, source text)
    `);
  });
  return { entities: projection.entities.length, relationships: projection.relationships.length };
}
