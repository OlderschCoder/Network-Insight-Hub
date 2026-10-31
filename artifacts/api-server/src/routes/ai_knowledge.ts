import { Router } from "express";
import { db, aiKnowledgeTable, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireCIO } from "./auth";
import { redactSecretLike } from "../lib/ai_knowledge";

const router = Router();

const CATEGORIES = [
  "organization", "environment", "network", "wireless", "azure", "identity",
  "applications", "endpoints", "monitoring", "security", "helpdesk", "general",
] as const;

router.get("/", requireAuth, async (_req: any, res) => {
  const rows = await db
    .select({
      id: aiKnowledgeTable.id,
      category: aiKnowledgeTable.category,
      title: aiKnowledgeTable.title,
      content: aiKnowledgeTable.content,
      source: aiKnowledgeTable.source,
      isActive: aiKnowledgeTable.isActive,
      updatedBy: aiKnowledgeTable.updatedBy,
      updatedByName: usersTable.name,
      createdAt: aiKnowledgeTable.createdAt,
      updatedAt: aiKnowledgeTable.updatedAt,
    })
    .from(aiKnowledgeTable)
    .leftJoin(usersTable, eq(aiKnowledgeTable.updatedBy, usersTable.id))
    .orderBy(asc(aiKnowledgeTable.category), asc(aiKnowledgeTable.title));
  return res.json(rows);
});

const createSchema = z.object({
  category: z.enum(CATEGORIES).default("general"),
  title: z.string().min(1).max(300),
  content: z.string().min(1).max(20000),
});

router.post("/", requireAuth, async (req: any, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const title = redactSecretLike(parsed.data.title).text;
  const content = redactSecretLike(parsed.data.content).text;
  const [row] = await db
    .insert(aiKnowledgeTable)
    .values({ ...parsed.data, title, content, source: "manual", updatedBy: req.user.id })
    .returning();
  return res.status(201).json(row);
});

const updateSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  title: z.string().min(1).max(300).optional(),
  content: z.string().min(1).max(20000).optional(),
  isActive: z.boolean().optional(),
});

router.patch("/:id", requireAuth, async (req: any, res) => {
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
  const scrubbed = { ...parsed.data };
  if (scrubbed.title) scrubbed.title = redactSecretLike(scrubbed.title).text;
  if (scrubbed.content) scrubbed.content = redactSecretLike(scrubbed.content).text;
  const [row] = await db
    .update(aiKnowledgeTable)
    .set({ ...scrubbed, updatedBy: req.user.id, updatedAt: new Date() })
    .where(eq(aiKnowledgeTable.id, id))
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
    .delete(aiKnowledgeTable)
    .where(eq(aiKnowledgeTable.id, id))
    .returning({ id: aiKnowledgeTable.id });
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json({ success: true });
});

export default router;
