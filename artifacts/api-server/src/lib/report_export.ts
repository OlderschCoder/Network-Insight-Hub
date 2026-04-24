import {
  db,
  reportsTable,
  entriesTable,
  risksTable,
  usersTable,
  logItemsTable,
  afterActionReportsTable,
  networkSwitchesTable,
  strategicObjectivesTable,
  projectsTable,
  type Report,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { streamPdf, type PdfSection } from "./pdf";

export type ReportExportData = {
  report: Report;
  weekStartStr: string;
  weekEndStr: string;
  entries: any[];
  userMap: Record<number, any>;
  logItems: any[];
  selectedLogItems: any[];
  customTasks: { title: string; userName?: string }[];
  ticketsByUser: Map<string, number>;
  unassignedTickets: number;
  totalClosedTickets: number;
  ticketsConfigured: boolean;
  linkedProjects: any[];
  selectedAars: any[];
  selectedMaintenance: any[];
  goalProgress: Array<{
    id: number;
    title: string;
    status: string;
    projectCount: number;
    activeProjectCount: number;
    avgProgress: number;
    avgWeekDelta: number;
    sumWeekDelta: number;
    projects: {
      id: number;
      title: string;
      status: string;
      progress: number;
      weekStartProgress: number;
      weekDelta: number;
    }[];
  }>;
  openRisks: any[];
};

async function fetchClosedTicketsForWeek(weekOf: string): Promise<{
  configured: boolean;
  byUser: Map<string, number>;
  unassigned: number;
  total: number;
}> {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const token = process.env.ZENDESK_API_TOKEN;
  if (!subdomain || !email || !token) {
    return { configured: false, byUser: new Map(), unassigned: 0, total: 0 };
  }
  const auth = Buffer.from(`${email}/token:${token}`).toString("base64");
  const group = process.env.ZENDESK_GROUP || "Onsite_it";

  const dateSet = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekOf + "T00:00:00Z");
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
        `type:ticket solved>${dayBefore} group:"${group}"`,
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
    const byUser = new Map<string, number>();
    let unassigned = 0;
    for (const t of onWeek) {
      const name = t.assignee_id ? userMap.get(t.assignee_id) : null;
      if (!name) unassigned++;
      else byUser.set(name, (byUser.get(name) ?? 0) + 1);
    }
    return { configured: true, byUser, unassigned, total: onWeek.length };
  } catch {
    return { configured: true, byUser: new Map(), unassigned: 0, total: 0 };
  }
}

