import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { requireAuth } from "./auth";
import {
  isZendeskDashboardTeamMember,
  zendeskDashboardTeamOrder,
} from "../lib/zendesk_dashboard_team";
import {
  validateZendeskControlRequest,
  validateZendeskEscalationRequest,
  validateZendeskReplyRequest,
} from "../lib/zendesk_reply_policy";
import {
  canManageZendeskControls,
  readZendeskSupervisionConfig,
  updateZendeskSupervisionConfig,
  withZendeskSupervisionConfig,
  ZendeskSupervisionUnavailableError,
  type ZendeskSupervisionConfig,
} from "../lib/zendesk_supervision";
import {
  isZendeskMessagingChannel,
  normalizeZendeskConversationLog,
  type ZendeskConversationLogEvent,
} from "../lib/zendesk_conversation_log";
import {
  claimZendeskReplyDraftForSend,
  completeZendeskReplyDraftSend,
  getPendingZendeskReplyDraft,
  listZendeskReplyDrafts,
  releaseZendeskReplyDraftSend,
  saveZendeskReplyDraft,
} from "../lib/zendesk_reply_drafts";

const router = Router();

const SUPERVISION_UNAVAILABLE = {
  error: "Zendesk supervision controls are unavailable. No Zendesk action was performed.",
  code: "ZENDESK_SUPERVISION_UNAVAILABLE",
} as const;

async function readSupervisionControls(
  req: any,
  res: any,
): Promise<ZendeskSupervisionConfig | null> {
  try {
    return await readZendeskSupervisionConfig();
  } catch (error) {
    req.log?.error?.({ err: error }, "Zendesk supervision controls unavailable");
    res.status(503).json(SUPERVISION_UNAVAILABLE);
    return null;
  }
}

function handleSupervisionUnavailable(
  req: any,
  res: any,
  error: unknown,
): boolean {
  if (!(error instanceof ZendeskSupervisionUnavailableError)) return false;
  req.log?.error?.(
    { err: error.cause ?? error },
    "Zendesk supervision controls unavailable",
  );
  res.status(503).json(SUPERVISION_UNAVAILABLE);
  return true;
}

interface ZendeskUser {
  id: number;
  name: string;
  email: string;
  role?: string;
}

interface ZendeskTicket {
  id: number;
  status: string;
  subject: string;
  assignee_id: number | null;
  created_at: string;
  updated_at: string;
  via?: { channel?: string };
}

function zendeskConfig() {
  const subdomain = process.env.ZENDESK_SUBDOMAIN?.trim();
  const email = process.env.ZENDESK_EMAIL?.trim();
  const token = process.env.ZENDESK_API_TOKEN?.trim();
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
    const err = new Error(`Zendesk ${r.status}: ${body.slice(0, 300)}`) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return (await r.json()) as T;
}

