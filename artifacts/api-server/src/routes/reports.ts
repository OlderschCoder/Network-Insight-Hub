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
