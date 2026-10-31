import { Router } from "express";
import { db, logItemsTable, usersTable } from "@workspace/db";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

function isoWeekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7;
  const monday = new Date(dt.getTime() - (dow - 1) * 86400000);
  return monday.toISOString().slice(0, 10);
}

function todayInCentral(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function enrich(item: any) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, item.userId));
  return { ...item, userName: user?.name ?? "Unknown", userRole: user?.role ?? "unknown" };
}

// GET /api/log-items?weekOf=YYYY-MM-DD&userId=N&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/", requireAuth, async (req: any, res) => {
  const querySchema = z.object({
    weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    userId: z.string().regex(/^\d+$/).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", message: parsed.error.message });
  }
  const { weekOf, userId: queryUserId, from, to } = parsed.data;
  const conditions: any[] = [];

  // Non-CIO users only see their own items
  if (req.user.role !== "cio") {
    conditions.push(eq(logItemsTable.userId, req.user.id));
  } else if (queryUserId) {
    conditions.push(eq(logItemsTable.userId, parseInt(queryUserId)));
  }

  if (weekOf) conditions.push(eq(logItemsTable.weekOf, weekOf));
  if (from) conditions.push(gte(logItemsTable.itemDate, from));
  if (to) conditions.push(lte(logItemsTable.itemDate, to));

  const rows = conditions.length > 0
    ? await db.select().from(logItemsTable).where(and(...conditions)).orderBy(desc(logItemsTable.itemDate), desc(logItemsTable.createdAt))
    : await db.select().from(logItemsTable).orderBy(desc(logItemsTable.itemDate), desc(logItemsTable.createdAt));

  const result = await Promise.all(rows.map(enrich));
  return res.json(result);
});

router.post("/", requireAuth, async (req: any, res) => {
  const schema = z.object({
    title: z.string().min(1),
    category: z.string().optional(),
    notes: z.string().optional(),
    itemDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  }
  const itemDate = parsed.data.itemDate || todayInCentral();
  const weekOf = isoWeekStart(itemDate);

  const [row] = await db.insert(logItemsTable).values({
    userId: req.user.id,
    title: parsed.data.title,
    category: parsed.data.category ?? "task",
    notes: parsed.data.notes,
    itemDate,
    weekOf,
  }).returning();

  return res.status(201).json(await enrich(row));
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(logItemsTable).where(eq(logItemsTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && row.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return res.json(await enrich(row));
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(logItemsTable).where(eq(logItemsTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const schema = z.object({
    title: z.string().min(1).optional(),
    category: z.string().optional(),
    notes: z.string().nullable().optional(),
    itemDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  }
  const updates: any = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.itemDate) updates.weekOf = isoWeekStart(parsed.data.itemDate);

  const [row] = await db.update(logItemsTable).set(updates).where(eq(logItemsTable.id, id)).returning();
  return res.json(await enrich(row));
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(logItemsTable).where(eq(logItemsTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  await db.delete(logItemsTable).where(eq(logItemsTable.id, id));
  return res.status(204).send();
});

export default router;
