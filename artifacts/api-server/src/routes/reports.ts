import { Router } from "express";
import {
  db,
  reportsTable,
  entriesTable,
  risksTable,
  usersTable,
  afterActionReportsTable,
  networkSwitchesTable,
  vlansTable,
  strategicObjectivesTable,
  projectsTable,
  logItemsTable,
} from "@workspace/db";
import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";
import { z } from "zod";
import { sendReportEmail } from "../lib/email";
import { buildReportPdfBuffer, buildReportDocxBuffer } from "../lib/report_export";

const router = Router();

function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

router.get("/aggregate", requireAuth, async (req: any, res) => {
  const { weekOf } = req.query;
  if (!weekOf) return res.status(400).json({ error: "weekOf required" });

  const entries = await db.select({
    entry: entriesTable,
    user: usersTable,
  }).from(entriesTable)
    .leftJoin(usersTable, eq(entriesTable.userId, usersTable.id))
    .where(eq(entriesTable.weekOf, weekOf as string));

  const risks = await db.select().from(risksTable).where(eq(risksTable.status, "open"));

  const byRole: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalTickets = 0;
  const contributors = new Set<number>();

  for (const { entry, user } of entries) {
    const role = user?.role ?? "unknown";
    byRole[role] = (byRole[role] ?? 0) + 1;
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
    totalTickets += entry.ticketCount ?? 0;
    contributors.add(entry.userId);
  }

  const enrichedEntries = entries.map(({ entry, user }) => ({
    ...entry,
    userName: user?.name ?? "Unknown",
    userRole: user?.role ?? "unknown",
  }));

  const enrichedRisks = await Promise.all(risks.map(async (r) => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, r.userId));
    return { ...r, userName: user?.name ?? "Unknown" };
  }));

  return res.json({
    weekOf,
    totalEntries: entries.length,
    contributorCount: contributors.size,
    byRole,
    byCategory,
    totalTickets,
    openRisks: risks.length,
    entrySummaries: enrichedEntries,
    risks: enrichedRisks,
  });
});

router.get("/", requireAuth, async (req: any, res) => {
  const { status } = req.query;
  let reports;
  if (status) {
    reports = await db.select().from(reportsTable).where(eq(reportsTable.status, status as string)).orderBy(desc(reportsTable.createdAt));
  } else {
    reports = await db.select().from(reportsTable).orderBy(desc(reportsTable.createdAt));
  }
  const enriched = await Promise.all(reports.map(async (r) => {
    let createdByName = "Unknown";
    if (r.createdBy) {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, r.createdBy));
      createdByName = user?.name ?? "Unknown";
    }
    return { ...r, createdByName };
  }));
  return res.json(enriched);
});

router.post("/", requireAuth, requireCIO, async (req: any, res) => {
  const schema = z.object({
    weekOf: z.string(),
    title: z.string().optional(),
    summary: z.string().optional(),
    accomplishments: z.string().optional(),
    challenges: z.string().optional(),
    strategicProgress: z.string().optional(),
    nextWeekPlans: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [report] = await db.insert(reportsTable).values({
    ...parsed.data,
    createdBy: req.user.id,
  }).returning();
  return res.status(201).json({ ...report, createdByName: req.user.name });
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) return res.status(404).json({ error: "Not found" });
  let createdByName = "Unknown";
  if (report.createdBy) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, report.createdBy));
    createdByName = user?.name ?? "Unknown";
  }
  return res.json({ ...report, createdByName });
});

