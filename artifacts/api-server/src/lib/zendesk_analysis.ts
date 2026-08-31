import { getOpenAI, isAIConfigured } from "./openai";

type ZendeskConfig = {
  subdomain: string;
  base: string;
  headers: Record<string, string>;
};

type ZendeskUser = {
  id: number;
  name: string;
  email: string;
};

type ZendeskSearchTicket = {
  id: number;
  subject: string;
  status: string;
  priority?: string | null;
  assignee_id: number | null;
  created_at: string;
  updated_at: string;
};

type ZendeskFullTicket = ZendeskSearchTicket & {
  description?: string | null;
};

type ZendeskComment = {
  id: number;
  body: string;
  plain_body?: string;
  public: boolean;
  created_at: string;
};

export interface ZendeskTicketAnalysisOptions {
  query?: string;
  status?: string;
  assigneeEmail?: string;
  group?: string;
  allGroups?: boolean;
  maxResults?: number;
  detailSampleSize?: number;
  includeComments?: boolean;
}

export interface ZendeskTicketAnalysisResult {
  generatedAt: string;
  scope: string;
  searchQuery: string;
  ticketCount: number;
  detailSampleSize: number;
  statusCounts: Record<string, number>;
  ticketIds: number[];
  analysis: string;
}

export function getZendeskConfig(): ZendeskConfig | null {
  const subdomain = process.env.ZENDESK_SUBDOMAIN?.trim();
  const email = process.env.ZENDESK_EMAIL?.trim();
  const token = process.env.ZENDESK_API_TOKEN?.trim();
  if (!subdomain || !email || !token) return null;
  const auth = Buffer.from(`${email}/token:${token}`).toString("base64");
  return {
    subdomain,
    base: `https://${subdomain}.zendesk.com/api/v2`,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  };
}

export function getDefaultZendeskGroup(): string {
  return process.env.ZENDESK_GROUP?.trim() || "ONSITE_IT";
}

