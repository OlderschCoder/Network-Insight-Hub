import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { requireAuth } from "./auth";

const router = Router();

interface ZendeskUser {
  id: number;
  name: string;
  email: string;
}

interface ZendeskTicket {
  id: number;
  status: string;
  subject: string;
  assignee_id: number | null;
  created_at: string;
  updated_at: string;
}

function zendeskConfig() {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const token = process.env.ZENDESK_API_TOKEN;
  if (!subdomain || !email || !token) {
    return null;
  }
  const auth = Buffer.from(`${email}/token:${token}`).toString("base64");
  return {
    subdomain,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    } as Record<string, string>,
  };
}

async function zget<T>(cfg: ReturnType<typeof zendeskConfig>, path: string): Promise<T> {
  if (!cfg) throw new Error("Zendesk not configured");
  const url = `https://${cfg.subdomain}.zendesk.com/api/v2/${path}`;
  const r = await fetch(url, { headers: cfg.headers });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Zendesk ${r.status}: ${body.slice(0, 300)}`);
  }
  return (await r.json()) as T;
}

router.get("/my-open-count", requireAuth, async (req: any, res) => {
  const cfg = zendeskConfig();
  if (!cfg) {
    return res.json({ configured: false, count: 0 });
  }
  try {
    const email = (req.user?.email || "").trim();
    if (!email) return res.json({ configured: true, count: 0, message: "No email on user" });

    type UsersResp = { users: ZendeskUser[] };
    const usersResp = await zget<UsersResp>(
      cfg,
      `users/search.json?query=${encodeURIComponent(`email:${email}`)}`,
    );
    const me = usersResp.users?.[0];
    if (!me) return res.json({ configured: true, count: 0, message: "No matching Zendesk user" });

    type CountResp = { count: { value: number } };
    const data = await zget<CountResp>(
      cfg,
      `search/count.json?query=${encodeURIComponent(
        `type:ticket assignee:${me.id} status<solved`,
      )}`,
    );
    return res.json({ configured: true, count: data.count?.value ?? 0 });
  } catch (e: any) {
    return res.json({ configured: true, count: 0, error: e.message });
  }
});

router.get("/my-open", requireAuth, async (req: any, res) => {
  const cfg = zendeskConfig();
  if (!cfg) {
    return res.json({ configured: false, tickets: [] });
  }
  const parsedLimit = Number.parseInt((req.query.limit as string) || "5", 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 25)
    : 5;
  try {
    const email = (req.user?.email || "").trim();
    const zendeskEmail = (req.user?.zendeskEmail || "").trim();
    const lookupEmail = zendeskEmail || email;
    if (!lookupEmail) {
      return res.json({ configured: true, tickets: [], message: "No email on user" });
    }

    type UsersResp = { users: ZendeskUser[] };
    const usersResp = await zget<UsersResp>(
      cfg,
      `users/search.json?query=${encodeURIComponent(`email:${lookupEmail}`)}`,
    );
    const me = usersResp.users?.[0];
    if (!me) {
      return res.json({ configured: true, tickets: [], message: "No matching Zendesk user" });
    }

    type SearchResp = { results: ZendeskTicket[] };
    const data = await zget<SearchResp>(
      cfg,
      `search.json?query=${encodeURIComponent(
        `type:ticket assignee:${me.id} status<solved`,
      )}&sort_by=updated_at&sort_order=desc&per_page=${limit}`,
    );
    const tickets = (data.results || []).slice(0, limit).map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      url: `https://${cfg.subdomain}.zendesk.com/agent/tickets/${t.id}`,
    }));
    return res.json({ configured: true, tickets });
  } catch (e: any) {
    return res.json({ configured: true, tickets: [], error: e.message });
  }
});

interface ZendeskComment {
  id: number;
  author_id: number;
  body: string;
  plain_body?: string;
  public: boolean;
  created_at: string;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "…";
}

