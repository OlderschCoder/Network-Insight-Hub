import { Router } from "express";
import { db, reportsTable, entriesTable, risksTable, usersTable } from "@workspace/db";
import { eq, and, desc, count, sum } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";
import { z } from "zod";

const router = Router();

function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

router.get("/aggregate", requireAuth, async (req: any, res) => {
  const { weekOf } = req.query;
  if (!weekOf) return res.status(400).json({ error: "weekOf required" });

  const entries = await db.select({
    entry: entriesTable,
    user: usersTable,
  }).from(entriesTable)
    .leftJoin(usersTable, eq(entriesTable.userId, usersTable.id))
    .where(eq(entriesTable.weekOf, weekOf as string));

  const risks = await db.select().from(risksTable).where(eq(risksTable.status, "open"));

  const byRole: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalTickets = 0;
  const contributors = new Set<number>();

  for (const { entry, user } of entries) {
    const role = user?.role ?? "unknown";
    byRole[role] = (byRole[role] ?? 0) + 1;
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
    totalTickets += entry.ticketCount ?? 0;
    contributors.add(entry.userId);
  }

  const enrichedEntries = entries.map(({ entry, user }) => ({
    ...entry,
    userName: user?.name ?? "Unknown",
    userRole: user?.role ?? "unknown",
  }));

  const enrichedRisks = await Promise.all(risks.map(async (r) => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, r.userId));
    return { ...r, userName: user?.name ?? "Unknown" };
  }));

  return res.json({
    weekOf,
    totalEntries: entries.length,
    contributorCount: contributors.size,
    byRole,
    byCategory,
    totalTickets,
    openRisks: risks.length,
    entrySummaries: enrichedEntries,
    risks: enrichedRisks,
  });
});

router.get("/", requireAuth, async (req: any, res) => {
  const { status } = req.query;
  let reports;
  if (status) {
    reports = await db.select().from(reportsTable).where(eq(reportsTable.status, status as string)).orderBy(desc(reportsTable.createdAt));
  } else {
    reports = await db.select().from(reportsTable).orderBy(desc(reportsTable.createdAt));
  }
  const enriched = await Promise.all(reports.map(async (r) => {
    let createdByName = "Unknown";
    if (r.createdBy) {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, r.createdBy));
      createdByName = user?.name ?? "Unknown";
    }
    return { ...r, createdByName };
  }));
  return res.json(enriched);
});

router.post("/", requireAuth, requireCIO, async (req: any, res) => {
  const schema = z.object({
    weekOf: z.string(),
    title: z.string().optional(),
    summary: z.string().optional(),
    accomplishments: z.string().optional(),
    challenges: z.string().optional(),
    strategicProgress: z.string().optional(),
    nextWeekPlans: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [report] = await db.insert(reportsTable).values({
    ...parsed.data,
    createdBy: req.user.id,
  }).returning();
  return res.status(201).json({ ...report, createdByName: req.user.name });
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) return res.status(404).json({ error: "Not found" });
  let createdByName = "Unknown";
  if (report.createdBy) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, report.createdBy));
    createdByName = user?.name ?? "Unknown";
  }
  return res.json({ ...report, createdByName });
});

// All Zendesk-resolved tickets during this report's week (group-wide)
router.get("/:id/tickets", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) return res.status(404).json({ error: "Not found" });

  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const token = process.env.ZENDESK_API_TOKEN;
  if (!subdomain || !email || !token) {
    return res.json({ weekOf: report.weekOf, count: 0, tickets: [], configured: false });
  }
  const auth = Buffer.from(`${email}/token:${token}`).toString("base64");
  const group = process.env.ZENDESK_GROUP || "Onsite_it";

  // Build a 7-day date set starting at weekOf
  const dateSet = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(report.weekOf + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    dateSet.add(d.toISOString().slice(0, 10));
  }
  const earliest = Array.from(dateSet).sort()[0];
  const dayBefore = new Date(new Date(earliest).getTime() - 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  try {
    const all: any[] = [];
    let nextUrl: string | null =
      `https://${subdomain}.zendesk.com/api/v2/search.json?query=${encodeURIComponent(
        `type:ticket solved>${dayBefore} group:"${group}"`
      )}&per_page=100`;
    let pages = 0;
    while (nextUrl && pages < 10) {
      const r = await fetch(nextUrl, {
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      });
      if (!r.ok) break;
      const data: any = await r.json();
      all.push(...(data.results ?? []));
      nextUrl = data.next_page ?? null;
      pages++;
    }

    const onWeek = all.filter((t) => dateSet.has((t.updated_at || "").slice(0, 10)));

    // Resolve assignee names
    const ids = Array.from(new Set(onWeek.map((t) => t.assignee_id).filter(Boolean)));
    const userMap = new Map<number, string>();
    if (ids.length > 0) {
      const r = await fetch(
        `https://${subdomain}.zendesk.com/api/v2/users/show_many.json?ids=${ids.join(",")}`,
        { headers: { Authorization: `Basic ${auth}` } },
      );
      if (r.ok) {
        const data: any = await r.json();
        for (const u of data.users ?? []) userMap.set(u.id, u.name);
      }
    }

    return res.json({
      weekOf: report.weekOf,
      count: onWeek.length,
      configured: true,
      tickets: onWeek.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        assigneeName: t.assignee_id ? userMap.get(t.assignee_id) ?? null : null,
        updatedAt: t.updated_at,
        url: `https://${subdomain}.zendesk.com/agent/tickets/${t.id}`,
      })),
    });
  } catch (e: any) {
    return res.status(502).json({ error: "Zendesk API error", message: e.message });
  }
});

router.delete("/:id", requireAuth, requireCIO, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [deleted] = await db.delete(reportsTable).where(eq(reportsTable.id, id)).returning();
  if (!deleted) return res.status(404).json({ error: "Not found" });
  return res.json({ success: true });
});

router.patch("/:id", requireAuth, requireCIO, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const schema = z.object({
    title: z.string().optional(),
    summary: z.string().optional(),
    accomplishments: z.string().optional(),
    challenges: z.string().optional(),
    strategicProgress: z.string().optional(),
    nextWeekPlans: z.string().optional(),
    status: z.enum(["draft", "finalized"]).optional(),
    selectedItemIds: z.array(z.number()).nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [report] = await db.update(reportsTable).set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(reportsTable.id, id)).returning();
  if (!report) return res.status(404).json({ error: "Not found" });
  return res.json(report);
});

router.post("/:id/finalize", requireAuth, requireCIO, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) return res.status(404).json({ error: "Not found" });

  const entries = await db.select().from(entriesTable).where(eq(entriesTable.weekOf, report.weekOf));
  const contributors = new Set(entries.map(e => e.userId));
  let totalTickets = entries.reduce((sum, e) => sum + (e.ticketCount ?? 0), 0);

  const [updated] = await db.update(reportsTable).set({
    status: "finalized",
    finalizedAt: new Date(),
    contributorCount: contributors.size,
    entryCount: entries.length,
    updatedAt: new Date(),
  }).where(eq(reportsTable.id, id)).returning();

  let createdByName = "Unknown";
  if (updated.createdBy) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.createdBy));
    createdByName = user?.name ?? "Unknown";
  }
  return res.json({ ...updated, createdByName });
});

export default router;
