import { Router } from "express";
import { db, processesTable, usersTable } from "@workspace/db";
import { eq, and, desc, or, ilike } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

async function uniqueSlug(base: string, excludeId?: number): Promise<string> {
  let slug = base;
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const [hit] = await db.select().from(processesTable).where(eq(processesTable.slug, candidate));
    if (!hit || hit.id === excludeId) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

async function enrich(p: any) {
  const [creator] = p.createdBy
    ? await db.select().from(usersTable).where(eq(usersTable.id, p.createdBy))
    : [];
  const [updater] = p.updatedBy
    ? await db.select().from(usersTable).where(eq(usersTable.id, p.updatedBy))
    : [];
  return {
    ...p,
    createdByName: creator?.name ?? null,
    updatedByName: updater?.name ?? null,
  };
}

// GET /api/processes?category=&q=
router.get("/", requireAuth, async (req: any, res) => {
  const { category, q } = req.query as { category?: string; q?: string };
  const conditions: any[] = [];
  if (category) conditions.push(eq(processesTable.category, category));
  if (q && q.trim()) {
    const needle = `%${q.trim()}%`;
    conditions.push(
      or(
        ilike(processesTable.title, needle),
        ilike(processesTable.summary, needle),
        ilike(processesTable.content, needle),
      )!,
    );
  }
  const rows = conditions.length
    ? await db.select().from(processesTable).where(and(...conditions)).orderBy(desc(processesTable.updatedAt))
    : await db.select().from(processesTable).orderBy(desc(processesTable.updatedAt));
  const enriched = await Promise.all(rows.map(enrich));
  return res.json(enriched);
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(processesTable).where(eq(processesTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(await enrich(row));
});

router.post("/", requireAuth, async (req: any, res) => {
  const schema = z.object({
    title: z.string().min(1).max(255),
    category: z.string().max(50).optional(),
    summary: z.string().optional(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    slug: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  }
  const baseSlug = slugify(parsed.data.slug || parsed.data.title);
  const slug = await uniqueSlug(baseSlug);
  const [row] = await db.insert(processesTable).values({
    title: parsed.data.title,
    slug,
    category: parsed.data.category || "general",
    summary: parsed.data.summary,
    content: parsed.data.content ?? "",
    tags: parsed.data.tags ?? [],
    createdBy: req.user.id,
    updatedBy: req.user.id,
  }).returning();
  return res.status(201).json(await enrich(row));
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(processesTable).where(eq(processesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.createdBy !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const schema = z.object({
    title: z.string().min(1).max(255).optional(),
    category: z.string().max(50).optional(),
    summary: z.string().nullable().optional(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    slug: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  }
  const updates: any = {
    ...parsed.data,
    updatedBy: req.user.id,
    updatedAt: new Date(),
  };
  if (parsed.data.slug || parsed.data.title) {
    const base = slugify(parsed.data.slug || parsed.data.title || existing.title);
    if (base !== existing.slug) updates.slug = await uniqueSlug(base, id);
    else delete updates.slug;
  }
  const [row] = await db.update(processesTable).set(updates).where(eq(processesTable.id, id)).returning();
  return res.json(await enrich(row));
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [existing] = await db.select().from(processesTable).where(eq(processesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.createdBy !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  await db.delete(processesTable).where(eq(processesTable.id, id));
  return res.status(204).send();
});

export default router;