router.get("/ticket/:id/timeline", requireAuth, async (req: any, res) => {
  const cfg = zendeskConfig();
  if (!cfg) {
    return res.status(503).json({ error: "Zendesk not configured" });
  }
  const ticketId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(ticketId)) {
    return res.status(400).json({ error: "Invalid ticket id" });
  }
  try {
    // Authorization: only the ticket's current assignee may pull the
    // transcript (enforced below after we look up the ticket).
    const email = (req.user?.email || "").trim();
    const zendeskEmail = (req.user?.zendeskEmail || "").trim();
    const lookupEmail = zendeskEmail || email;
    if (!lookupEmail) {
      return res.status(403).json({ error: "Forbidden" });
    }
    type UsersResp = { users: ZendeskUser[] };
    const usersResp = await zget<UsersResp>(
      cfg,
      `users/search.json?query=${encodeURIComponent(`email:${lookupEmail}`)}`,
    );
    const me = usersResp.users?.[0];
    if (!me) {
      return res.status(403).json({ error: "Forbidden" });
    }

    type TicketResp = {
      ticket: {
        id: number;
        assignee_id: number | null;
        requester_id: number | null;
        submitter_id: number | null;
        collaborator_ids?: number[];
        follower_ids?: number[];
        email_cc_ids?: number[];
      };
    };
    let ticket: TicketResp["ticket"];
    try {
      const tdata = await zget<TicketResp>(cfg, `tickets/${ticketId}.json`);
      ticket = tdata.ticket;
    } catch (err: any) {
      if (/Zendesk 404/.test(err?.message || "")) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      throw err;
    }
    // Restrict to the ticket's current assignee. The Start Review flow only
    // surfaces tickets assigned to the caller, so this is the minimum
    // authorization needed for the feature.
    if (ticket.assignee_id !== me.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    type CommentsResp = { comments: ZendeskComment[] };
    const data = await zget<CommentsResp>(
      cfg,
      `tickets/${ticketId}/comments.json?sort_order=asc`,
    );
    // Only include public comments in the prefilled transcript so internal
    // agent notes are never copied into a review document by accident.
    const comments = (data.comments || []).filter((c) => c.public);

    const authorIds = Array.from(new Set(comments.map((c) => c.author_id)));
    const authorMap = new Map<number, ZendeskUser>();
    if (authorIds.length > 0) {
      const usersData = await zget<{ users: ZendeskUser[] }>(
        cfg,
        `users/show_many.json?ids=${authorIds.join(",")}`,
      );
      for (const u of usersData.users) authorMap.set(u.id, u);
    }

    const PER_COMMENT_MAX = 800;
    const TOTAL_MAX = 6000;
    const lines: string[] = [];
    let totalLen = 0;
    let truncatedCount = 0;
    for (const c of comments) {
      const author = authorMap.get(c.author_id);
      const authorName = author?.name || `User ${c.author_id}`;
      const ts = c.created_at || "";
      const body = (c.plain_body || c.body || "").trim().replace(/\r\n/g, "\n");
      const block = `[${ts}] ${authorName}:\n${truncate(body, PER_COMMENT_MAX)}`;
      if (totalLen + block.length > TOTAL_MAX) {
        truncatedCount = comments.length - lines.length;
        break;
      }
      lines.push(block);
      totalLen += block.length + 2;
    }
    let timeline = lines.join("\n\n");
    if (truncatedCount > 0) {
      timeline += `\n\n… (${truncatedCount} earlier/later comment${
        truncatedCount === 1 ? "" : "s"
      } omitted — see Zendesk for full thread)`;
    }
    return res.json({
      ticketId,
      commentCount: comments.length,
      includedCount: lines.length,
      timeline,
    });
  } catch (e: any) {
    return res.status(502).json({ error: "Zendesk API error", message: e.message });
  }
});

router.get("/status", requireAuth, async (_req, res) => {
  const cfg = zendeskConfig();
  if (!cfg) {
    return res.json({
      configured: false,
      message: "Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, and ZENDESK_API_TOKEN.",
    });
  }
  try {
    await zget<{ count: number }>(cfg, "users/count.json");
    return res.json({ configured: true, subdomain: cfg.subdomain });
  } catch (e: any) {
    return res.json({ configured: true, error: e.message });
  }
});

