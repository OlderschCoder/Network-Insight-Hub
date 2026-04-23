import { Router } from "express";
import { db, strategicObjectivesTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";
import { z } from "zod";

const router = Router();

const bodySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  status: z.enum(["active", "archived"]).optional(),
});

async function enrich(id: number) {
  const [row] = await db.select().from(strategicObjectivesTable).where(eq(strategicObjectivesTable.id, id));
  if (!row) return null;
  let createdByName: string | null = null;
  if (row.createdBy) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, row.createdBy));
    createdByName = u?.name ?? null;
  }
  return { ...row, createdByName };
}

router.get("/", requireAuth, async (_req, res) => {
  const rows = await db.select().from(strategicObjectivesTable).orderBy(desc(strategicObjectivesTable.createdAt));
  return res.json(rows);
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const data = await enrich(id);
  if (!data) return res.status(404).json({ error: "Not found" });
  return res.json(data);
});

router.post("/", requireAuth, requireCIO, async (req: any, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", details: parsed.error.issues });
  }
  const [row] = await db.insert(strategicObjectivesTable).values({
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    status: parsed.data.status ?? "active",
    createdBy: req.user.id,
  }).returning();
  const enriched = await enrich(row.id);
  return res.status(201).json(enriched);
});

router.patch("/:id", requireAuth, requireCIO, async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = bodySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", details: parsed.error.issues });
  }
  const [row] = await db.update(strategicObjectivesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(strategicObjectivesTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  const enriched = await enrich(id);
  return res.json(enriched);
});

router.delete("/:id", requireAuth, requireCIO, async (req, res) => {
  const id = parseInt(req.params.id);
  const [deleted] = await db.delete(strategicObjectivesTable).where(eq(strategicObjectivesTable.id, id)).returning();
  if (!deleted) return res.status(404).json({ error: "Not found" });
  return res.json({ success: true });
});

export default router;
