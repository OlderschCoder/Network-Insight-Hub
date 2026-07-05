import { Router } from "express";
import { db, azureVmsTable, azureSyncRunsTable, cioShadowNotesTable, usersTable } from "@workspace/db";
import type { AzureSyncDiff, AzureSyncFieldChange } from "@workspace/db";
import { eq, asc, desc, ilike, or, and, notInArray } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";
import { z } from "zod";
import { getAzureConfig, fetchAzureVms } from "../lib/azure";
import type { AzureVmRecord } from "../lib/azure";
import { summarizeVmRisks, flagVmRisks } from "../lib/azure_risk";
import { sendReportEmail, isEmailConfigured } from "../lib/email";

// Monday (ISO week start) for a YYYY-MM-DD date, used to scope the auto-created
// CIO shadow note to the current reporting week.
function isoWeekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7;
  const monday = new Date(dt.getTime() - (dow - 1) * 86400000);
  return monday.toISOString().slice(0, 10);
}

const router = Router();

// Fields compared to build a per-VM change diff during sync.
const DIFF_FIELDS: (keyof AzureVmRecord)[] = [
  "name",
  "resourceGroup",
  "location",
  "size",
  "os",
  "privateIp",
  "publicIp",
  "vnet",
  "subnet",
  "status",
];

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

// Latest sync run for each kind, so the UI can show a status indicator.
// Registered before "/:id" so these literal paths aren't swallowed by the param route.
router.get("/sync-status", requireAuth, async (_req, res) => {
  const [vmRun] = await db
    .select()
    .from(azureSyncRunsTable)
    .where(eq(azureSyncRunsTable.kind, "vm"))
    .orderBy(desc(azureSyncRunsTable.createdAt))
    .limit(1);
  const [resourceRun] = await db
    .select()
    .from(azureSyncRunsTable)
    .where(eq(azureSyncRunsTable.kind, "resource"))
    .orderBy(desc(azureSyncRunsTable.createdAt))
    .limit(1);
  return res.json({ vm: vmRun ?? null, resource: resourceRun ?? null });
});