export async function gatherReportExportData(report: Report): Promise<ReportExportData> {
  const weekStart = new Date(report.weekOf + "T00:00:00Z");
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const entries = await db.select().from(entriesTable).where(eq(entriesTable.weekOf, report.weekOf));
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const users = userIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  // Log items for this week
  const logItems = await db.select().from(logItemsTable).where(eq(logItemsTable.weekOf, report.weekOf));
  // Enrich with user names
  const logUserIds = [...new Set(logItems.map((i) => i.userId))];
  const logUsers = logUserIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, logUserIds))
    : [];
  const logUserMap = new Map(logUsers.map((u) => [u.id, u.name]));
  const enrichedItems = logItems.map((i) => ({ ...i, userName: logUserMap.get(i.userId) ?? "Unknown" }));

  const allItemIds = enrichedItems.map((i) => i.id);
  const selIds = report.selectedItemIds == null ? allItemIds : report.selectedItemIds;
  const selectedLogItems = enrichedItems.filter((i) => selIds.includes(i.id));
  const customTasks = (report.customTasks ?? []) as { title: string; userName?: string }[];

  // Linked projects
  const projectIds = (report.projectIds ?? []) as number[];
  const linkedProjects = projectIds.length > 0
    ? await db.select().from(projectsTable).where(inArray(projectsTable.id, projectIds))
    : [];

  // Tickets
  const tickets = await fetchClosedTicketsForWeek(report.weekOf);

  // PIRs (after-action reports) in the week
  const allAars = await db.select().from(afterActionReportsTable);
  const inWeek = (d: Date | null | undefined) => {
    if (!d) return false;
    const t = d.getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  };
  const weekAars = allAars.filter(
    (a) => inWeek(a.incidentDate) || inWeek(a.resolvedAt) || inWeek(a.createdAt),
  );
  const aarUsers = weekAars.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, [...new Set(weekAars.map((a) => a.userId))]))
    : [];
  const aarUserMap = new Map(aarUsers.map((u) => [u.id, u.name]));
  const allWeekAars = weekAars.map((a) => ({
    ...a,
    authorName: aarUserMap.get(a.userId) ?? "Unknown",
  }));
  const selAarIds = report.selectedAfterActionIds == null
    ? allWeekAars.map((a) => a.id)
    : report.selectedAfterActionIds;
  const selectedAars = allWeekAars.filter((a) => selAarIds.includes(a.id));

  // Maintenance windows in the week — OR semantics on createdAt / windowStart / windowEnd.
  const switches = await db.select().from(networkSwitchesTable);
  type MaintLog = NonNullable<typeof switches[number]["maintenanceLog"]>[number];
  type EnrichedMaint = MaintLog & {
    switchHostname: string;
    switchBuilding: string;
    switchId: number;
  };
  const allMaint: EnrichedMaint[] = [];
  const inWeekDateStr = (s?: string | null) => {
    if (!s) return false;
    const d = s.slice(0, 10);
    return d >= weekStartStr && d < weekEndStr;
  };
  for (const sw of switches) {
    for (const log of sw.maintenanceLog ?? []) {
      if (
        inWeekDateStr(log.createdAt) ||
        inWeekDateStr(log.windowStart) ||
        inWeekDateStr(log.windowEnd)
      ) {
        allMaint.push({
          ...log,
          switchHostname: sw.hostname,
          switchBuilding: sw.building,
          switchId: sw.id,
        });
      }
    }
  }
  allMaint.sort((a, b) => (a.windowStart || a.createdAt).localeCompare(b.windowStart || b.createdAt));
  const selMaintIds = report.selectedMaintenanceIds == null
    ? allMaint.map((m) => m.id)
    : report.selectedMaintenanceIds;
  const selectedMaintenance = allMaint.filter((m) => selMaintIds.includes(m.id));

  // Goal progress — week-scoped deltas computed from project progressLog.
  // For each project: progressAtWeekStart = last log entry on/before weekStart (or 0 if none),
  // progressAtWeekEnd = current progress value. Delta = end - start.
  const allObjectives = await db.select().from(strategicObjectivesTable);
  const allProjectsForGoals = await db.select().from(projectsTable);
  // Scope goal progress to the report's linked projects when present so the report's
  // Goal Progress section reflects only what's surfaced in the report itself.
  const reportProjectIds = Array.isArray(report.projectIds) ? (report.projectIds as number[]) : [];
  const projectScope = reportProjectIds.length > 0
    ? allProjectsForGoals.filter((p) => reportProjectIds.includes(p.id))
    : allProjectsForGoals;
  const weekStartIso = new Date(weekStartStr + "T00:00:00.000Z").toISOString();
  const weekEndIso = new Date(weekEndStr + "T00:00:00.000Z").toISOString();
  function projectWeekDelta(p: typeof allProjectsForGoals[number]) {
    const log = Array.isArray(p.progressLog) ? (p.progressLog as { date: string; value: number }[]) : [];
    const sorted = [...log].sort((a, b) => a.date.localeCompare(b.date));
    // Both START and END derive from progressLog snapshots so historical reports stay
    // accurate over time. END must be the value as of weekEnd, NOT current progress.
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
  }
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
          id: p.id, title: p.title, status: p.status ?? "",
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
    });

  // Open risks
  const openRisks = await db.select().from(risksTable).where(eq(risksTable.status, "open"));

  return {
    report,
    weekStartStr,
    weekEndStr,
    entries,
    userMap,
    logItems: enrichedItems,
    selectedLogItems,
    customTasks,
    ticketsByUser: tickets.byUser,
    unassignedTickets: tickets.unassigned,
    totalClosedTickets: tickets.total,
    ticketsConfigured: tickets.configured,
    linkedProjects,
    selectedAars,
    selectedMaintenance,
    goalProgress,
    openRisks,
  };
}