// All Zendesk-resolved tickets during this report's week (group-wide)
router.get("/:id/tickets", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) return res.status(404).json({ error: "Not found" });

  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const token = process.env.ZENDESK_API_TOKEN;
  if (!subdomain || !email || !token) {
    return res.json({ weekOf: report.weekOf, count: 0, tickets: [], configured: false });
  }
  const auth = Buffer.from(`${email}/token:${token}`).toString("base64");
  const group = process.env.ZENDESK_GROUP || "Onsite_it";

  // Build a 7-day date set starting at weekOf
  const dateSet = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(report.weekOf + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    dateSet.add(d.toISOString().slice(0, 10));
  }
  const earliest = Array.from(dateSet).sort()[0];
  const dayBefore = new Date(new Date(earliest).getTime() - 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  try {
    const all: any[] = [];
    let nextUrl: string | null =
      `https://${subdomain}.zendesk.com/api/v2/search.json?query=${encodeURIComponent(
        `type:ticket solved>${dayBefore} group:"${group}"`
      )}&per_page=100`;
    let pages = 0;
    while (nextUrl && pages < 10) {
      const r = await fetch(nextUrl, {
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      });
      if (!r.ok) break;
      const data: any = await r.json();
      all.push(...(data.results ?? []));
      nextUrl = data.next_page ?? null;
      pages++;
    }

    const onWeek = all.filter((t) => dateSet.has((t.updated_at || "").slice(0, 10)));

    // Resolve assignee names
    const ids = Array.from(new Set(onWeek.map((t) => t.assignee_id).filter(Boolean)));
    const userMap = new Map<number, string>();
    if (ids.length > 0) {
      const r = await fetch(
        `https://${subdomain}.zendesk.com/api/v2/users/show_many.json?ids=${ids.join(",")}`,
        { headers: { Authorization: `Basic ${auth}` } },
      );
      if (r.ok) {
        const data: any = await r.json();
        for (const u of data.users ?? []) userMap.set(u.id, u.name);
      }
    }

    return res.json({
      weekOf: report.weekOf,
      count: onWeek.length,
      configured: true,
      tickets: onWeek.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        assigneeName: t.assignee_id ? userMap.get(t.assignee_id) ?? null : null,
        updatedAt: t.updated_at,
        url: `https://${subdomain}.zendesk.com/agent/tickets/${t.id}`,
      })),
    });
  } catch (e: any) {
    return res.status(502).json({ error: "Zendesk API error", message: e.message });
  }
});

router.delete("/:id", requireAuth, requireCIO, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [deleted] = await db.delete(reportsTable).where(eq(reportsTable.id, id)).returning();
  if (!deleted) return res.status(404).json({ error: "Not found" });
  return res.json({ success: true });
});

