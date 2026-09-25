type SwitchIdentity = {
  hostname?: string | null;
  ipAddress?: string | null;
};

type TopologyNodeIdentity = {
  id: string;
  hostname?: string | null;
  mgmtIp?: string | null;
  nodeKind?: string | null;
  building: string;
};

const NON_AUTHORITATIVE_IPS = new Set([
  "",
  "-",
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "0.0.0.0",
]);

const normalizeIp = (value: string | null | undefined) =>
  String(value ?? "").trim().toLowerCase();

const normalizeHostname = (value: string | null | undefined) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.sccc\.edu$/i, "")
    .replace(/\s+/g, "");

const physicalNode = (node: TopologyNodeIdentity) =>
  ["switch", "firewall"].includes(String(node.nodeKind ?? "").toLowerCase());

/**
 * Locate the topology node owned by a maintained switch record. Management IP
 * is authoritative; hostname is a fallback only when neither the previous nor
 * resulting management IP matches a physical topology node.
 */
export function selectTopologyNodesForMaintainedSwitch<
  T extends TopologyNodeIdentity,
>(
  nodes: T[],
  previous: SwitchIdentity | null,
  resulting: SwitchIdentity,
): T[] {
  const physicalNodes = nodes.filter(physicalNode);
  const ips = [previous?.ipAddress, resulting.ipAddress]
    .map(normalizeIp)
    .filter((value, index, all) =>
      !NON_AUTHORITATIVE_IPS.has(value) && all.indexOf(value) === index,
    );
  for (const ip of ips) {
    const matches = physicalNodes.filter((node) => normalizeIp(node.mgmtIp) === ip);
    if (matches.length > 0) return matches;
  }

  const hostnames = [previous?.hostname, resulting.hostname]
    .map(normalizeHostname)
    .filter((value, index, all) => value && all.indexOf(value) === index);
  for (const hostname of hostnames) {
    const matches = physicalNodes.filter(
      (node) => normalizeHostname(node.hostname) === hostname,
    );
    if (matches.length > 0) return matches;
  }
  return [];
}