// ---- DOCX builder ----------------------------------------------------------

export async function buildReportDocxBuffer(report: Report): Promise<Buffer> {
  const data = await gatherReportExportData(report);
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

  const children: any[] = [];
  const h1 = (text: string) => children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1 }));
  const h2 = (text: string) => children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_2 }));
  const h3 = (text: string) => children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_3 }));
  const p = (text: string) => children.push(new Paragraph({ text }));
  const bullet = (text: string) => children.push(new Paragraph({ text, bullet: { level: 0 } }));
  const blank = () => children.push(new Paragraph({ text: "" }));

  h1(`IT Department Weekly Report — ${report.weekOf}`);
  children.push(new Paragraph({
    children: [new TextRun({ text: `Status: ${report.status.toUpperCase()}`, bold: true })],
  }));
  blank();

  if (report.summary) { h2("Executive Summary"); p(report.summary); blank(); }
  if (report.accomplishments) { h2("Accomplishments"); p(report.accomplishments); blank(); }
  if (report.challenges) { h2("Challenges"); p(report.challenges); blank(); }
  if (report.strategicProgress) { h2("Strategic Progress"); p(report.strategicProgress); blank(); }
  if (report.nextWeekPlans) { h2("Plans for Next Week"); p(report.nextWeekPlans); blank(); }

  // Tasks Completed
  if (data.selectedLogItems.length > 0) {
    h2(`Tasks Completed (${data.selectedLogItems.length})`);
    const grouped = new Map<string, typeof data.selectedLogItems>();
    for (const it of data.selectedLogItems) {
      const k = it.userName || "Unknown";
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(it);
    }
    for (const [name, items] of grouped) {
      h3(name);
      for (const it of items) {
        bullet(`${it.title}${it.notes ? ` — ${it.notes}` : ""}`);
      }
    }
    blank();
  }

  // Additional Tasks
  if (data.customTasks.length > 0) {
    h2(`Additional Tasks (${data.customTasks.length})`);
    for (const t of data.customTasks) {
      bullet(`${t.title}${t.userName ? ` — ${t.userName}` : ""}`);
    }
    blank();
  }

  // Closed Helpdesk Tickets
  if (data.ticketsConfigured && data.totalClosedTickets > 0) {
    h2(`Closed Helpdesk Tickets (${data.totalClosedTickets})`);
    const rows = Array.from(data.ticketsByUser.entries()).sort((a, b) => b[1] - a[1]);
    for (const [name, n] of rows) bullet(`${name}: ${n} ticket${n === 1 ? "" : "s"}`);
    if (data.unassignedTickets > 0) bullet(`Unassigned: ${data.unassignedTickets}`);
    blank();
  }

  // Linked Projects
  if (data.linkedProjects.length > 0) {
    h2(`Projects in this Report (${data.linkedProjects.length})`);
    for (const proj of data.linkedProjects) {
      h3(`${proj.title} — ${proj.status}, ${proj.progress ?? 0}%`);
      if (proj.description) p(proj.description);
      if (proj.targetDate) p(`Target: ${proj.targetDate}`);
      if (proj.newEstimatedDate) p(`New estimated: ${proj.newEstimatedDate}`);
    }
    blank();
  }

  // Post-Incident Reviews
  if (data.selectedAars.length > 0) {
    h2(`Post-Incident Reviews (${data.selectedAars.length})`);
    for (const a of data.selectedAars) {
      h3(`[${(a.severity ?? "").toUpperCase()}] ${a.title}`);
      p(`Author: ${a.authorName} · Status: ${a.status}${a.building ? ` · Building: ${a.building}` : ""}`);
      if (a.incident) p(a.incident);
      if (a.resolution) p(`Resolution: ${a.resolution}`);
      if (a.lessonsLearned) p(`Lessons learned: ${a.lessonsLearned}`);
    }
    blank();
  }

  // Network Maintenance
  if (data.selectedMaintenance.length > 0) {
    h2(`Network Maintenance (${data.selectedMaintenance.length})`);
    for (const m of data.selectedMaintenance) {
      const when = m.windowStart
        ? `${m.windowStart}${m.windowEnd ? ` → ${m.windowEnd}` : ""}`
        : (m.createdAt ?? "").slice(0, 16).replace("T", " ");
      h3(`${m.switchHostname} (${m.switchBuilding}) — ${when}`);
      p(`By ${m.authorName}`);
      if (m.body) p(m.body);
    }
    blank();
  }

  // Goal Progress (week-scoped delta)
  if (report.includeGoalProgress && data.goalProgress.length > 0) {
    h2("Department Goals — Progress this week");
    for (const g of data.goalProgress) {
      const sign = g.sumWeekDelta > 0 ? "+" : "";
      bullet(
        `${g.title} — ${g.activeProjectCount} active project${g.activeProjectCount === 1 ? "" : "s"}, ` +
        `avg progress ${g.avgProgress}% (${sign}${g.avgWeekDelta}% this week, total ${sign}${g.sumWeekDelta} pts)`,
      );
      for (const proj of g.projects) {
        if (proj.weekDelta !== 0) {
          const ps = proj.weekDelta > 0 ? "+" : "";
          p(`    • ${proj.title}: ${proj.weekStartProgress}% → ${proj.progress}% (${ps}${proj.weekDelta}%)`);
        }
      }
    }
    blank();
  }

  // Open Risks
  if (report.includeOpenRisks && data.openRisks.length > 0) {
    h2(`Open Risks & Issues (${data.openRisks.length})`);
    for (const r of data.openRisks) {
      bullet(`[${(r.severity ?? "").toUpperCase()}] ${r.title}${r.relatedBuilding ? ` — ${r.relatedBuilding}` : ""}`);
    }
    blank();
  }

  // Team Entries
  h2("Team Weekly Logs");
  for (const entry of data.entries) {
    h3(entry.title);
    p(`By: ${data.userMap[entry.userId]?.name ?? "Unknown"} · Category: ${entry.category}`);
    if (entry.description) p(entry.description);
    if (entry.accomplishments) p(`Accomplishments: ${entry.accomplishments}`);
    if (entry.challenges) p(`Challenges: ${entry.challenges}`);
    blank();
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// ---- PDF builder -----------------------------------------------------------

export function buildReportPdfSections(data: ReportExportData): PdfSection[] {
  const { report } = data;
  const sections: PdfSection[] = [];
  sections.push({ kind: "kv", label: "Status", value: report.status.toUpperCase() });
  sections.push({ kind: "kv", label: "Total weekly logs", value: String(data.entries.length) });
  sections.push({ kind: "kv", label: "Tasks logged this week", value: String(data.logItems.length) });
  if (data.ticketsConfigured) {
    sections.push({ kind: "kv", label: "Tickets resolved", value: String(data.totalClosedTickets) });
  }

  if (report.summary) {
    sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: "Executive Summary" }, { kind: "paragraph", text: report.summary });
  }
  if (report.accomplishments) {
    sections.push({ kind: "heading", level: 2, text: "Accomplishments" }, { kind: "paragraph", text: report.accomplishments });
  }
  if (report.challenges) {
    sections.push({ kind: "heading", level: 2, text: "Challenges" }, { kind: "paragraph", text: report.challenges });
  }
  if (report.strategicProgress) {
    sections.push({ kind: "heading", level: 2, text: "Strategic Progress" }, { kind: "paragraph", text: report.strategicProgress });
  }
  if (report.nextWeekPlans) {
    sections.push({ kind: "heading", level: 2, text: "Plans for Next Week" }, { kind: "paragraph", text: report.nextWeekPlans });
  }

  if (data.selectedLogItems.length > 0) {
    sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: `Tasks Completed (${data.selectedLogItems.length})` });
    const grouped = new Map<string, typeof data.selectedLogItems>();
    for (const it of data.selectedLogItems) {
      const k = it.userName || "Unknown";
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(it);
    }
    for (const [name, items] of grouped) {
      sections.push({ kind: "heading", level: 3, text: name });
      for (const it of items) {
        sections.push({ kind: "bullet", text: `${it.title}${it.notes ? ` — ${it.notes}` : ""}` });
      }
    }
  }

  if (data.customTasks.length > 0) {
    sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: `Additional Tasks (${data.customTasks.length})` });
    for (const t of data.customTasks) {
      sections.push({ kind: "bullet", text: `${t.title}${t.userName ? ` — ${t.userName}` : ""}` });
    }
  }

  if (data.ticketsConfigured && data.totalClosedTickets > 0) {
    sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: `Closed Helpdesk Tickets (${data.totalClosedTickets})` });
    const rows = Array.from(data.ticketsByUser.entries()).sort((a, b) => b[1] - a[1]);
    for (const [name, n] of rows) sections.push({ kind: "bullet", text: `${name}: ${n} ticket${n === 1 ? "" : "s"}` });
    if (data.unassignedTickets > 0) sections.push({ kind: "bullet", text: `Unassigned: ${data.unassignedTickets}` });
  }

  if (data.linkedProjects.length > 0) {
    sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: `Projects in this Report (${data.linkedProjects.length})` });
    for (const proj of data.linkedProjects) {
      sections.push({ kind: "heading", level: 3, text: `${proj.title} — ${proj.status}, ${proj.progress ?? 0}%` });
      if (proj.description) sections.push({ kind: "paragraph", text: proj.description });
      if (proj.targetDate) sections.push({ kind: "kv", label: "Target", value: proj.targetDate });
      if (proj.newEstimatedDate) sections.push({ kind: "kv", label: "New estimated", value: proj.newEstimatedDate });
    }
  }

  if (data.selectedAars.length > 0) {
    sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: `Post-Incident Reviews (${data.selectedAars.length})` });
    for (const a of data.selectedAars) {
      sections.push({ kind: "heading", level: 3, text: `[${(a.severity ?? "").toUpperCase()}] ${a.title}` });
      sections.push({ kind: "kv", label: "Author", value: `${a.authorName} · Status: ${a.status}${a.building ? ` · Building: ${a.building}` : ""}` });
      if (a.incident) sections.push({ kind: "paragraph", text: a.incident });
      if (a.resolution) sections.push({ kind: "kv", label: "Resolution", value: a.resolution });
      if (a.lessonsLearned) sections.push({ kind: "kv", label: "Lessons learned", value: a.lessonsLearned });
    }
  }

  if (data.selectedMaintenance.length > 0) {
    sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: `Network Maintenance (${data.selectedMaintenance.length})` });
    for (const m of data.selectedMaintenance) {
      const when = m.windowStart
        ? `${m.windowStart}${m.windowEnd ? ` → ${m.windowEnd}` : ""}`
        : (m.createdAt ?? "").slice(0, 16).replace("T", " ");
      sections.push({ kind: "heading", level: 3, text: `${m.switchHostname} (${m.switchBuilding})` });
      sections.push({ kind: "kv", label: "When", value: when });
      sections.push({ kind: "kv", label: "By", value: m.authorName });
      if (m.body) sections.push({ kind: "paragraph", text: m.body });
    }
  }

  if (report.includeGoalProgress && data.goalProgress.length > 0) {
    sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: "Department Goals — Progress this week" });
    for (const g of data.goalProgress) {
      const sign = g.sumWeekDelta > 0 ? "+" : "";
      sections.push({
        kind: "bullet",
        text:
          `${g.title} — ${g.activeProjectCount} active project${g.activeProjectCount === 1 ? "" : "s"}, ` +
          `avg progress ${g.avgProgress}% (${sign}${g.avgWeekDelta}% this week, total ${sign}${g.sumWeekDelta} pts)`,
      });
      for (const proj of g.projects) {
        if (proj.weekDelta !== 0) {
          const ps = proj.weekDelta > 0 ? "+" : "";
          sections.push({
            kind: "paragraph",
            text: `    ${proj.title}: ${proj.weekStartProgress}% → ${proj.progress}% (${ps}${proj.weekDelta}%)`,
          });
        }
      }
    }
  }

  if (report.includeOpenRisks && data.openRisks.length > 0) {
    sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: `Open Risks & Issues (${data.openRisks.length})` });
    for (const r of data.openRisks) {
      sections.push({ kind: "bullet", text: `[${(r.severity ?? "").toUpperCase()}] ${r.title}${r.relatedBuilding ? ` — ${r.relatedBuilding}` : ""}` });
    }
  }

  sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: "Team Weekly Logs" });
  if (data.entries.length === 0) {
    sections.push({ kind: "paragraph", text: "No entries logged for this week.", italic: true });
  }
  for (const entry of data.entries) {
    sections.push({ kind: "heading", level: 3, text: entry.title });
    sections.push({ kind: "kv", label: "By", value: `${data.userMap[entry.userId]?.name ?? "Unknown"} · Category: ${entry.category}` });
    if (entry.description) sections.push({ kind: "paragraph", text: entry.description });
    if (entry.accomplishments) sections.push({ kind: "kv", label: "Accomplishments", value: entry.accomplishments });
    if (entry.challenges) sections.push({ kind: "kv", label: "Challenges", value: entry.challenges });
    sections.push({ kind: "spacer" });
  }
  return sections;
}

