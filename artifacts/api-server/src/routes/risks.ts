import { Router } from "express";
import { db, risksTable, usersTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

async function enrichRisk(risk: any) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, risk.userId));
  return { ...risk, userName: user?.name ?? "Unknown" };
}

router.get("/", requireAuth, async (req: any, res) => {
  const { status, severity, type, includeArchived } = req.query;
  let conditions: any[] = [];
  if (status) conditions.push(eq(risksTable.status, status as string));
  if (severity) conditions.push(eq(risksTable.severity, severity as string));
  if (type) conditions.push(eq(risksTable.type, type as string));
  // By default, archived items are hidden from the list view. Pass
  // ?includeArchived=1 to see them (e.g., from a "Show archived" toggle).
  if (!includeArchived) conditions.push(isNull(risksTable.archivedAt));

  const risks = conditions.length > 0
    ? await db.select().from(risksTable).where(and(...conditions)).orderBy(desc(risksTable.createdAt))
    : await db.select().from(risksTable).orderBy(desc(risksTable.createdAt));

  const result = await Promise.all(risks.map(enrichRisk));
  return res.json(result);
});

router.post("/", requireAuth, async (req: any, res) => {
  const schema = z.object({
    type: z.enum(["risk", "issue", "suggestion"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    probability: z.enum(["low", "medium", "high", "critical"]).optional(),
    category: z.string().optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    impact: z.string().optional(),
    mitigation: z.string().optional(),
    relatedBuilding: z.string().optional(),
    relatedDevice: z.string().optional(),
    sharedWith: z.array(z.string()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  const [risk] = await db.insert(risksTable).values({
    ...parsed.data,
    userId: req.user.id,
    sharedWith: parsed.data.sharedWith ?? [],
  }).returning();
  const result = await enrichRisk(risk);
  return res.status(201).json(result);
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [risk] = await db.select().from(risksTable).where(eq(risksTable.id, id));
  if (!risk) return res.status(404).json({ error: "Not found" });
  return res.json(await enrichRisk(risk));
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(risksTable).where(eq(risksTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const schema = z.object({
    type: z.enum(["risk", "issue", "suggestion"]).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    probability: z.enum(["low", "medium", "high", "critical"]).optional(),
    category: z.string().optional(),
    status: z.enum(["open", "mitigated", "closed"]).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    impact: z.string().optional(),
    mitigation: z.string().optional(),
    relatedBuilding: z.string().optional(),
    relatedDevice: z.string().optional(),
    sharedWith: z.array(z.string()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [risk] = await db.update(risksTable).set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(risksTable.id, id)).returning();
  return res.json(await enrichRisk(risk));
});

// Archive / unarchive — kept distinct from delete so the audit trail survives.
// Author or CIO may archive; only CIO may permanently delete.
router.post("/:id/archive", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(risksTable).where(eq(risksTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const [risk] = await db
    .update(risksTable)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(risksTable.id, id))
    .returning();
  return res.json(await enrichRisk(risk));
});

router.post("/:id/unarchive", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(risksTable).where(eq(risksTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const [risk] = await db
    .update(risksTable)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(risksTable.id, id))
    .returning();
  return res.json(await enrichRisk(risk));
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(risksTable).where(eq(risksTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const isAuthor = existing.userId === req.user.id;
  const isCio = req.user.role === "cio";
  if (!isAuthor && !isCio) {
    return res.status(403).json({ error: "Only the author or CIO can delete this risk" });
  }
  await db.delete(risksTable).where(eq(risksTable.id, id));
  return res.json({ ok: true });
});

export default router;
