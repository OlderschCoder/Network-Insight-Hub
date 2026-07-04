import { Router } from "express";
import { db, azureResourcesTable, azureSyncRunsTable } from "@workspace/db";
import { asc, ilike, or, and, eq, notInArray } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";
import { getAzureConfig, fetchAzureResources } from "../lib/azure";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const type = (req.query.type as string | undefined)?.trim();
  const conditions = [] as any[];
  if (q) {
    conditions.push(
      or(
        ilike(azureResourcesTable.name, `%${q}%`),
        ilike(azureResourcesTable.type, `%${q}%`),
        ilike(azureResourcesTable.resourceGroup, `%${q}%`),
        ilike(azureResourcesTable.location, `%${q}%`),
      ),
    );
  }
  if (type) conditions.push(eq(azureResourcesTable.type, type));

  const rows = await db
    .select()
    .from(azureResourcesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(azureResourcesTable.type), asc(azureResourcesTable.name));
  return res.json(rows);
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

  const actorId = req.user?.id ?? null;
  const actorName = req.user?.name ?? null;

  let resources;
  try {
    resources = await fetchAzureResources(cfg);
  } catch (err) {
    req.log.error({ err }, "Azure resource sync failed");
    const message = err instanceof Error ? err.message : "Failed to fetch resources from Azure.";
    await db
      .insert(azureSyncRunsTable)
      .values({ kind: "resource", status: "failed", error: message.slice(0, 2000), actorId, actorName })
      .catch((e) => req.log.error({ err: e }, "Failed to record failed Azure resource sync run"));
    return res.status(502).json({ error: "AZURE_SYNC_FAILED", message });
  }

  const now = new Date();
  const existing = await db.select().from(azureResourcesTable);
  const existingIds = new Set(existing.map((r) => r.azureResourceId));

  let created = 0;
  let updated = 0;

  for (const r of resources) {
    const isNew = !existingIds.has(r.azureResourceId);
    await db
      .insert(azureResourcesTable)
      .values({
        azureResourceId: r.azureResourceId,
        name: r.name,
        type: r.type,
        resourceGroup: r.resourceGroup,
        location: r.location,
        kind: r.kind,
        sku: r.sku,
        tags: r.tags ?? undefined,
        subscription: r.subscription,
        status: "active",
        source: "azure",
        lastSyncedAt: now,
        createdBy: req.user?.id ?? null,
      })
      .onConflictDoUpdate({
        target: azureResourcesTable.azureResourceId,
        set: {
          name: r.name,
          type: r.type,
          resourceGroup: r.resourceGroup,
          location: r.location,
          kind: r.kind,
          sku: r.sku,
          tags: r.tags ?? null,
          subscription: r.subscription,
          status: "active",
          source: "azure",
          lastSyncedAt: now,
          updatedAt: now,
        },
      });
    if (isNew) created++;
    else updated++;
  }

  const seenIds = resources.map((r) => r.azureResourceId);
  const removedRows = await db
    .update(azureResourcesTable)
    .set({ status: "deleted", updatedAt: now })
    .where(
      seenIds.length > 0
        ? and(
            eq(azureResourcesTable.source, "azure"),
            notInArray(azureResourcesTable.azureResourceId, seenIds),
            notInArray(azureResourcesTable.status, ["deleted"]),
          )
        : and(
            eq(azureResourcesTable.source, "azure"),
            notInArray(azureResourcesTable.status, ["deleted"]),
          ),
    )
    .returning({ id: azureResourcesTable.id });

  await db
    .insert(azureSyncRunsTable)
    .values({
      kind: "resource",
      status: "success",
      createdCount: created,
      updatedCount: updated,
      removedCount: removedRows.length,
      totalCount: resources.length,
      actorId,
      actorName,
    })
    .catch((e) => req.log.error({ err: e }, "Failed to record Azure resource sync run"));

  req.log.info(
    { created, updated, removed: removedRows.length, total: resources.length },
    "Azure resource sync complete",
  );
  return res.json({
    created,
    updated,
    removed: removedRows.length,
    total: resources.length,
    syncedAt: now.toISOString(),
  });
});

export default router;