export async function buildReportPdfBuffer(report: Report): Promise<Buffer> {
  const data = await gatherReportExportData(report);
  const sections = buildReportPdfSections(data);
  const { PassThrough } = await import("stream");
  const PDFDocument = (await import("pdfkit")).default;

  return await new Promise<Buffer>((resolve, reject) => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);

    try {
      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 60, bottom: 60, left: 60, right: 60 },
        bufferPages: true,
        info: { Title: `IT Department Weekly Report — ${report.weekOf}`, Producer: "SCCC IT Hub" },
      });
      doc.on("error", reject);
      doc.pipe(stream);

      const title = `IT Department Weekly Report — ${report.weekOf}`;
      doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text(title, { align: "left" });
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(11).fillColor("#475569").text("Seward County Community College — IT Department");
      doc.moveDown(0.5);
      doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor("#cbd5e1")
        .lineWidth(0.75)
        .stroke();
      doc.moveDown(0.6);

      for (const s of sections) {
        switch (s.kind) {
          case "heading": {
            const sizes = { 1: 16, 2: 13, 3: 12 } as const;
            doc.moveDown(0.4);
            doc.font("Helvetica-Bold").fontSize(sizes[s.level]).fillColor("#0f172a").text(s.text);
            doc.moveDown(0.2);
            break;
          }
          case "paragraph":
            doc.font(s.bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor("#0f172a")
              .text(s.text, { paragraphGap: 4 });
            break;
          case "kv":
            doc.font("Helvetica-Bold").fontSize(10).fillColor("#475569").text(`${s.label}: `, { continued: true });
            doc.font("Helvetica").fillColor("#0f172a").text(s.value, { paragraphGap: 2 });
            break;
          case "bullet":
            doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(`• ${s.text}`, { paragraphGap: 2 });
            break;
          case "spacer":
            doc.moveDown(0.4);
            break;
        }
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