async function zput<T>(cfg: ReturnType<typeof zendeskConfig>, path: string, body: unknown): Promise<T> {
  if (!cfg) throw new Error("Zendesk not configured");
  const url = `https://${cfg.subdomain}.zendesk.com/api/v2/${path}`;
  const r = await fetch(url, { method: "PUT", headers: cfg.headers, body: JSON.stringify(body) });
  if (!r.ok) {
    const text = await r.text();
    const err = new Error(`Zendesk ${r.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return (await r.json()) as T;
}

async function zpost_write<T>(cfg: ReturnType<typeof zendeskConfig>, path: string, body: unknown): Promise<T> {
  if (!cfg) throw new Error("Zendesk not configured");
  const url = `https://${cfg.subdomain}.zendesk.com/api/v2/${path}`;
  const r = await fetch(url, { method: "POST", headers: cfg.headers, body: JSON.stringify(body) });
  if (!r.ok) {
    const text = await r.text();
    const err = new Error(`Zendesk ${r.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = r.status;
    throw err;
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

function draftActor(req: any) {
  return {
    id: req.user?.id ?? null,
    name: req.user?.name ?? null,
    email: req.user?.email ?? null,
  };
}

async function resolveZendeskActor(cfg: ReturnType<typeof zendeskConfig>, req: any) {
  const actorEmail = (req.user?.zendeskEmail || req.user?.email || "").trim();
  return actorEmail
    ? zget<{ users: ZendeskUser[] }>(
        cfg,
        `users/search.json?query=${encodeURIComponent(`email:${actorEmail}`)}`,
      )
        .then((result) => result.users?.[0] ?? null)
        .catch(() => null)
    : null;
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

// Public-to-the-app widget config: returns the Zendesk Web Widget key so the
// SPA can inject the official chat snippet. The key is a client-side embed key
// (not a secret), but we still gate behind auth so it only loads in-app.
router.get("/widget-config", requireAuth, (_req, res) => {
  const key = process.env.ZENDESK_WIDGET_KEY?.trim();
  return res.json({ enabled: !!key, key: key || null });
});

// Recent open-ticket activity for the team group, newest-updated first. The SPA
// polls this and sounds an alert when the newest updatedAt advances (a new
// ticket or a new reply both bump updated_at).
router.get("/recent-activity", requireAuth, async (_req, res) => {
  const cfg = zendeskConfig();
  if (!cfg) {
    return res.json({ configured: false, latestUpdatedAt: null, items: [] });
  }
  try {
    const group = process.env.ZENDESK_GROUP || "Onsite_it";
    type SearchResp = { results: ZendeskTicket[] };
    const data = await zget<SearchResp>(
      cfg,
      `search.json?query=${encodeURIComponent(
        `type:ticket group:"${group}" status<solved`,
      )}&sort_by=updated_at&sort_order=desc&per_page=25`,
    );
    const items = (data.results || []).map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      channel: t.via?.channel ?? "ticket",
      url: `https://${cfg.subdomain}.zendesk.com/agent/tickets/${t.id}`,
    }));
    const latestUpdatedAt = items.reduce(
      (max, i) => (i.updatedAt > max ? i.updatedAt : max),
      "",
    );
    return res.json({ configured: true, latestUpdatedAt: latestUpdatedAt || null, items });
  } catch (e: any) {
    const upstream = e?.status;
    if (upstream === 401 || upstream === 403) {
      return res.status(502).json({ error: "Zendesk authentication failed", code: "ZENDESK_AUTH" });
    }
    return res.status(502).json({ error: "Zendesk API error", code: "ZENDESK_ERROR" });
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

router.get("/agents", requireAuth, async (_req, res) => {
  const users = await db.select().from(usersTable);
  return res.json(
    users
      .filter((user) => user.isActive)
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.zendeskEmail || user.email,
        role: user.role,
      }))
      .filter((user) => !!user.email)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
});

router.get("/controls", requireAuth, async (req: any, res) => {
  const controls = await readSupervisionControls(req, res);
  if (!controls) return;
  return res.json({
    ...controls,
    canManage: canManageZendeskControls(req.user),
  });
});

router.put("/controls", requireAuth, async (req: any, res) => {
  if (!canManageZendeskControls(req.user)) {
    return res.status(403).json({
      error: "Only a Zendesk supervisor may change these controls.",
    });
  }
  const validation = validateZendeskControlRequest(req.body);
  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }
  try {
    const controls = await updateZendeskSupervisionConfig(
      validation.value,
      {
        id: req.user?.id,
        name: req.user?.name,
        email: req.user?.email,
        role: req.user?.role,
        canManageTodos: req.user?.canManageTodos,
      },
    );
    req.log?.info?.(
      {
        userId: req.user?.id,
        userEmail: req.user?.email,
        changes: validation.value,
        fredEnabled: controls.fredEnabled,
        repliesEnabled: controls.repliesEnabled,
      },
      "Zendesk supervision controls updated",
    );
    return res.json({ ...controls, canManage: true });
  } catch (error) {
    req.log?.error?.({ err: error }, "Zendesk supervision controls update failed");
    return res.status(503).json(SUPERVISION_UNAVAILABLE);
  }
});