router.get("/resolved-by-user", requireAuth, async (req, res) => {
  const cfg = zendeskConfig();
  if (!cfg) {
    return res.status(503).json({
      error: "Zendesk not configured",
      message: "Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, and ZENDESK_API_TOKEN.",
    });
  }

  const days = Math.min(parseInt((req.query.days as string) || "7"), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  try {
    // Use Zendesk Search API for solved tickets, paginate
    const counts = new Map<number, number>();
    const totals = { solved: 0, scanned: 0 };
    const group = process.env.ZENDESK_GROUP || "Onsite_it";
    let nextUrl: string | null =
      `search.json?query=${encodeURIComponent(
        `type:ticket solved>${since} group:"${group}"`
      )}&per_page=100`;
    let pages = 0;
    while (nextUrl && pages < 10) {
      type SearchPage = { results: ZendeskTicket[]; next_page: string | null };
      const data: SearchPage = await zget<SearchPage>(cfg, nextUrl);
      for (const t of data.results) {
        totals.scanned++;
        if (t.status === "solved" || t.status === "closed") {
          totals.solved++;
          if (t.assignee_id != null) {
            counts.set(t.assignee_id, (counts.get(t.assignee_id) || 0) + 1);
          }
        }
      }
      pages++;
      nextUrl = data.next_page
        ? data.next_page.replace(`https://${cfg.subdomain}.zendesk.com/api/v2/`, "")
        : null;
    }

    // Resolve assignee names
    const assigneeIds = Array.from(counts.keys());
    const userMap = new Map<number, ZendeskUser>();
    if (assigneeIds.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < assigneeIds.length; i += chunkSize) {
        const chunk = assigneeIds.slice(i, i + chunkSize);
        const data = await zget<{ users: ZendeskUser[] }>(
          cfg,
          `users/show_many.json?ids=${chunk.join(",")}`
        );
        for (const u of data.users) userMap.set(u.id, u);
      }
    }

    // Pull SCCC reporting team so we can include teammates with zero resolved
    const teamUsers = await db.select().from(usersTable);
    const localPart = (e: string | null | undefined) =>
      (e ?? "").toLowerCase().split("@")[0].replace(/[._]/g, "");
    const lastName = (n: string) =>
      (n ?? "").toLowerCase().trim().split(/\s+/).pop() ?? "";

    type Row = {
      zendeskUserId: number | null;
      name: string;
      email: string | null;
      resolvedCount: number;
      isTeamMember: boolean;
      teamRole?: string | null;
    };

    const matchedTeamIds = new Set<number>();
    const rows: Row[] = [];

    for (const [zid, count] of counts.entries()) {
      const z = userMap.get(zid);
      const zLocal = localPart(z?.email);
      const zLast = lastName(z?.name ?? "");
      const teamMatch = teamUsers.find((u) => {
        // Strongest signal: explicit zendeskEmail override on the user record
        if (u.zendeskEmail && z?.email &&
            u.zendeskEmail.toLowerCase() === z.email.toLowerCase()) return true;
        // Then normalized email local-part match
        if (localPart(u.email) === zLocal) return true;
        // Last fallback: surname match (only used if no email match)
        return lastName(u.name) === zLast;
      });
      if (teamMatch) matchedTeamIds.add(teamMatch.id);
      rows.push({
        zendeskUserId: zid,
        name: teamMatch?.name ?? z?.name ?? `User ${zid}`,
        email: teamMatch?.email ?? z?.email ?? null,
        resolvedCount: count,
        isTeamMember: !!teamMatch,
        teamRole: teamMatch?.role ?? null,
      });
    }

    // Add any team members who had zero resolved tickets in this window
    for (const u of teamUsers) {
      if (matchedTeamIds.has(u.id)) continue;
      // Only show users likely to handle tickets (not CIO/Project Manager/staff)
      if (u.role === "cio" || u.role === "staff") continue;
      rows.push({
        zendeskUserId: null,
        name: u.name,
        email: u.email,
        resolvedCount: 0,
        isTeamMember: true,
        teamRole: u.role,
      });
    }

    const breakdown = rows.sort((a, b) => {
      if (a.isTeamMember !== b.isTeamMember) return a.isTeamMember ? -1 : 1;
      return b.resolvedCount - a.resolvedCount;
    });

    return res.json({
      sinceDate: since,
      days,
      totalResolved: totals.solved,
      breakdown,
    });
  } catch (e: any) {
    return res.status(502).json({ error: "Zendesk API error", message: e.message });
  }
});

