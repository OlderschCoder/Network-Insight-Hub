import {
  zendeskSolvedTicketQuery,
  zendeskSolvedWindow,
} from "./zendesk_solved_window";

export type ZendeskReportTicket = {
  id: number;
  subject: string;
  status: string;
  assigneeName: string | null;
  updatedAt: string;
  url: string;
};

export type ZendeskReportTicketResult = {
  configured: boolean;
  count: number | null;
  tickets: ZendeskReportTicket[];
};

type ZendeskSearchRow = {
  id: number;
  subject?: string;
  status?: string;
  assignee_id?: number | null;
  updated_at?: string;
};

type ZendeskConfig = {
  baseUrl: string;
  agentBaseUrl: string;
  headers: Record<string, string>;
  group: string;
};

function readZendeskConfig(): ZendeskConfig | null {
  const subdomain = process.env.ZENDESK_SUBDOMAIN?.trim();
  const email = process.env.ZENDESK_EMAIL?.trim();
  const token = process.env.ZENDESK_API_TOKEN?.trim();
  if (!subdomain || !email || !token) return null;
  if (!/^[A-Za-z0-9-]+$/.test(subdomain)) {
    throw new Error("Zendesk subdomain is invalid");
  }
  return {
    baseUrl: `https://${subdomain}.zendesk.com/api/v2/`,
    agentBaseUrl: `https://${subdomain}.zendesk.com/agent/tickets/`,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}/token:${token}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    group: process.env.ZENDESK_GROUP?.trim() || "Onsite_it",
  };
}

export function trustedZendeskApiUrl(
  baseUrl: string,
  candidate: string,
): string {
  const base = new URL(baseUrl);
  const resolved = new URL(candidate, base);
  if (
    resolved.protocol !== "https:" ||
    resolved.origin !== base.origin ||
    !resolved.pathname.startsWith(base.pathname)
  ) {
    throw new Error("Zendesk pagination returned an untrusted URL");
  }
  return resolved.href;
}

export async function fetchCompleteZendeskSearch(
  baseUrl: string,
  firstUrl: string,
  headers: Record<string, string>,
  fetchPage: typeof fetch = fetch,
  maxPages = 10,
): Promise<ZendeskSearchRow[]> {
  const rows: ZendeskSearchRow[] = [];
  const seen = new Set<string>();
  let nextUrl: string | null = trustedZendeskApiUrl(baseUrl, firstUrl);
  let pages = 0;

  while (nextUrl) {
    if (pages >= maxPages) {
      throw new Error("Zendesk search exceeded the safe page limit");
    }
    const trustedUrl = trustedZendeskApiUrl(baseUrl, nextUrl);
    if (seen.has(trustedUrl)) {
      throw new Error("Zendesk pagination repeated a page");
    }
    seen.add(trustedUrl);

    const response = await fetchPage(trustedUrl, { headers });
    if (!response.ok) {
      throw new Error(`Zendesk search failed (${response.status})`);
    }
    const data = (await response.json()) as {
      results?: unknown;
      next_page?: unknown;
    };
    if (!Array.isArray(data.results)) {
      throw new Error("Zendesk search returned an invalid result page");
    }
    rows.push(...(data.results as ZendeskSearchRow[]));
    nextUrl =
      typeof data.next_page === "string" && data.next_page.trim()
        ? trustedZendeskApiUrl(baseUrl, data.next_page)
        : null;
    pages += 1;
  }

  return rows;
}

export async function fetchSolvedZendeskTickets(
  weekOf: string,
  fetchPage: typeof fetch = fetch,
): Promise<ZendeskReportTicketResult> {
  const config = readZendeskConfig();
  if (!config) return { configured: false, count: null, tickets: [] };

  const solvedWindow = zendeskSolvedWindow(weekOf, weekOf);
  const firstUrl = new URL("search.json", config.baseUrl);
  firstUrl.searchParams.set(
    "query",
    zendeskSolvedTicketQuery(config.group, solvedWindow),
  );
  firstUrl.searchParams.set("per_page", "100");
  const rows = await fetchCompleteZendeskSearch(
    config.baseUrl,
    firstUrl.href,
    config.headers,
    fetchPage,
  );

  const assigneeIds = Array.from(
    new Set(
      rows
        .map((ticket) => ticket.assignee_id)
        .filter((id): id is number => typeof id === "number" && id > 0),
    ),
  );
  const userNames = new Map<number, string>();
  for (let offset = 0; offset < assigneeIds.length; offset += 100) {
    const ids = assigneeIds.slice(offset, offset + 100);
    const usersUrl = new URL("users/show_many.json", config.baseUrl);
    usersUrl.searchParams.set("ids", ids.join(","));
    const response = await fetchPage(
      trustedZendeskApiUrl(config.baseUrl, usersUrl.href),
      { headers: config.headers },
    );
    if (!response.ok) {
      throw new Error(`Zendesk user lookup failed (${response.status})`);
    }
    const data = (await response.json()) as { users?: unknown };
    if (!Array.isArray(data.users)) {
      throw new Error("Zendesk user lookup returned an invalid response");
    }
    for (const user of data.users as Array<{ id?: unknown; name?: unknown }>) {
      if (typeof user.id === "number" && typeof user.name === "string") {
        userNames.set(user.id, user.name);
      }
    }
  }

  const tickets = rows.map((ticket) => ({
    id: ticket.id,
    subject: ticket.subject ?? "",
    status: ticket.status ?? "unknown",
    assigneeName:
      typeof ticket.assignee_id === "number"
        ? (userNames.get(ticket.assignee_id) ?? null)
        : null,
    updatedAt: ticket.updated_at ?? "",
    url: `${config.agentBaseUrl}${ticket.id}`,
  }));
  return { configured: true, count: tickets.length, tickets };
}
