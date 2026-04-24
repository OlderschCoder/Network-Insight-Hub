import { Router } from "express";
import { db, azureVmsTable } from "@workspace/db";
import { eq, asc, ilike, or } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";
import { z } from "zod";

const router = Router();

const upsertSchema = z.object({
  name: z.string().min(1).max(255),
  resourceGroup: z.string().max(255).optional().nullable(),
  subscription: z.string().max(255).optional().nullable(),
  location: z.string().max(100).optional().nullable(),
  size: z.string().max(100).optional().nullable(),
  os: z.string().max(100).optional().nullable(),
  privateIp: z.string().max(50).optional().nullable(),
  publicIp: z.string().max(50).optional().nullable(),
  vnet: z.string().max(255).optional().nullable(),
  subnet: z.string().max(255).optional().nullable(),
  status: z.string().max(50).optional(),
  purpose: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  owner: z.string().max(255).optional().nullable(),
});

router.get("/", requireAuth, async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const rows = await db
    .select()
    .from(azureVmsTable)
    .where(
      q
        ? or(
            ilike(azureVmsTable.name, `%${q}%`),
            ilike(azureVmsTable.resourceGroup, `%${q}%`),
            ilike(azureVmsTable.location, `%${q}%`),
            ilike(azureVmsTable.privateIp, `%${q}%`),
            ilike(azureVmsTable.publicIp, `%${q}%`),
            ilike(azureVmsTable.purpose, `%${q}%`),
          )
        : undefined,
    )
    .orderBy(asc(azureVmsTable.name));
  return res.json(rows);
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(azureVmsTable).where(eq(azureVmsTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(row);
});

router.post("/", requireAuth, requireCIO, async (req: any, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [row] = await db
    .insert(azureVmsTable)
    .values({ ...parsed.data, createdBy: req.user?.id ?? null })
    .returning();
  return res.status(201).json(row);
});

router.patch("/:id", requireAuth, requireCIO, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [row] = await db
    .update(azureVmsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(azureVmsTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(row);
});

router.delete("/:id", requireAuth, requireCIO, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db.delete(azureVmsTable).where(eq(azureVmsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true });
});

export default router;
