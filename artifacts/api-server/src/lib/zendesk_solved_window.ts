const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new Error("Invalid date format, use YYYY-MM-DD");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid calendar date");
  }
  return date;
}

function addUtcDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type ZendeskSolvedWindow = {
  start: string;
  endExclusive: string;
};

/**
 * Return the exact solved-at window used for a daily or weekly ticket rollup.
 * Zendesk evaluates this window server-side, so a later comment/update cannot
 * move a ticket out of the week in which it was solved.
 */
export function zendeskSolvedWindow(
  date: string,
  weekOf?: string,
): ZendeskSolvedWindow {
  const start = weekOf || date;
  parseIsoDate(start);
  return {
    start,
    endExclusive: addUtcDays(start, weekOf ? 7 : 1),
  };
}

export function zendeskSolvedTicketQuery(
  group: string,
  window: ZendeskSolvedWindow,
): string {
  const safeGroup = group.replace(/["\\]/g, "");
  return `type:ticket solved>=${window.start} solved<${window.endExclusive} group:"${safeGroup}"`;
}