async function zendeskFetch<T>(cfg: ZendeskConfig, method: string, path: string): Promise<T> {
  const response = await fetch(`${cfg.base}/${path}`, { method, headers: cfg.headers });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Zendesk ${response.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

export async function resolveZendeskUserByEmail(
  cfg: ZendeskConfig,
  email: string,
): Promise<ZendeskUser | null> {
  const normalized = email.trim();
  if (!normalized) return null;
  const { users } = await zendeskFetch<{ users: ZendeskUser[] }>(
    cfg,
    "GET",
    `users/search.json?query=${encodeURIComponent(`email:${normalized}`)}`,
  );
  return users?.[0] ?? null;
}

function cleanText(value: string | null | undefined, max = 500): string {
  const text = (value ?? "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}...` : text;
}

function summarizeStatusCounts(tickets: ZendeskSearchTicket[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ticket of tickets) {
    const key = ticket.status || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function searchZendeskTickets(
  cfg: ZendeskConfig,
  opts: ZendeskTicketAnalysisOptions,
): Promise<{ scope: string; searchQuery: string; tickets: ZendeskSearchTicket[] }> {
  const query = (opts.query ?? "").trim();
  const status = (opts.status ?? "").trim();
  const assigneeEmail = (opts.assigneeEmail ?? "").trim();
  const allGroups = opts.allGroups === true;
  const group = (opts.group ?? getDefaultZendeskGroup()).trim();
  const maxResults = Math.max(1, Math.min(Number(opts.maxResults) || 100, 1000));
  const perPage = Math.min(maxResults, 100);

  const queryParts = ["type:ticket"];
  if (!allGroups && group) queryParts.push(`group:"${group}"`);
  if (query) queryParts.push(query);
  if (status) queryParts.push(`status:${status}`);
  if (assigneeEmail) {
    const user = await resolveZendeskUserByEmail(cfg, assigneeEmail);
    if (!user) throw new Error(`No Zendesk user found for ${assigneeEmail}`);
    queryParts.push(`assignee:${user.id}`);
  }

  const searchQuery = queryParts.join(" ").trim();
  const tickets: ZendeskSearchTicket[] = [];
  let nextUrl: string | null =
    `search.json?query=${encodeURIComponent(searchQuery)}&sort_by=updated_at&sort_order=desc&per_page=${perPage}`;
  let pages = 0;

  while (nextUrl && tickets.length < maxResults && pages < 10) {
    const data = await zendeskFetch<{ results: ZendeskSearchTicket[]; next_page: string | null }>(
      cfg,
      "GET",
      nextUrl,
    );
    tickets.push(...(data.results || []));
    pages++;
    nextUrl = data.next_page ? data.next_page.replace(`${cfg.base}/`, "") : null;
  }

  return {
    scope: allGroups ? "all_groups" : group,
    searchQuery,
    tickets: tickets.slice(0, maxResults),
  };
}

async function fetchTicketEvidence(
  cfg: ZendeskConfig,
  tickets: ZendeskSearchTicket[],
  detailSampleSize: number,
  includeComments: boolean,
) {
  const sample = tickets.slice(0, detailSampleSize);
  return Promise.all(sample.map(async (ticket) => {
    try {
      const { ticket: fullTicket } = await zendeskFetch<{ ticket: ZendeskFullTicket }>(
        cfg,
        "GET",
        `tickets/${ticket.id}.json`,
      );
      let commentLines: string[] = [];
      if (includeComments) {
        const { comments } = await zendeskFetch<{ comments: ZendeskComment[] }>(
          cfg,
          "GET",
          `tickets/${ticket.id}/comments.json?sort_order=desc`,
        );
        commentLines = (comments || [])
          .slice(0, 6)
          .reverse()
          .map((comment) =>
            `[${comment.created_at.slice(0, 10)} ${comment.public ? "public" : "internal"}] ${cleanText(comment.plain_body || comment.body, 240)}`,
          );
      }
      return {
        id: fullTicket.id,
        subject: fullTicket.subject,
        status: fullTicket.status,
        priority: fullTicket.priority ?? null,
        createdAt: fullTicket.created_at,
        updatedAt: fullTicket.updated_at,
        description: cleanText(fullTicket.description, 600),
        comments: commentLines,
      };
    } catch (error) {
      return {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority ?? null,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        description: "",
        comments: [`Unable to load full detail: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }));
}

export async function analyzeZendeskTickets(
  opts: ZendeskTicketAnalysisOptions,
): Promise<ZendeskTicketAnalysisResult> {
  const cfg = getZendeskConfig();
  if (!cfg) throw new Error("Zendesk is not configured on this server.");
  if (!isAIConfigured()) throw new Error("AI service is not configured.");

  const { scope, searchQuery, tickets } = await searchZendeskTickets(cfg, opts);
  if (tickets.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      scope,
      searchQuery,
      ticketCount: 0,
      detailSampleSize: 0,
      statusCounts: {},
      ticketIds: [],
      analysis: "No tickets matched the requested scope, so there was nothing to analyze.",
    };
  }

  const detailSampleSize = Math.max(1, Math.min(Number(opts.detailSampleSize) || 25, Math.min(tickets.length, 40)));
  const includeComments = opts.includeComments !== false;
  const evidence = await fetchTicketEvidence(cfg, tickets, detailSampleSize, includeComments);
  const statusCounts = summarizeStatusCounts(tickets);

  const prompt = {
    scope,
    searchQuery,
    ticketCount: tickets.length,
    statusCounts,
    analyzedTicketIds: evidence.map((ticket) => ticket.id),
    ticketEvidence: evidence,
  };

  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 2400,
    messages: [
      {
        role: "system",
        content:
          "You analyze IT support tickets for operational patterns. " +
          "Find recurring themes, likely root causes, and concrete recommendations. " +
          "Be evidence-based: cite ticket IDs in each major point, distinguish observed patterns from inference, " +
          "and avoid claiming certainty where the evidence is thin. Format the answer in Markdown with these sections exactly: " +
          "Overview, Common Themes, Likely Root Causes, Recommendations. Under Recommendations, separate Quick Wins and Structural Fixes.",
      },
      {
        role: "user",
        content:
          "Analyze this Zendesk ticket set for commonalities, likely root causes, and actionable recommendations:\n\n" +
          JSON.stringify(prompt, null, 2),
      },
    ],
  });

  return {
    generatedAt: new Date().toISOString(),
    scope,
    searchQuery,
    ticketCount: tickets.length,
    detailSampleSize,
    statusCounts,
    ticketIds: tickets.map((ticket) => ticket.id),
    analysis: completion.choices[0]?.message?.content?.trim() || "The AI analysis returned no content.",
  };
}
