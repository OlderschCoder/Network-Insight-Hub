import { Router } from "express";
import { db, quotesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";
import { z } from "zod";

const router = Router();

router.get("/today", requireAuth, async (_req, res) => {
  const allQuotes = await db.select().from(quotesTable);
  if (allQuotes.length === 0) return res.json(null);
  // Deterministic by day-of-year so it's the same quote all day
  const now = new Date();
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  const idx = dayOfYear % allQuotes.length;
  return res.json(allQuotes[idx]);
});

router.get("/", requireAuth, async (_req, res) => {
  const all = await db.select().from(quotesTable).orderBy(quotesTable.id);
  return res.json(all);
});

router.post("/", requireAuth, requireCIO, async (req, res) => {
  const schema = z.object({
    text: z.string().min(1).max(2000),
    author: z.string().max(255).optional(),
    category: z.string().max(50).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [q] = await db.insert(quotesTable).values(parsed.data).returning();
  return res.status(201).json(q);
});

router.delete("/:id", requireAuth, requireCIO, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await db.delete(quotesTable).where(eq(quotesTable.id, id));
  return res.status(204).end();
});

export default router;
