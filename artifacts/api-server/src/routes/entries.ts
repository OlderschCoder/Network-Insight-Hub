import { Router } from "express";
import { db, entriesTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

async function entryWithUser(entry: any, userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return {
    ...entry,
    userName: user?.name ?? "Unknown",
    userRole: user?.role ?? "unknown",
  };
}

router.get("/", requireAuth, async (req: any, res) => {
  const { weekOf, userId: queryUserId, category } = req.query;
  let conditions: any[] = [];
  if (req.user.role !== "cio") {
    conditions.push(eq(entriesTable.userId, req.user.id));
  } else if (queryUserId) {
    conditions.push(eq(entriesTable.userId, parseInt(queryUserId as string)));
  }
  if (weekOf) conditions.push(eq(entriesTable.weekOf, weekOf as string));
  if (category) conditions.push(eq(entriesTable.category, category as string));

  const entries = conditions.length > 0
    ? await db.select().from(entriesTable).where(and(...conditions)).orderBy(desc(entriesTable.createdAt))
    : await db.select().from(entriesTable).orderBy(desc(entriesTable.createdAt));

  const result = await Promise.all(entries.map(e => entryWithUser(e, e.userId)));
  return res.json(result);
});

router.post("/", requireAuth, async (req: any, res) => {
  const schema = z.object({
    category: z.enum(["helpdesk", "network", "security", "general"]),
    title: z.string().min(1),
    description: z.string().min(1),
    accomplishments: z.string().optional(),
    challenges: z.string().optional(),
    supportNeeded: z.string().optional(),
    ticketCount: z.number().optional(),
    weekOf: z.string(),
    entryDate: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isSubmitted: z.boolean().optional(),
    completedItems: z.array(z.object({
      title: z.string().min(1),
      notes: z.string().optional(),
      category: z.string().optional(),
    })).optional(),
    zendeskTicketIds: z.array(z.number()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  const [entry] = await db.insert(entriesTable).values({
    ...parsed.data,
    userId: req.user.id,
    tags: parsed.data.tags ?? [],
    completedItems: parsed.data.completedItems ?? [],
    zendeskTicketIds: parsed.data.zendeskTicketIds ?? [],
    ticketCount: parsed.data.zendeskTicketIds?.length ?? parsed.data.ticketCount ?? 0,
  }).returning();
  const result = await entryWithUser(entry, entry.userId);
  return res.status(201).json(result);
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.id, id));
  if (!entry) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && entry.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await entryWithUser(entry, entry.userId);
  return res.json(result);
});

router.put("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(entriesTable).where(eq(entriesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const schema = z.object({
    category: z.enum(["helpdesk", "network", "security", "general"]).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    accomplishments: z.string().optional(),
    challenges: z.string().optional(),
    supportNeeded: z.string().optional(),
    ticketCount: z.number().optional(),
    weekOf: z.string().optional(),
    entryDate: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isSubmitted: z.boolean().optional(),
    completedItems: z.array(z.object({
      title: z.string().min(1),
      notes: z.string().optional(),
      category: z.string().optional(),
    })).optional(),
    zendeskTicketIds: z.array(z.number()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const updates: any = { ...parsed.data, updatedAt: new Date() };
  // Keep ticketCount in sync with zendeskTicketIds when ids are provided
  if (parsed.data.zendeskTicketIds !== undefined && parsed.data.ticketCount === undefined) {
    updates.ticketCount = parsed.data.zendeskTicketIds.length;
  }
  const [entry] = await db.update(entriesTable).set(updates)
    .where(eq(entriesTable.id, id)).returning();
  const result = await entryWithUser(entry, entry.userId);
  return res.json(result);
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(entriesTable).where(eq(entriesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  await db.delete(entriesTable).where(eq(entriesTable.id, id));
  return res.status(204).send();
});

export default router;
