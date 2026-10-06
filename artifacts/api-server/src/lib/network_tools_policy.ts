export type NetworkToolsActor = {
  role?: string | null;
  canUseNetworkTools?: boolean | null;
};

const NETWORK_ADMIN_ROLES = new Set(["cio", "network", "network_engineer"]);

export function canUseNetworkTools(
  actor: NetworkToolsActor | null | undefined,
): boolean {
  return Boolean(
    actor &&
    (actor.canUseNetworkTools === true ||
      (actor.role != null && NETWORK_ADMIN_ROLES.has(actor.role))),
  );
}