// Tickets resolved by the current logged-in user on a given date (YYYY-MM-DD).
// Matches by email local-part or by last name (handles Zendesk vs SCCC email differences).
router.get("/my-tickets", requireAuth, async (req: any, res) => {
  const cfg = zendeskConfig();
  if (!cfg) {
    return res.status(503).json({ error: "Zendesk not configured" });
  }
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const weekOf = req.query.weekOf as string | undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Invalid date format, use YYYY-MM-DD" });
  }
  if (weekOf && !/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) {
    return res.status(400).json({ error: "Invalid weekOf format, use YYYY-MM-DD" });
  }
  // Build the date set we're filtering by — single day or all 7 days of the week
  const dateSet = new Set<string>();
  if (weekOf) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekOf + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      dateSet.add(d.toISOString().slice(0, 10));
    }
  } else {
    dateSet.add(date);
  }
  const me = req.user;
  // Strict email match: prefer the explicit zendeskEmail override if set,
  // otherwise normalized email local-part. No surname fallback (would risk
  // attributing another user's tickets to a same-surname user).
  const myLocal = (me.email || "").toLowerCase().split("@")[0].replace(/[._]/g, "");
  const myZendeskEmail = (me.zendeskEmail || "").toLowerCase();
  if (!myLocal && !myZendeskEmail) return res.json({ date, count: 0, tickets: [] });

  try {
    const group = process.env.ZENDESK_GROUP || "Onsite_it";
    // Pick the earliest date we care about, then fetch from the day before that
    // and paginate fully. This works for both single-day and weekly queries.
    const earliest = Array.from(dateSet).sort()[0];
    const dayBefore = new Date(new Date(earliest).getTime() - 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const allResults: ZendeskTicket[] = [];
    let nextUrl: string | null =
      `search.json?query=${encodeURIComponent(
        `type:ticket solved>${dayBefore} group:"${group}"`
      )}&per_page=100`;
    let pages = 0;
    while (nextUrl && pages < 10) {
      type SearchPage = { results: ZendeskTicket[]; next_page: string | null };
      const data: SearchPage = await zget<SearchPage>(cfg, nextUrl);
      allResults.push(...data.results);
      pages++;
      nextUrl = data.next_page
        ? data.next_page.replace(`https://${cfg.subdomain}.zendesk.com/api/v2/`, "")
        : null;
    }

    // Filter to tickets last-updated within the date set. For solved tickets
    // updated_at corresponds to when the ticket was solved.
    const onDate = allResults.filter((t) =>
      dateSet.has((t.updated_at || "").slice(0, 10))
    );

    const candidateIds = Array.from(
      new Set(onDate.map((t) => t.assignee_id).filter((x): x is number => !!x))
    );
    const userMap = new Map<number, ZendeskUser>();
    if (candidateIds.length > 0) {
      const data = await zget<{ users: ZendeskUser[] }>(
        cfg,
        `users/show_many.json?ids=${candidateIds.join(",")}`
      );
      for (const u of data.users) userMap.set(u.id, u);
    }

    // Match assignee by zendeskEmail override or normalized email local-part
    const mine = onDate.filter((t) => {
      if (!t.assignee_id) return false;
      const u = userMap.get(t.assignee_id);
      if (!u || !u.email) return false;
      const uEmail = u.email.toLowerCase();
      if (myZendeskEmail && uEmail === myZendeskEmail) return true;
      const uLocal = uEmail.split("@")[0].replace(/[._]/g, "");
      return !!myLocal && uLocal === myLocal;
    });

    return res.json({
      date,
      count: mine.length,
      tickets: mine.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        url: `https://${cfg.subdomain}.zendesk.com/agent/tickets/${t.id}`,
        updatedAt: t.updated_at,
      })),
    });
  } catch (e: any) {
    return res.status(502).json({ error: "Zendesk API error", message: e.message });
  }
});

export default router;