router.patch("/:id", requireAuth, requireCIO, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const schema = z.object({
    title: z.string().optional(),
    summary: z.string().optional(),
    accomplishments: z.string().optional(),
    challenges: z.string().optional(),
    strategicProgress: z.string().optional(),
    nextWeekPlans: z.string().optional(),
    status: z.enum(["draft", "finalized"]).optional(),
    selectedItemIds: z.array(z.number()).nullable().optional(),
    customTasks: z.array(z.object({
      title: z.string().min(1),
      userName: z.string().optional(),
    })).optional(),
    projectIds: z.array(z.number()).optional(),
    selectedAfterActionIds: z.array(z.number()).nullable().optional(),
    selectedMaintenanceIds: z.array(z.string()).nullable().optional(),
    selectedRiskIds: z.array(z.number()).nullable().optional(),
    includeGoalProgress: z.boolean().optional(),
    includeOpenRisks: z.boolean().optional(),
    emailRecipients: z.array(z.string().email()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const [report] = await db.update(reportsTable).set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(reportsTable.id, id)).returning();
  if (!report) return res.status(404).json({ error: "Not found" });
  return res.json(report);
});

// Supplemental data for the report editor:
//   - afterActionReports: PIRs that occurred (or were resolved/created) within the report week
//   - maintenance: network maintenance windows scheduled/logged within the report week
//     (included if createdAt OR windowStart OR windowEnd falls in week — OR semantics)
//   - goalProgress: WEEK-SCOPED deltas for department goals derived from the report's linked
//     projects (or all projects if the report has no projectIds). Per project: progress at
//     week start (last progressLog entry on or before weekStart, or 0) vs current progress.
// Available to any authenticated viewer so non-CIO recipients also see the report's
// PIR / maintenance / goal-progress cards (the underlying data is otherwise readable
// via its own list endpoints).
router.get("/:id/extras", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) return res.status(404).json({ error: "Not found" });

  const weekStart = new Date(report.weekOf + "T00:00:00Z");
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  // PIRs (after-action reports) created or resolved in this week
  const allAars = await db.select().from(afterActionReportsTable);
  const inWeek = (d: Date | null | undefined) => {
    if (!d) return false;
    const t = d.getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  };
  const aars = allAars.filter(
    (a) => inWeek(a.incidentDate) || inWeek(a.resolvedAt) || inWeek(a.createdAt),
  );
  const aarUsers = aars.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, [...new Set(aars.map((a) => a.userId))]))
    : [];
  const aarUserMap = new Map(aarUsers.map((u) => [u.id, u.name]));
  const enrichedAars = aars.map((a) => ({
    id: a.id,
    title: a.title,
    severity: a.severity,
    status: a.status,
    building: a.building,
    incidentDate: a.incidentDate?.toISOString() ?? null,
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    authorName: aarUserMap.get(a.userId) ?? "Unknown",
    incident: a.incident,
    resolution: a.resolution,
  }));

  // Network maintenance windows in this week (switches + VLANs)
  const [switches, vlans] = await Promise.all([
    db.select().from(networkSwitchesTable),
    db.select().from(vlansTable),
  ]);
  type MaintRow = {
    id: string;
    source: "switch" | "vlan";
    body: string;
    authorName: string;
    createdAt: string;
    windowStart?: string | null;
    windowEnd?: string | null;
    // Switch-sourced fields (present when source === "switch")
    switchHostname?: string;
    switchBuilding?: string;
    switchId?: number;
    // VLAN-sourced fields (present when source === "vlan")
    vlanId?: number;
    vlanName?: string;
    vlanBuilding?: string;
    vlanRowId?: number;
  };
  const maintenance: MaintRow[] = [];
  const inWeekDateStr = (s?: string | null) => {
    if (!s) return false;
    const d = s.slice(0, 10);
    return d >= weekStartStr && d < weekEndStr;
  };
  // OR semantics: include if any of createdAt, windowStart, or windowEnd falls in the week
  const logInWeek = (log: { createdAt: string; windowStart?: string | null; windowEnd?: string | null }) =>
    inWeekDateStr(log.createdAt) || inWeekDateStr(log.windowStart) || inWeekDateStr(log.windowEnd);
  for (const sw of switches) {
    for (const log of sw.maintenanceLog ?? []) {
      if (log.deletedAt) continue;
      if (logInWeek(log)) {
        maintenance.push({
          id: log.id,
          source: "switch",
          body: log.body,
          authorName: log.authorName,
          createdAt: log.createdAt,
          windowStart: log.windowStart ?? null,
          windowEnd: log.windowEnd ?? null,
          switchHostname: sw.hostname,
          switchBuilding: sw.building,
          switchId: sw.id,
        });
      }
    }
  }
  for (const vlan of vlans) {
    for (const log of vlan.maintenanceLog ?? []) {
      if (log.deletedAt) continue;
      if (logInWeek(log)) {
        maintenance.push({
          id: log.id,
          source: "vlan",
          body: log.body,
          authorName: log.authorName,
          createdAt: log.createdAt,
          windowStart: log.windowStart ?? null,
          windowEnd: log.windowEnd ?? null,
          vlanId: vlan.vlanId,
          vlanName: vlan.name,
          vlanBuilding: vlan.building,
          vlanRowId: vlan.id,
        });
      }
    }
  }
  maintenance.sort((a, b) => (a.windowStart || a.createdAt).localeCompare(b.windowStart || b.createdAt));

  // Goal progress — week-scoped deltas, restricted to report-linked projects when present.
  const allObjectives = await db.select().from(strategicObjectivesTable);
  const allProjects = await db.select().from(projectsTable);
  const reportProjectIds = Array.isArray(report.projectIds) ? (report.projectIds as number[]) : [];
  const projectScope = reportProjectIds.length > 0
    ? allProjects.filter((p) => reportProjectIds.includes(p.id))
    : allProjects;
  const projectWeekDelta = (p: typeof allProjects[number]) => {
    const log = Array.isArray(p.progressLog)
      ? (p.progressLog as { date: string; value: number }[])
      : [];
    const sorted = [...log].sort((a, b) => a.date.localeCompare(b.date));
    const weekStartIso = weekStart.toISOString();
    const weekEndIso = weekEnd.toISOString();
    // Both START and END derive from progressLog snapshots so historical reports stay
    // accurate over time (END must be the value as of weekEnd, NOT the current value).
    // If no log entries exist at all, fall back to current progress for both -> delta 0.
    let startVal: number | null = null;
    let endVal: number | null = null;
    for (const e of sorted) {
      if (e.date <= weekStartIso) startVal = e.value;
      if (e.date <= weekEndIso) endVal = e.value;
      else break;
    }
    if (sorted.length === 0) {
      const cur = p.progress ?? 0;
      return { startVal: cur, endVal: cur, delta: 0 };
    }
    const s = startVal ?? 0;
    const e = endVal ?? s;
    return { startVal: s, endVal: e, delta: e - s };
  };
  const goalProgress = allObjectives
    .filter((o) => o.status !== "archived")
    .map((o) => {
      const linked = projectScope.filter((p) =>
        Array.isArray(p.strategicObjectiveIds) && (p.strategicObjectiveIds as number[]).includes(o.id),
      );
      const active = linked.filter((p) => p.status !== "completed" && p.status !== "cancelled");
      const avgProgress = linked.length > 0
        ? Math.round(linked.reduce((s, p) => s + (p.progress ?? 0), 0) / linked.length)
        : 0;
      const projectsWithDelta = linked.map((p) => {
        const d = projectWeekDelta(p);
        return {
          id: p.id,
          title: p.title,
          status: p.status,
          progress: p.progress ?? 0,
          weekStartProgress: d.startVal,
          weekDelta: d.delta,
        };
      });
      const sumWeekDelta = projectsWithDelta.reduce((s, p) => s + p.weekDelta, 0);
      const avgWeekDelta = projectsWithDelta.length > 0
        ? Math.round(sumWeekDelta / projectsWithDelta.length)
        : 0;
      return {
        id: o.id,
        title: o.title,
        status: o.status,
        projectCount: linked.length,
        activeProjectCount: active.length,
        avgProgress,
        avgWeekDelta,
        sumWeekDelta,
        projects: projectsWithDelta,
      };
    })
    .filter((g) => g.projectCount > 0);

  return res.json({
    weekOf: report.weekOf,
    weekStart: weekStartStr,
    weekEnd: weekEndStr,
    afterActionReports: enrichedAars,
    maintenance,
    goalProgress,
  });
});

