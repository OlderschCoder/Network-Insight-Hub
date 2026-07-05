import { Router } from "express";
import { db, cioShadowNotesTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireCIO } from "./auth";
import { redactSecretLike } from "../lib/ai_knowledge";

// CIO-only "shadow memory": a private staging area of AI/CIO observations and
// suggestions surfaced at reporting time. These notes never modify any actual
// report or deliverable, and are visible to the CIO only. Every route here is
// gated behind requireCIO in addition to requireAuth.
const router = Router();

const STATUSES = ["open", "approved", "dismissed"] as const;

router.get("/", requireAuth, requireCIO, async (req: any, res) => {
  const querySchema = z.object({
    weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(STATUSES).optional(),
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", message: parsed.error.message });
  }
  const conditions: any[] = [];
  if (parsed.data.weekOf) conditions.push(eq(cioShadowNotesTable.weekOf, parsed.data.weekOf));
  if (parsed.data.status) conditions.push(eq(cioShadowNotesTable.status, parsed.data.status));

  const rows = await db
    .select({
      id: cioShadowNotesTable.id,
      weekOf: cioShadowNotesTable.weekOf,
      category: cioShadowNotesTable.category,
      content: cioShadowNotesTable.content,
      status: cioShadowNotesTable.status,
      source: cioShadowNotesTable.source,
      createdBy: cioShadowNotesTable.createdBy,
      createdByName: usersTable.name,
      createdAt: cioShadowNotesTable.createdAt,
      updatedAt: cioShadowNotesTable.updatedAt,
    })
    .from(cioShadowNotesTable)
    .leftJoin(usersTable, eq(cioShadowNotesTable.createdBy, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(cioShadowNotesTable.createdAt));
  return res.json(rows);
});

const createSchema = z.object({
  content: z.string().min(1).max(20000),
  category: z.string().min(1).max(50).optional(),
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post("/", requireAuth, requireCIO, async (req: any, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const [row] = await db
    .insert(cioShadowNotesTable)
    .values({
      content: redactSecretLike(parsed.data.content).text,
      category: (parsed.data.category ?? "general").toLowerCase().slice(0, 50),
      weekOf: parsed.data.weekOf,
      source: "manual",
      createdBy: req.user.id,
    })
    .returning();
  return res.status(201).json(row);
});

const updateSchema = z.object({
  content: z.string().min(1).max(20000).optional(),
  category: z.string().min(1).max(50).optional(),
  status: z.enum(STATUSES).optional(),
});

router.patch("/:id", requireAuth, requireCIO, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }
  const updates: any = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.content) updates.content = redactSecretLike(parsed.data.content).text;
  if (parsed.data.category) updates.category = parsed.data.category.toLowerCase().slice(0, 50);
  const [row] = await db
    .update(cioShadowNotesTable)
    .set(updates)
    .where(eq(cioShadowNotesTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(row);
});

router.delete("/:id", requireAuth, requireCIO, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const [row] = await db
    .delete(cioShadowNotesTable)
    .where(eq(cioShadowNotesTable.id, id))
    .returning({ id: cioShadowNotesTable.id });
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json({ success: true });
});

export default router;