router.get("/resolved-by-user", requireAuth, async (req, res) => {
  const cfg = zendeskConfig();
  if (!cfg) {
    return res.status(503).json({
      error: "Zendesk not configured",
      code: "ZENDESK_NOT_CONFIGURED",
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
    const teamUsers = (await db.select().from(usersTable)).filter(
      isZendeskDashboardTeamMember,
    );
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
      if (!teamMatch) continue;
      rows.push({
        zendeskUserId: zid,
        name: teamMatch.name,
        email: teamMatch.email,
        resolvedCount: count,
        isTeamMember: true,
        teamRole: teamMatch.role,
      });
    }

    // Add any team members who had zero resolved tickets in this window
    for (const u of teamUsers) {
      if (matchedTeamIds.has(u.id)) continue;
      rows.push({
        zendeskUserId: null,
        name: u.name,
        email: u.email,
        resolvedCount: 0,
        isTeamMember: true,
        teamRole: u.role,
      });
    }

    const breakdown = rows.sort(
      (a, b) => zendeskDashboardTeamOrder(a.name) - zendeskDashboardTeamOrder(b.name),
    );

    return res.json({
      sinceDate: since,
      days,
      totalResolved: breakdown.reduce((sum, row) => sum + row.resolvedCount, 0),
      breakdown,
    });
  } catch (e: any) {
    const upstream = e?.status;
    if (upstream === 401 || upstream === 403) {
      return res.status(502).json({
        error: "Zendesk authentication failed",
        code: "ZENDESK_AUTH",
      });
    }
    return res.status(502).json({ error: "Zendesk API error", code: "ZENDESK_ERROR" });
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

// ── Full ticket detail (for FRED / AI) ───────────────────────────────────────
// GET /zendesk/ticket/:id  — returns ticket + last 20 public comments
router.get("/ticket/:id", requireAuth, async (req: any, res) => {
  const cfg = zendeskConfig();
  if (!cfg) return res.status(503).json({ error: "Zendesk not configured" });
  const ticketId = parseInt(req.params.id, 10);
  if (!isFinite(ticketId)) return res.status(400).json({ error: "Invalid ticket id" });
  try {
    type FullTicket = {
      id: number; subject: string; description: string;
      status: string; priority: string | null;
      requester_id: number; assignee_id: number | null;
      created_at: string; updated_at: string;
      via?: { channel?: string };
    };
    const { ticket } = await zget<{ ticket: FullTicket }>(cfg, `tickets/${ticketId}.json`);
    const { comments } = await zget<{ comments: ZendeskComment[] }>(
      cfg, `tickets/${ticketId}/comments.json?sort_order=asc`
    );
    // Resolve ticket participants even when the visible thread comes from the
    // Conversation Log. The log is what includes live Messaging events.
    const ids = Array.from(new Set([
      ...comments.map(c => c.author_id),
      ticket.requester_id,
      ...(ticket.assignee_id ? [ticket.assignee_id] : []),
    ]));
    const userMap = new Map<number, ZendeskUser>();
    if (ids.length > 0) {
      const { users } = await zget<{ users: ZendeskUser[] }>(cfg, `users/show_many.json?ids=${ids.join(",")}`);
      for (const u of users) userMap.set(u.id, u);
    }
    let enriched: Array<{
      id: string | number;
      author: string;
      authorType: string;
      public: boolean;
      body: string;
      createdAt: string;
      eventType: string;
    }>;
    let threadSource: "conversation_log" | "ticket_comments" = "ticket_comments";
    try {
      const log = await zget<{ events: ZendeskConversationLogEvent[] }>(
        cfg,
        `tickets/${ticketId}/conversation_log?sort=created_at&page%5Bsize%5D=100`,
      );
      enriched = normalizeZendeskConversationLog(log.events || [])
        .slice(-60)
        .map((entry) => ({ ...entry, body: truncate(entry.body, 1_500) }));
      threadSource = "conversation_log";
    } catch {
      enriched = comments.slice(-20).map(c => ({
        id: c.id,
        author: userMap.get(c.author_id)?.name ?? `User ${c.author_id}`,
        authorType: ["agent", "admin"].includes(
          String(userMap.get(c.author_id)?.role ?? "").toLowerCase(),
        )
          ? "agent"
          : "user",
        public: c.public,
        body: truncate((c.plain_body || c.body || "").trim(), 600),
        createdAt: c.created_at,
        eventType: "Comment",
      }));
    }
    return res.json({
      id: ticket.id, subject: ticket.subject, description: ticket.description,
      status: ticket.status, priority: ticket.priority,
      requesterId: ticket.requester_id,
      requesterName: userMap.get(ticket.requester_id)?.name ?? null,
      assigneeId: ticket.assignee_id,
      assigneeName: ticket.assignee_id ? (userMap.get(ticket.assignee_id)?.name ?? null) : null,
      channel: ticket.via?.channel ?? "ticket",
      createdAt: ticket.created_at, updatedAt: ticket.updated_at,
      url: `https://${cfg.subdomain}.zendesk.com/agent/tickets/${ticket.id}`,
      threadSource,
      isMessaging: isZendeskMessagingChannel(ticket.via?.channel),
      comments: enriched,
    });
  } catch (e: any) {
    if (/Zendesk 404/.test(e.message)) return res.status(404).json({ error: "Ticket not found" });
    return res.status(502).json({ error: "Zendesk API error", message: e.message });
  }
});

// ── Shared Fred reply drafts ─────────────────────────────────────────────────
// Drafts are stored in Insights so one staff member can ask Fred to prepare a
// response and another can review it. Nothing is written to Zendesk here.
router.get("/drafts", requireAuth, async (_req, res) => {
  return res.json({ drafts: await listZendeskReplyDrafts("pending") });
});

router.get("/ticket/:id/draft", requireAuth, async (req: any, res) => {
  const ticketId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(ticketId)) return res.status(400).json({ error: "Invalid ticket id" });
  return res.json({ draft: await getPendingZendeskReplyDraft(ticketId) });
});

router.put("/ticket/:id/draft", requireAuth, async (req: any, res) => {
  const cfg = zendeskConfig();
  if (!cfg) return res.status(503).json({ error: "Zendesk not configured" });
  const ticketId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(ticketId)) return res.status(400).json({ error: "Invalid ticket id" });
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const source = req.body?.source === "fred" ? "fred" : "operator";
  if (!body) return res.status(400).json({ error: "Draft body is required." });
  if (body.length > 10_000) {
    return res.status(400).json({ error: "Draft body must be 10,000 characters or fewer." });
  }
  try {
    return await withZendeskSupervisionConfig(async (controls) => {
      if (source === "fred" && !controls.fredEnabled) {
        return res.status(423).json({ error: "Fred drafting is turned off by a supervisor." });
      }
      const { ticket } = await zget<{ ticket: ZendeskTicket }>(
        cfg,
        `tickets/${ticketId}.json`,
      );
      const draft = await saveZendeskReplyDraft({
        ticketId,
        ticketSubject: ticket.subject,
        ticketUrl: `https://${cfg.subdomain}.zendesk.com/agent/tickets/${ticketId}`,
        channel: ticket.via?.channel ?? "ticket",
        body,
        source,
        actor: draftActor(req),
      });
      return res.json({ draft });
    });
  } catch (e: any) {
    if (handleSupervisionUnavailable(req, res, e)) return;
    if (e?.code === "ZENDESK_REPLY_DRAFT_IN_FLIGHT") {
      return res.status(409).json({
        error: "This ticket already has a reply being sent. Reload before editing it.",
        code: e.code,
      });
    }
    if (/Zendesk 404/.test(e.message)) return res.status(404).json({ error: "Ticket not found" });
    return res.status(502).json({ error: "Zendesk API error", message: e.message });
  }
});

// Human approval is the only route that sends a saved draft. Messaging is
// deliberately rejected here on Suite Growth: its supported send surface is
// the Agent Workspace composer, not the Support ticket-comment API.
router.post("/ticket/:id/draft/approve-send", requireAuth, async (req: any, res) => {
  const cfg = zendeskConfig();
  if (!cfg) return res.status(503).json({ error: "Zendesk not configured" });
  const ticketId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(ticketId)) return res.status(400).json({ error: "Invalid ticket id" });
  if (req.body?.confirmed !== true) {
    return res.status(409).json({ error: "Explicit approval is required before sending the draft." });
  }
  try {
    return await withZendeskSupervisionConfig(async (controls) => {
      if (!controls.repliesEnabled) {
        return res.status(423).json({ error: "Zendesk replies are turned off by a supervisor." });
      }
      const draft = await claimZendeskReplyDraftForSend(
        ticketId,
        req.body?.draftId,
        draftActor(req),
      );
      if (!draft) {
        return res.status(409).json({ error: "The pending draft changed or is already being sent. Reload it before approval." });
      }
      if (draft.source === "fred" && !controls.fredEnabled) {
        await releaseZendeskReplyDraftSend(ticketId, draft.id);
        return res.status(423).json({
          error: "Fred's Zendesk actions are turned off by a supervisor.",
        });
      }

      let zendeskWriteAttempted = false;
      try {
        const { ticket } = await zget<{ ticket: ZendeskTicket }>(cfg, `tickets/${ticketId}.json`);
        if (isZendeskMessagingChannel(ticket.via?.channel)) {
          await releaseZendeskReplyDraftSend(ticketId, draft.id);
          return res.status(409).json({
            error: "Messaging drafts must be sent from Zendesk Agent Workspace on the current Zendesk plan.",
            code: "ZENDESK_MESSAGING_MANUAL_SEND_REQUIRED",
            ticketUrl: draft.ticketUrl,
          });
        }
        const actor = await resolveZendeskActor(cfg, req);
        zendeskWriteAttempted = true;
        await zput(cfg, `tickets/${ticketId}.json`, {
          ticket: {
            comment: {
              body: draft.body,
              public: true,
              ...(actor ? { author_id: actor.id } : {}),
            },
          },
        });
        const sent = await completeZendeskReplyDraftSend(
          ticketId,
          draft.id,
          draftActor(req),
        );
        if (!sent) {
          throw new Error("The claimed Zendesk draft could not be marked sent.");
        }
        return res.json({
          ok: true,
          ticketId,
          delivery: "support_ticket",
          sentBy: sent.sentBy ?? actor?.name ?? "configured Zendesk service account",
        });
      } catch (e: any) {
        // Before the outbound write, and after an explicit non-2xx response, it
        // is safe to make the immutable revision available for retry. A network
        // error after dispatch is uncertain, so retain the claim instead of
        // risking a duplicate public reply.
        const safeToRelease =
          !zendeskWriteAttempted || typeof e?.status === "number";
        if (safeToRelease) {
          await releaseZendeskReplyDraftSend(ticketId, draft.id).catch(
            (releaseError) =>
              req.log?.error?.(
                { err: releaseError, ticketId, draftId: draft.id },
                "Zendesk draft send claim release failed",
              ),
          );
        } else {
          req.log?.error?.(
            { err: e, ticketId, draftId: draft.id },
            "Zendesk reply delivery outcome is uncertain; draft remains claimed",
          );
          return res.status(502).json({
            error: "Zendesk reply delivery could not be confirmed. The draft remains locked to prevent a duplicate reply.",
            code: "ZENDESK_REPLY_DELIVERY_UNCERTAIN",
          });
        }
        if (/Zendesk 404/.test(e.message)) return res.status(404).json({ error: "Ticket not found" });
        return res.status(502).json({ error: "Zendesk API error", message: e.message });
      }
    });
  } catch (e) {
    if (handleSupervisionUnavailable(req, res, e)) return;
    throw e;
  }
});

// ── Ticket search (for FRED / AI) ─────────────────────────────────────────────
// GET /zendesk/search?q=...&status=open&limit=10
router.get("/search", requireAuth, async (req: any, res) => {
  const cfg = zendeskConfig();
  if (!cfg) return res.status(503).json({ error: "Zendesk not configured" });
  const q = (req.query.q as string || "").trim();
  const status = (req.query.status as string || "").trim();
  const limit = Math.min(parseInt(req.query.limit as string || "10", 10) || 10, 25);
  let query = `type:ticket ${q}`;
  if (status) query += ` status:${status}`;
  try {
    const { results } = await zget<{ results: ZendeskTicket[] }>(
      cfg,
      `search.json?query=${encodeURIComponent(query)}&sort_by=updated_at&sort_order=desc&per_page=${limit}`
    );
    return res.json({
      tickets: (results || []).map(t => ({
        id: t.id, subject: t.subject, status: t.status,
        assigneeId: t.assignee_id,
        createdAt: t.created_at, updatedAt: t.updated_at,
        url: `https://${cfg.subdomain}.zendesk.com/agent/tickets/${t.id}`,
      })),
    });
  } catch (e: any) {
    return res.status(502).json({ error: "Zendesk API error", message: e.message });
  }
});

// ── Add comment / reply (for FRED / AI) ──────────────────────────────────────
// POST /zendesk/ticket/:id/comment
// body: { body: string, public: boolean, author_email?: string }
router.post("/ticket/:id/comment", requireAuth, async (req: any, res) => {
  const cfg = zendeskConfig();
  if (!cfg) return res.status(503).json({ error: "Zendesk not configured" });
  const ticketId = parseInt(req.params.id, 10);
  if (!isFinite(ticketId)) return res.status(400).json({ error: "Invalid ticket id" });
  const validation = validateZendeskReplyRequest(req.body);
  if (!validation.ok) return res.status(validation.status).json({ error: validation.error });
  const { body, public: isPublic } = validation.value;
  try {
    return await withZendeskSupervisionConfig(async (controls) => {
      if (isPublic && !controls.repliesEnabled) {
        return res.status(423).json({
          error: "Zendesk replies are turned off by a supervisor.",
        });
      }
      const { ticket } = await zget<{ ticket: ZendeskTicket }>(
        cfg,
        `tickets/${ticketId}.json`,
      );
      if (isPublic && isZendeskMessagingChannel(ticket.via?.channel)) {
        return res.status(409).json({
          error:
            "This is a Zendesk Messaging ticket. Save the response for approval and send it from Zendesk Agent Workspace.",
          code: "ZENDESK_MESSAGING_MANUAL_SEND_REQUIRED",
        });
      }
      const actor = await resolveZendeskActor(cfg, req);
      await zput(cfg, `tickets/${ticketId}.json`, {
        ticket: { comment: { body, public: isPublic, ...(actor ? { author_id: actor.id } : {}) } }
      });
      return res.json({
        ok: true,
        ticketId,
        public: isPublic,
        postedBy: actor?.name ?? "configured Zendesk service account",
      });
    });
  } catch (e: any) {
    if (handleSupervisionUnavailable(req, res, e)) return;
    if (/Zendesk 404/.test(e.message)) return res.status(404).json({ error: "Ticket not found" });
    return res.status(502).json({ error: "Zendesk API error", message: e.message });
  }
});

// POST /zendesk/ticket/:id/escalate
// body: { assigneeEmail: string, note?: string, confirmed: true }
router.post("/ticket/:id/escalate", requireAuth, async (req: any, res) => {
  const cfg = zendeskConfig();
  if (!cfg) return res.status(503).json({ error: "Zendesk not configured" });
  const ticketId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(ticketId)) return res.status(400).json({ error: "Invalid ticket id" });
  const validation = validateZendeskEscalationRequest(req.body);
  if (!validation.ok) return res.status(validation.status).json({ error: validation.error });

  const { assigneeEmail, note } = validation.value;
  try {
    const { users } = await zget<{ users: ZendeskUser[] }>(
      cfg,
      `users/search.json?query=${encodeURIComponent(`email:${assigneeEmail}`)}`,
    );
    const assignee = users?.[0];
    if (!assignee) return res.status(404).json({ error: `No Zendesk agent found for ${assigneeEmail}` });
    await zput(cfg, `tickets/${ticketId}.json`, {
      ticket: {
        assignee_id: assignee.id,
        ...(note ? { comment: { body: note, public: false } } : {}),
      },
    });
    return res.json({
      ok: true,
      ticketId,
      assigneeName: assignee.name,
      assigneeEmail: assignee.email,
      internalNoteAdded: !!note,
    });
  } catch (e: any) {
    if (/Zendesk 404/.test(e.message)) return res.status(404).json({ error: "Ticket not found" });
    return res.status(502).json({ error: "Zendesk API error", message: e.message });
  }
});

