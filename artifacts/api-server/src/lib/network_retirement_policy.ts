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

const normalizedIp = (value: string | null | undefined) =>
  String(value ?? "").trim().toLowerCase();

const authoritativeIp = (value: string | null | undefined) => {
  const normalized = normalizedIp(value);
  return normalized && !NON_AUTHORITATIVE_IPS.has(normalized)
    ? normalized
    : null;
};

const normalizedHostname = (value: string | null | undefined) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.sccc\.edu$/i, "")
    .replace(/\s+/g, "");

/**
 * Match the topology representation of one maintained switch without allowing
 * a shared/stale hostname to override two conflicting, authoritative IPs.
 */
export function topologyNodeMatchesSwitch(
  networkSwitch: { hostname?: string | null; ipAddress?: string | null },
  node: { hostname?: string | null; mgmtIp?: string | null },
): boolean {
  const switchIp = authoritativeIp(networkSwitch.ipAddress);
  const nodeIp = authoritativeIp(node.mgmtIp);
  if (switchIp && nodeIp) return switchIp === nodeIp;

  const switchHostname = normalizedHostname(networkSwitch.hostname);
  const nodeHostname = normalizedHostname(node.hostname);
  return Boolean(switchHostname && switchHostname === nodeHostname);
}
