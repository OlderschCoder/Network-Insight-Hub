import { Router } from "express";
import { db, afterActionReportsTable, usersTable } from "@workspace/db";
import { eq, and, ilike, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

function zendeskTicketUrl(ticketId: number | null | undefined): string | null {
  if (!ticketId) return null;
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  if (!subdomain) return null;
  return `https://${subdomain}.zendesk.com/agent/tickets/${ticketId}`;
}

async function enrichReport(r: any) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, r.userId));
  return {
    ...r,
    userName: user?.name ?? "Unknown",
    zendeskTicketUrl: zendeskTicketUrl(r.zendeskTicketId),
  };
}

router.get("/", requireAuth, async (req: any, res) => {
  const { building, deviceType, zendeskTicketId } = req.query;
  const conditions: any[] = [];
  if (building) conditions.push(ilike(afterActionReportsTable.building, `%${building}%`));
  if (deviceType) conditions.push(ilike(afterActionReportsTable.deviceType, `%${deviceType}%`));
  if (zendeskTicketId) {
    const parsedTicketId = parseInt(zendeskTicketId as string, 10);
    if (!Number.isNaN(parsedTicketId)) {
      conditions.push(eq(afterActionReportsTable.zendeskTicketId, parsedTicketId));
    }
  }

  const reports = conditions.length > 0
    ? await db.select().from(afterActionReportsTable).where(and(...conditions)).orderBy(desc(afterActionReportsTable.createdAt))
    : await db.select().from(afterActionReportsTable).orderBy(desc(afterActionReportsTable.createdAt));

  const result = await Promise.all(reports.map(enrichReport));
  return res.json(result);
});

router.post("/", requireAuth, async (req: any, res) => {
  const schema = z.object({
    title: z.string().min(1),
    incident: z.string().min(1),
    building: z.string().optional(),
    deviceType: z.string().optional(),
    affectedSystems: z.string().optional(),
    timeline: z.string().optional(),
    rootCause: z.string().optional(),
    resolution: z.string().optional(),
    lessonsLearned: z.string().optional(),
    preventionMeasures: z.string().optional(),
    status: z.enum(["open", "resolved", "closed"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    zendeskTicketId: z.number().int().positive().nullable().optional(),
    incidentDate: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  const [report] = await db.insert(afterActionReportsTable).values({
    ...parsed.data,
    userId: req.user.id,
    zendeskTicketId: parsed.data.zendeskTicketId ?? null,
    incidentDate: parsed.data.incidentDate ? new Date(parsed.data.incidentDate) : null,
  }).returning();
  return res.status(201).json(await enrichReport(report));
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [report] = await db.select().from(afterActionReportsTable).where(eq(afterActionReportsTable.id, id));
  if (!report) return res.status(404).json({ error: "Not found" });
  return res.json(await enrichReport(report));
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(afterActionReportsTable).where(eq(afterActionReportsTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const schema = z.object({
    title: z.string().optional(),
    incident: z.string().optional(),
    building: z.string().optional(),
    deviceType: z.string().optional(),
    affectedSystems: z.string().optional(),
    timeline: z.string().optional(),
    rootCause: z.string().optional(),
    resolution: z.string().optional(),
    lessonsLearned: z.string().optional(),
    preventionMeasures: z.string().optional(),
    status: z.enum(["open", "resolved", "closed"]).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    zendeskTicketId: z.number().int().positive().nullable().optional(),
    incidentDate: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const updateData: any = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.incidentDate) updateData.incidentDate = new Date(parsed.data.incidentDate);
  if (parsed.data.status === "resolved" && !existing.resolvedAt) updateData.resolvedAt = new Date();
  const [report] = await db.update(afterActionReportsTable).set(updateData)
    .where(eq(afterActionReportsTable.id, id)).returning();
  return res.json(await enrichReport(report));
});

export default router;
