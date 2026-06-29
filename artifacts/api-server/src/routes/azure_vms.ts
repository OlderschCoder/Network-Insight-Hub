import { Router } from "express";
import { db, azureVmsTable } from "@workspace/db";
import { eq, asc, ilike, or, and, notInArray } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";
import { z } from "zod";
import { getAzureConfig, fetchAzureVms } from "../lib/azure";

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

router.post("/sync", requireAuth, requireCIO, async (req: any, res) => {
  const cfg = getAzureConfig();
  if (!cfg) {
    return res.status(503).json({
      error: "AZURE_NOT_CONFIGURED",
      message:
        "Azure credentials are not set. Configure AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and AZURE_SUBSCRIPTION_ID.",
    });
  }

  let vms;
  try {
    vms = await fetchAzureVms(cfg);
  } catch (err) {
    req.log.error({ err }, "Azure VM sync failed");
    return res.status(502).json({
      error: "AZURE_SYNC_FAILED",
      message: err instanceof Error ? err.message : "Failed to fetch VMs from Azure.",
    });
  }

  const now = new Date();
  const existing = await db.select().from(azureVmsTable);
  const existingAzureIds = new Set(
    existing.filter((v) => v.azureResourceId).map((v) => v.azureResourceId as string),
  );

  let created = 0;
  let updated = 0;

  for (const vm of vms) {
    const isNew = !existingAzureIds.has(vm.azureResourceId);
    await db
      .insert(azureVmsTable)
      .values({
        azureResourceId: vm.azureResourceId,
        name: vm.name,
        resourceGroup: vm.resourceGroup,
        subscription: vm.subscription,
        location: vm.location,
        size: vm.size,
        os: vm.os,
        privateIp: vm.privateIp,
        publicIp: vm.publicIp,
        vnet: vm.vnet,
        subnet: vm.subnet,
        status: vm.status,
        source: "azure",
        lastSyncedAt: now,
        createdBy: req.user?.id ?? null,
      })
      .onConflictDoUpdate({
        target: azureVmsTable.azureResourceId,
        set: {
          name: vm.name,
          resourceGroup: vm.resourceGroup,
          subscription: vm.subscription,
          location: vm.location,
          size: vm.size,
          os: vm.os,
          privateIp: vm.privateIp,
          publicIp: vm.publicIp,
          vnet: vm.vnet,
          subnet: vm.subnet,
          status: vm.status,
          source: "azure",
          lastSyncedAt: now,
          updatedAt: now,
        },
      });
    if (isNew) created++;
    else updated++;
  }

  const seenIds = vms.map((v) => v.azureResourceId);
  let removed = 0;
  const removedRows = await db
    .update(azureVmsTable)
    .set({ status: "deleted", updatedAt: now })
    .where(
      seenIds.length > 0
        ? and(eq(azureVmsTable.source, "azure"), notInArray(azureVmsTable.azureResourceId, seenIds))
        : eq(azureVmsTable.source, "azure"),
    )
    .returning({ id: azureVmsTable.id });
  removed = removedRows.length;

  req.log.info({ created, updated, removed, total: vms.length }, "Azure VM sync complete");
  return res.json({ created, updated, removed, total: vms.length, syncedAt: now.toISOString() });
});

export default router;
