export type NetworkToolsUser = {
  role?: string | null;
  canUseNetworkTools?: boolean | null;
};

const NETWORK_ADMIN_ROLES = new Set(["cio", "network", "network_engineer"]);

export function canUseNetworkTools(
  user: NetworkToolsUser | null | undefined,
): boolean {
  return Boolean(
    user &&
    (user.canUseNetworkTools === true ||
      (user.role != null && NETWORK_ADMIN_ROLES.has(user.role))),
  );
}