// Email the report (PDF attached) to recipients
router.post("/:id/email", requireAuth, requireCIO, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const schema = z.object({
    recipients: z.array(z.string().email()).min(1),
    subject: z.string().optional(),
    message: z.string().optional(),
    format: z.enum(["pdf", "docx"]).default("pdf"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });

  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) return res.status(404).json({ error: "Not found" });

  let attachment: { filename: string; content: Buffer; contentType: string };
  try {
    if (parsed.data.format === "docx") {
      const buf = await buildReportDocxBuffer(report);
      attachment = {
        filename: `it-report-${report.weekOf}.docx`,
        content: buf,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    } else {
      const buf = await buildReportPdfBuffer(report);
      attachment = {
        filename: `it-report-${report.weekOf}.pdf`,
        content: buf,
        contentType: "application/pdf",
      };
    }
  } catch (e: any) {
    return res.status(500).json({ error: "Could not build report file", message: e?.message });
  }

  try {
    const subject = parsed.data.subject ||
      `IT Department Weekly Report — Week of ${report.weekOf}`;
    const intro = parsed.data.message ||
      `Attached is the SCCC IT Department weekly report for the week of ${report.weekOf}.`;
    const html = `<p>${intro.replace(/\n/g, "<br>")}</p><p style="color:#888;font-size:12px">Sent by ${req.user.name} via SCCC IT Reporting Platform.</p>`;
    const text = `${intro}\n\nSent by ${req.user.name} via SCCC IT Reporting Platform.`;
    await sendReportEmail({
      to: parsed.data.recipients,
      subject,
      text,
      html,
      attachments: [attachment],
    });

    await db.update(reportsTable).set({
      emailRecipients: parsed.data.recipients,
      lastEmailedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(reportsTable.id, id));

    return res.json({
      sent: true,
      recipients: parsed.data.recipients,
      filename: attachment.filename,
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.includes("EMAIL_NOT_CONFIGURED")) {
      return res.status(503).json({
        error: "Email not configured",
        message:
          "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM environment variables to enable sending email.",
      });
    }
    return res.status(502).json({ error: "Email send failed", message: msg });
  }
});

router.post("/:id/finalize", requireAuth, requireCIO, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) return res.status(404).json({ error: "Not found" });

  const entries = await db.select().from(entriesTable).where(eq(entriesTable.weekOf, report.weekOf));
  const contributors = new Set(entries.map(e => e.userId));
  let totalTickets = entries.reduce((sum, e) => sum + (e.ticketCount ?? 0), 0);

  const [updated] = await db.update(reportsTable).set({
    status: "finalized",
    finalizedAt: new Date(),
    contributorCount: contributors.size,
    entryCount: entries.length,
    updatedAt: new Date(),
  }).where(eq(reportsTable.id, id)).returning();

  let createdByName = "Unknown";
  if (updated.createdBy) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.createdBy));
    createdByName = user?.name ?? "Unknown";
  }
  return res.json({ ...updated, createdByName });
});

export default router;
