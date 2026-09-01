export const ZENDESK_DASHBOARD_FIRST_NAMES = [
  "tracy",
  "mark",
  "maria",
  "lucas",
  "illia",
  "craig",
] as const;

function normalizedFirstName(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
    .replace(/[^a-z]/g, "");
}

export function isZendeskDashboardTeamMember(
  user: { name?: string | null; isActive?: boolean | null },
): boolean {
  return Boolean(
    user.isActive &&
      ZENDESK_DASHBOARD_FIRST_NAMES.includes(
        normalizedFirstName(user.name) as (typeof ZENDESK_DASHBOARD_FIRST_NAMES)[number],
      ),
  );
}

export function zendeskDashboardTeamOrder(name: string | null | undefined): number {
  const index = ZENDESK_DASHBOARD_FIRST_NAMES.indexOf(
    normalizedFirstName(name) as (typeof ZENDESK_DASHBOARD_FIRST_NAMES)[number],
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
