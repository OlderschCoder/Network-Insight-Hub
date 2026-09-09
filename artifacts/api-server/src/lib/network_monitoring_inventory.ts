export type MonitoringInventoryRow = {
  id: number;
  hostname: string;
  building: string;
  mgmtIp: string;
  model: string | null;
  status: string | null;
  lastSeen: Date | null;
  location: string | null;
};

export type MonitoringMapNode = {
  id: string;
  hostname: string;
  displayName: string;
  nodeKind: string;
  vendor: string | null;
  model: string | null;
  mgmtIp: string | null;
  building: string;
  location: string | null;
  role: string;
};

function identityKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.sccc\.edu$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}
function inferredKind(row: MonitoringInventoryRow): string {
  const fingerprint = identityKey(`${row.hostname} ${row.location ?? ""}`);
  if (!row.model && /svi/.test(fingerprint)) return "svi";
  if (!row.model && /boilerroom/.test(fingerprint)) return "endpoint";
  return "switch";
}

/**
 * Enrich legacy switch-inventory rows with the authoritative topology identity.
 * The inventory remains the source of operational state, while net_nodes owns
 * device kind, role, display name, and the UUID used by node-detail routes.
 */
export function mergeMonitoringInventory(
  inventory: MonitoringInventoryRow[],
  mapNodes: MonitoringMapNode[],
) {
  const mapByIp = new Map(
    mapNodes.filter((node) => node.mgmtIp).map((node) => [node.mgmtIp!, node]),
  );
  const mapByHostname = new Map(mapNodes.map((node) => [identityKey(node.hostname), node]));

  return inventory.map((row) => {
    const mapNode = mapByIp.get(row.mgmtIp) ?? mapByHostname.get(identityKey(row.hostname));
    const nodeKind = mapNode?.nodeKind ?? inferredKind(row);
    return {
      ...row,
      id: mapNode?.id ?? String(row.id),
      displayName: mapNode?.displayName || row.hostname,
      nodeKind,
      vendor: mapNode?.vendor ?? row.model?.split(/\s+/)[0] ?? null,
      role: mapNode?.role ?? (nodeKind === "svi" ? "svi" : null),
      building: mapNode?.building || row.building,
      location: mapNode?.location ?? row.location,
      model: mapNode?.model ?? row.model,
      mgmtIp: mapNode?.mgmtIp ?? row.mgmtIp,
    };
  });
}