// ── Update ticket status / assignee / priority (for FRED / AI) ───────────────
// PATCH /zendesk/ticket/:id
// body: { status?: string, assignee_email?: string, priority?: string }
router.patch("/ticket/:id", requireAuth, async (req: any, res) => {
  const cfg = zendeskConfig();
  if (!cfg) return res.status(503).json({ error: "Zendesk not configured" });
  const ticketId = parseInt(req.params.id, 10);
  if (!isFinite(ticketId)) return res.status(400).json({ error: "Invalid ticket id" });

  const { status, assignee_email, priority } = req.body ?? {};
  const VALID_STATUSES = ["new", "open", "pending", "hold", "solved", "closed"];
  const VALID_PRIORITIES = ["urgent", "high", "normal", "low"];

  const update: Record<string, unknown> = {};
  if (status) {
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
    update.status = status;
  }
  if (priority) {
    if (!VALID_PRIORITIES.includes(priority)) return res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` });
    update.priority = priority;
  }
  try {
    return await withZendeskSupervisionConfig(async (controls) => {
      if (!controls.fredEnabled) {
        return res.status(423).json({
          error: "Fred's Zendesk actions are turned off by a supervisor.",
        });
      }
      if (assignee_email) {
        // Resolve email to Zendesk user id only after the Fred action is
        // admitted under the same guard that covers the outbound write.
        const { users } = await zget<{ users: ZendeskUser[] }>(
          cfg,
          `users/search.json?query=${encodeURIComponent(`email:${assignee_email}`)}`,
        ).catch(() => ({ users: [] }));
        if (!users?.[0]) {
          return res.status(404).json({
            error: `No Zendesk user found for ${assignee_email}`,
          });
        }
        update.assignee_id = users[0].id;
      }
      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: "Nothing to update" });
      }

      await zput(cfg, `tickets/${ticketId}.json`, { ticket: update });
      return res.json({ ok: true, ticketId, updated: update });
    });
  } catch (e: any) {
    if (handleSupervisionUnavailable(req, res, e)) return;
    if (/Zendesk 404/.test(e.message)) return res.status(404).json({ error: "Ticket not found" });
    return res.status(502).json({ error: "Zendesk API error", message: e.message });
  }
});

export default router;
