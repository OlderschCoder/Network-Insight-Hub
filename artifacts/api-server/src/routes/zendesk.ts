import { Router } from "express";
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
        `type:ticket status:solved solved>${since} group:"${group}"`
      )}&per_page=100`;
    let pages = 0;
    while (nextUrl && pages < 10) {
      const data = await zget<{
        results: ZendeskTicket[];
        next_page: string | null;
      }>(cfg, nextUrl);
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

    const breakdown = Array.from(counts.entries())
      .map(([id, count]) => ({
        zendeskUserId: id,
        name: userMap.get(id)?.name ?? `User ${id}`,
        email: userMap.get(id)?.email ?? null,
        resolvedCount: count,
      }))
      .sort((a, b) => b.resolvedCount - a.resolvedCount);

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

export default router;