// Risk flags across current (non-deleted) VM inventory.
router.get("/risks", requireAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(azureVmsTable)
    .where(notInArray(azureVmsTable.status, ["deleted"]))
    .orderBy(asc(azureVmsTable.name));
  const { items, summary } = summarizeVmRisks(rows);
  return res.json({ items, summary });
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

  const actorId = req.user?.id ?? null;
  const actorName = req.user?.name ?? null;

  let vms;
  try {
    vms = await fetchAzureVms(cfg);
  } catch (err) {
    req.log.error({ err }, "Azure VM sync failed");
    const message = err instanceof Error ? err.message : "Failed to fetch VMs from Azure.";
    // Record the failed run so the UI can surface the last error + when it happened.
    await db
      .insert(azureSyncRunsTable)
      .values({ kind: "vm", status: "failed", error: message.slice(0, 2000), actorId, actorName })
      .catch((e) => req.log.error({ err: e }, "Failed to record failed Azure VM sync run"));
    return res.status(502).json({ error: "AZURE_SYNC_FAILED", message });
  }

  const now = new Date();
  const existing = await db.select().from(azureVmsTable);
  const existingByAzureId = new Map(
    existing.filter((v) => v.azureResourceId).map((v) => [v.azureResourceId as string, v]),
  );

  const diff: AzureSyncDiff = { added: [], removed: [], changed: [] };
  let created = 0;
  let updated = 0;
  // VMs that gained a high-severity risk flag in this sync (newly added and
  // already risky, or existing rows that transitioned into a high-severity
  // state). Used to proactively alert the CIO after the sync.
  const newlyHighRisk: { name: string; resourceGroup: string | null; flags: string[] }[] = [];

  for (const vm of vms) {
    const prior = existingByAzureId.get(vm.azureResourceId);
    const newHighFlags = flagVmRisks(vm).filter((f) => f.severity === "high");
    const priorHadHigh = prior ? flagVmRisks(prior).some((f) => f.severity === "high") : false;
    if (newHighFlags.length > 0 && !priorHadHigh) {
      newlyHighRisk.push({
        name: vm.name,
        resourceGroup: vm.resourceGroup ?? null,
        flags: newHighFlags.map((f) => f.label),
      });
    }
    if (!prior) {
      created++;
      diff.added.push({
        name: vm.name,
        resourceGroup: vm.resourceGroup,
        status: vm.status,
        publicIp: vm.publicIp,
      });
    } else {
      updated++;
      const changes: AzureSyncFieldChange[] = [];
      for (const field of DIFF_FIELDS) {
        const before = (prior as any)[field] ?? null;
        const after = (vm as any)[field] ?? null;
        if (String(before ?? "") !== String(after ?? "")) {
          changes.push({ field, from: before === null ? null : String(before), to: after === null ? null : String(after) });
        }
      }
      if (changes.length > 0) diff.changed.push({ name: vm.name, changes });
    }

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
        createdBy: actorId,
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
  }

  const seenIds = vms.map((v) => v.azureResourceId);
  // Only rows not already marked deleted count as newly removed for the diff.
  const removedRows = await db
    .update(azureVmsTable)
    .set({ status: "deleted", updatedAt: now })
    .where(
      seenIds.length > 0
        ? and(
            eq(azureVmsTable.source, "azure"),
            notInArray(azureVmsTable.azureResourceId, seenIds),
            notInArray(azureVmsTable.status, ["deleted"]),
          )
        : and(eq(azureVmsTable.source, "azure"), notInArray(azureVmsTable.status, ["deleted"])),
    )
    .returning({ name: azureVmsTable.name, resourceGroup: azureVmsTable.resourceGroup });
  const removed = removedRows.length;
  for (const r of removedRows) diff.removed.push({ name: r.name, resourceGroup: r.resourceGroup });

  await db
    .insert(azureSyncRunsTable)
    .values({
      kind: "vm",
      status: "success",
      createdCount: created,
      updatedCount: updated,
      removedCount: removed,
      changedCount: diff.changed.length,
      totalCount: vms.length,
      diff,
      actorId,
      actorName,
    })
    .catch((e) => req.log.error({ err: e }, "Failed to record Azure VM sync run"));

  // Proactively alert the CIO to any VM that became high-severity in this sync,
  // so newly-introduced risks surface on the CIO Insights → Shadow Memory panel
  // without the CIO having to open the Azure VMs page. The note is a private,
  // read-only observation (source "ai") scoped to the current reporting week.
  let alertedCount = 0;
  if (newlyHighRisk.length > 0) {
    const weekOf = isoWeekStart(now.toISOString().slice(0, 10));
    const lines = newlyHighRisk.map((v) => {
      const rg = v.resourceGroup ? ` (${v.resourceGroup})` : "";
      return `- **${v.name}**${rg} — ${v.flags.join(", ")}`;
    });
    const content =
      `Azure sync flagged ${newlyHighRisk.length} newly high-risk VM` +
      `${newlyHighRisk.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}\n\n` +
      `Review these on the Azure VMs page and confirm exposure is intended.`;
    try {
      await db.insert(cioShadowNotesTable).values({
        content,
        category: "azure_risk",
        weekOf,
        status: "open",
        source: "ai",
        createdBy: actorId,
      });
      alertedCount = newlyHighRisk.length;
    } catch (e) {
      req.log.error({ err: e }, "Failed to create Azure risk shadow note");
    }

    // Push the alert to the CIO(s) by email so newly-introduced risks surface
    // even when they're not signed in. Degrades gracefully: no email if SMTP is
    // unconfigured or no active CIO has an address, mirroring the report-email flow.
    if (isEmailConfigured()) {
      try {
        const cios = await db
          .select({ name: usersTable.name, email: usersTable.email })
          .from(usersTable)
          .where(and(eq(usersTable.role, "cio"), eq(usersTable.isActive, true)));
        const recipients = cios.map((c) => c.email).filter((e): e is string => !!e);
        if (recipients.length > 0) {
          const count = newlyHighRisk.length;
          const subject = `Azure alert: ${count} newly high-risk VM${count === 1 ? "" : "s"}`;
          const textLines = newlyHighRisk.map((v) => {
            const rg = v.resourceGroup ? ` (${v.resourceGroup})` : "";
            return `- ${v.name}${rg} — ${v.flags.join(", ")}`;
          });
          const text =
            `The latest Azure sync flagged ${count} newly high-risk VM${count === 1 ? "" : "s"}:\n\n` +
            `${textLines.join("\n")}\n\n` +
            `Review these on the Azure VMs page and confirm exposure is intended.\n\n` +
            `Sent automatically by SCCC IT Reporting Platform.`;
          const htmlItems = newlyHighRisk
            .map((v) => {
              const rg = v.resourceGroup
                ? ` <span style="color:#888">(${v.resourceGroup})</span>`
                : "";
              return `<li><strong>${v.name}</strong>${rg} — ${v.flags.join(", ")}</li>`;
            })
            .join("");
          const html =
            `<p>The latest Azure sync flagged <strong>${count}</strong> newly high-risk VM${count === 1 ? "" : "s"}:</p>` +
            `<ul>${htmlItems}</ul>` +
            `<p>Review these on the Azure VMs page and confirm exposure is intended.</p>` +
            `<p style="color:#888;font-size:12px">Sent automatically by SCCC IT Reporting Platform.</p>`;
          await sendReportEmail({ to: recipients, subject, text, html });
          req.log.info({ recipients: recipients.length, count }, "Sent Azure risk digest email");
        }
      } catch (e) {
        // Never let a mail failure break the sync response.
        req.log.error({ err: e }, "Failed to send Azure risk digest email");
      }
    }
  }

  req.log.info(
    {
      created,
      updated,
      removed,
      changed: diff.changed.length,
      total: vms.length,
      newlyHighRisk: newlyHighRisk.length,
    },
    "Azure VM sync complete",
  );
  return res.json({
    created,
    updated,
    removed,
    changed: diff.changed.length,
    total: vms.length,
    syncedAt: now.toISOString(),
    diff,
    newlyFlagged: alertedCount,
  });
});

export default router;
