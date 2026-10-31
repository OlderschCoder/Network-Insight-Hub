import { Router } from "express";
import {
  db,
  reportsTable,
  entriesTable,
  risksTable,
  usersTable,
  afterActionReportsTable,
  processesTable,
  projectsTable,
  projectAssigneesTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";
import { z } from "zod";
import { streamPdf, type PdfSection } from "../lib/pdf";
import {
  gatherReportExportData,
  buildReportDocxBuffer,
  buildReportPdfSections,
} from "../lib/report_export";

const router = Router();

async function buildDocxBuffer(title: string, blocks: Array<{ heading?: string; level?: 1 | 2 | 3; text?: string; bullets?: string[] }>) {
  const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
  const headingMap = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
  };
  const children: any[] = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: "" }),
  ];
  for (const b of blocks) {
    if (b.heading) {
      children.push(
        new Paragraph({
          text: b.heading,
          heading: headingMap[b.level ?? 2],
        })
      );
    }
    if (b.text) {
      for (const line of b.text.split(/\n+/)) {
        children.push(new Paragraph({ text: line }));
      }
    }
    if (b.bullets) {
      for (const item of b.bullets) {
        children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
      }
    }
    children.push(new Paragraph({ text: "" }));
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

function sendDocx(res: any, buffer: Buffer, filename: string) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(buffer);
}

function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

router.get("/report/:id/docx", requireAuth, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
    if (!report) return res.status(404).json({ error: "Not found" });
    const buffer = await buildReportDocxBuffer(report);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="it-report-${report.weekOf}.docx"`);
    return res.send(buffer);
  } catch (err: any) {
    console.error("Report DOCX export failed:", err);
    return res.status(500).json({ error: "Export failed", message: err?.message });
  }
});

router.get("/report/:id/xlsx", requireAuth, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const ExcelJS = (await import("exceljs")).default;

    const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
    if (!report) return res.status(404).json({ error: "Not found" });

    const data = await gatherReportExportData(report);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SCCC IT Reporting Platform";
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet("Summary");
    summarySheet.addRow(["IT Department Weekly Report"]);
    summarySheet.addRow(["Week Of", report.weekOf]);
    summarySheet.addRow(["Status", report.status]);
    summarySheet.addRow(["Weekly Logs", data.entries.length]);
    summarySheet.addRow(["Tasks Completed (selected)", data.selectedLogItems.length]);
    summarySheet.addRow(["Additional Tasks", data.customTasks.length]);
    summarySheet.addRow(["Tickets Resolved", data.totalClosedTickets]);
    summarySheet.addRow(["Linked Projects", data.linkedProjects.length]);
    summarySheet.addRow(["Post-Incident Reviews", data.selectedAars.length]);
    summarySheet.addRow(["Network Maintenance Windows", data.selectedMaintenance.length]);
    if (report.includeOpenRisks) {
      summarySheet.addRow(["Open Risks", data.openRisks.length]);
    }
    summarySheet.addRow([]);
    if (report.summary) { summarySheet.addRow(["Summary"]); summarySheet.addRow([report.summary]); summarySheet.addRow([]); }
    if (report.accomplishments) { summarySheet.addRow(["Accomplishments"]); summarySheet.addRow([report.accomplishments]); summarySheet.addRow([]); }
    if (report.challenges) { summarySheet.addRow(["Challenges"]); summarySheet.addRow([report.challenges]); summarySheet.addRow([]); }
    if (report.strategicProgress) { summarySheet.addRow(["Strategic Progress"]); summarySheet.addRow([report.strategicProgress]); summarySheet.addRow([]); }
    if (report.nextWeekPlans) { summarySheet.addRow(["Plans for Next Week"]); summarySheet.addRow([report.nextWeekPlans]); }

    const entriesSheet = workbook.addWorksheet("Weekly Logs");
    entriesSheet.addRow(["ID", "User", "Category", "Title", "Description", "Accomplishments", "Challenges", "Tickets", "Submitted", "Date"]);
    for (const entry of data.entries) {
      entriesSheet.addRow([
        entry.id, data.userMap[entry.userId]?.name ?? "Unknown", entry.category, entry.title, entry.description,
        entry.accomplishments ?? "", entry.challenges ?? "",
        entry.ticketCount ?? 0, entry.isSubmitted ? "Yes" : "No", entry.createdAt.toISOString(),
      ]);
    }

    const tasksSheet = workbook.addWorksheet("Tasks");
    tasksSheet.addRow(["User", "Date", "Category", "Title", "Notes"]);
    for (const it of data.selectedLogItems) {
      tasksSheet.addRow([it.userName, it.itemDate, it.category, it.title, it.notes ?? ""]);
    }
    for (const t of data.customTasks) {
      tasksSheet.addRow([t.userName ?? "—", "—", "additional", t.title, ""]);
    }

    if (data.totalClosedTickets > 0) {
      const ticketsSheet = workbook.addWorksheet("Tickets Resolved");
      ticketsSheet.addRow(["Assignee", "Tickets Closed"]);
      const rows = Array.from(data.ticketsByUser.entries()).sort((a, b) => b[1] - a[1]);
      for (const [name, n] of rows) ticketsSheet.addRow([name, n]);
      if (data.unassignedTickets > 0) ticketsSheet.addRow(["Unassigned", data.unassignedTickets]);
    }

    if (data.linkedProjects.length > 0) {
      const projSheet = workbook.addWorksheet("Projects");
      projSheet.addRow(["ID", "Title", "Status", "Progress %", "Target Date", "New Estimated", "Description"]);
      for (const p of data.linkedProjects) {
        projSheet.addRow([p.id, p.title, p.status, p.progress ?? 0, p.targetDate ?? "", p.newEstimatedDate ?? "", p.description ?? ""]);
      }
    }

    if (data.selectedAars.length > 0) {
      const aarSheet = workbook.addWorksheet("Post-Incident Reviews");
      aarSheet.addRow([
        "ID", "Title", "Severity", "Status", "Author", "Building",
        "Incident Date", "Resolved",
        "Incident Summary", "Resolution", "Lessons Learned",
      ]);
      for (const a of data.selectedAars) {
        aarSheet.addRow([
          a.id, a.title, a.severity, a.status, a.authorName, a.building ?? "",
          a.incidentDate?.toISOString?.() ?? "",
          a.resolvedAt?.toISOString?.() ?? "",
          a.incident ?? "",
          a.resolution ?? "",
          a.lessonsLearned ?? "",
        ]);
      }
    }

    if (data.selectedMaintenance.length > 0) {
      const mSheet = workbook.addWorksheet("Network Maintenance");
      mSheet.addRow(["Switch", "Building", "Author", "Window Start", "Window End", "Logged", "Notes"]);
      for (const m of data.selectedMaintenance) {
        mSheet.addRow([m.switchHostname, m.switchBuilding, m.authorName, m.windowStart ?? "", m.windowEnd ?? "", m.createdAt, m.body]);
      }
    }

    if (report.includeGoalProgress && data.goalProgress.length > 0) {
      const gSheet = workbook.addWorksheet("Goal Progress");
      gSheet.addRow([
        "Goal",
        "Project",
        "Status",
        "Progress at Week Start %",
        "Progress Now %",
        "Week Delta %",
      ]);
      for (const g of data.goalProgress) {
        // Roll-up summary row per goal
        const sumSign = g.sumWeekDelta > 0 ? "+" : "";
        gSheet.addRow([
          g.title,
          `(${g.projectCount} project${g.projectCount === 1 ? "" : "s"}, ${g.activeProjectCount} active)`,
          "",
          "",
          `${g.avgProgress}% avg`,
          `${sumSign}${g.sumWeekDelta} (avg ${sumSign}${g.avgWeekDelta}%)`,
        ]);
        // Per-project breakdown so the workbook reflects week-scoped detail
        for (const p of g.projects) {
          const pSign = p.weekDelta > 0 ? "+" : "";
          gSheet.addRow([
            "",
            p.title,
            p.status,
            p.weekStartProgress,
            p.progress,
            `${pSign}${p.weekDelta}`,
          ]);
        }
      }
    }

    if (report.includeOpenRisks && data.openRisks.length > 0) {
      const risksSheet = workbook.addWorksheet("Open Risks");
      risksSheet.addRow(["ID", "Type", "Severity", "Status", "Title", "Description", "Impact", "Building", "Device"]);
      for (const risk of data.openRisks) {
        risksSheet.addRow([
          risk.id, risk.type, risk.severity, risk.status,
          risk.title, risk.description, risk.impact ?? "",
          risk.relatedBuilding ?? "", risk.relatedDevice ?? "",
        ]);
      }
    }

    if (report.includeCloudInventory) {
      const ci = data.cloudInventory;
      const ciSheet = workbook.addWorksheet("Cloud Inventory");
      ciSheet.addRow(["Azure VM Inventory Snapshot"]);
      ciSheet.addRow(["Total VMs", ci.total]);
      if (ci.lastSync) {
        ciSheet.addRow(["Last Sync", ci.lastSync.createdAt]);
        ciSheet.addRow(["Last Sync Status", ci.lastSync.status]);
        ciSheet.addRow(["Added / Changed / Removed", `${ci.lastSync.createdCount} / ${ci.lastSync.changedCount} / ${ci.lastSync.removedCount}`]);
        if (ci.lastSync.error) ciSheet.addRow(["Last Sync Error", ci.lastSync.error]);
      } else {
        ciSheet.addRow(["Last Sync", "never"]);
      }
      ciSheet.addRow([]);
      ciSheet.addRow(["Power State", "Count"]);
      for (const s of ci.byStatus) ciSheet.addRow([s.status, s.count]);
      ciSheet.addRow([]);
      ciSheet.addRow(["Risk Flag", "Count"]);
      ciSheet.addRow(["Public IP exposed", ci.risk.publicIp]);
      ciSheet.addRow(["Unhealthy state", ci.risk.unhealthy]);
      ciSheet.addRow(["Retiring VM series", ci.risk.retiringSize]);
      ciSheet.addRow(["VMs flagged", ci.risk.flaggedVms]);
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="it-report-${report.weekOf}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
    return;
  } catch (err: any) {
    console.error("Report XLSX export failed:", err);
    return res.status(500).json({ error: "Export failed", message: err?.message });
  }
});

router.get("/report/:id/pdf", requireAuth, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
    if (!report) return res.status(404).json({ error: "Not found" });
    const data = await gatherReportExportData(report);
    const sections = buildReportPdfSections(data);
    return streamPdf(res, {
      title: `IT Department Weekly Report — ${report.weekOf}`,
      subtitle: "Seward County Community College — IT Department",
      filename: `it-report-${report.weekOf}.pdf`,
      sections,
    });
  } catch (err: any) {
    console.error("Report PDF export failed:", err);
    return res.status(500).json({ error: "Export failed", message: err?.message });
  }
});

// ---- After-Action exports ----------------------------------------------------

async function loadAfterAction(id: number) {
  const [aar] = await db.select().from(afterActionReportsTable).where(eq(afterActionReportsTable.id, id));
  if (!aar) return null;
  let authorName = "Unknown";
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, aar.userId));
  if (u) authorName = u.name;
  return { aar, authorName };
}

function aarBlocks(aar: typeof afterActionReportsTable.$inferSelect, authorName: string) {
  const dateStr = aar.incidentDate ? new Date(aar.incidentDate).toLocaleString() : "—";
  return [
    { heading: "Incident", level: 2 as const, text: `${aar.title}\n\nAuthor: ${authorName}\nIncident date: ${dateStr}\nSeverity: ${aar.severity}\nStatus: ${aar.status}\nBuilding: ${aar.building ?? "—"}\nDevice type: ${aar.deviceType ?? "—"}` },
    { heading: "Incident description", level: 2 as const, text: aar.incident },
    ...(aar.affectedSystems ? [{ heading: "Affected systems", level: 2 as const, text: aar.affectedSystems }] : []),
    ...(aar.timeline ? [{ heading: "Timeline", level: 2 as const, text: aar.timeline }] : []),
    ...(aar.rootCause ? [{ heading: "Root cause", level: 2 as const, text: aar.rootCause }] : []),
    ...(aar.resolution ? [{ heading: "Resolution", level: 2 as const, text: aar.resolution }] : []),
    ...(aar.lessonsLearned ? [{ heading: "Lessons learned", level: 2 as const, text: aar.lessonsLearned }] : []),
    ...(aar.preventionMeasures ? [{ heading: "Prevention measures", level: 2 as const, text: aar.preventionMeasures }] : []),
  ];
}

router.get("/after-action/:id/docx", requireAuth, async (req: any, res) => {
  try {
    const loaded = await loadAfterAction(parseInt(req.params.id));
    if (!loaded) return res.status(404).json({ error: "Not found" });
    const buf = await buildDocxBuffer(`After-Action Report — ${loaded.aar.title}`, aarBlocks(loaded.aar, loaded.authorName));
    return sendDocx(res, buf, `after-action-${loaded.aar.id}.docx`);
  } catch (e) {
    return res.status(500).json({ error: "Export failed" });
  }
});

router.get("/after-action/:id/pdf", requireAuth, async (req: any, res) => {
  try {
    const loaded = await loadAfterAction(parseInt(req.params.id));
    if (!loaded) return res.status(404).json({ error: "Not found" });
    const aar = loaded.aar;
    const dateStr = aar.incidentDate ? new Date(aar.incidentDate).toLocaleString() : "—";
    const sections: PdfSection[] = [
      { kind: "kv", label: "Author", value: loaded.authorName },
      { kind: "kv", label: "Incident date", value: dateStr },
      { kind: "kv", label: "Severity", value: aar.severity },
      { kind: "kv", label: "Status", value: aar.status },
      { kind: "kv", label: "Building", value: aar.building ?? "—" },
      { kind: "kv", label: "Device type", value: aar.deviceType ?? "—" },
    ];
    const fields: Array<[string, string | null | undefined]> = [
      ["Incident description", aar.incident],
      ["Affected systems", aar.affectedSystems],
      ["Timeline", aar.timeline],
      ["Root cause", aar.rootCause],
      ["Resolution", aar.resolution],
      ["Lessons learned", aar.lessonsLearned],
      ["Prevention measures", aar.preventionMeasures],
    ];
    for (const [h, v] of fields) {
      if (v) {
        sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: h }, { kind: "paragraph", text: v });
      }
    }
    return streamPdf(res, {
      title: `After-Action Report — ${aar.title}`,
      subtitle: "Seward County Community College — IT Department",
      filename: `after-action-${aar.id}.pdf`,
      sections,
    });
  } catch (e) {
    return res.status(500).json({ error: "Export failed" });
  }
});

// ---- AI status report exports (stateless) -----------------------------------
const aiBodySchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().min(1),
  weekOf: z.string().optional(),
});

function markdownToBlocks(md: string) {
  const blocks: Array<{ heading?: string; level?: 1 | 2 | 3; text?: string; bullets?: string[] }> = [];
  const lines = md.split(/\r?\n/);
  let buf: string[] = [];
  let bullets: string[] = [];
  const flushBuf = () => {
    if (buf.length) {
      blocks.push({ text: buf.join("\n") });
      buf = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push({ bullets });
      bullets = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const b = /^[-*]\s+(.*)$/.exec(line);
    if (h) {
      flushBuf();
      flushBullets();
      blocks.push({ heading: h[2], level: h[1].length as 1 | 2 | 3 });
    } else if (b) {
      flushBuf();
      bullets.push(b[1]);
    } else if (!line.trim()) {
      flushBuf();
      flushBullets();
    } else {
      flushBullets();
      buf.push(line);
    }
  }
  flushBuf();
  flushBullets();
  return blocks;
}

function markdownToPdfSections(md: string): PdfSection[] {
  const sections: PdfSection[] = [];
  const lines = md.split(/\r?\n/);
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      sections.push({ kind: "paragraph", text: para.join(" ") });
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const b = /^[-*]\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      sections.push({ kind: "heading", level: h[1].length as 1 | 2 | 3, text: h[2] });
    } else if (b) {
      flushPara();
      sections.push({ kind: "bullet", text: b[1] });
    } else if (!line.trim()) {
      flushPara();
      sections.push({ kind: "spacer" });
    } else {
      para.push(line);
    }
  }
  flushPara();
  return sections;
}

router.post("/ai-status/docx", requireAuth, async (req, res) => {
  const parsed = aiBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const blocks = markdownToBlocks(parsed.data.content);
  const buf = await buildDocxBuffer(parsed.data.title, blocks);
  const slug = parsed.data.weekOf ?? "ai-status";
  return sendDocx(res, buf, `ai-status-${slug}.docx`);
});

router.post("/ai-status/pdf", requireAuth, async (req, res) => {
  const parsed = aiBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const sections = markdownToPdfSections(parsed.data.content);
  const slug = parsed.data.weekOf ?? "ai-status";
  return streamPdf(res, {
    title: parsed.data.title,
    subtitle: parsed.data.weekOf ? `Week of ${parsed.data.weekOf}` : undefined,
    filename: `ai-status-${slug}.pdf`,
    sections,
  });
});

// ---- Risk Register exports --------------------------------------------------

async function loadRisks(scope: "open" | "all") {
  const rows = await db.select().from(risksTable).orderBy(desc(risksTable.createdAt));
  return scope === "open" ? rows.filter(r => r.status !== "closed" && r.status !== "resolved") : rows;
}

function riskBlocks(risks: any[]) {
  const blocks: Array<{ heading?: string; level?: 1 | 2 | 3; text?: string; bullets?: string[] }> = [];
  blocks.push({ heading: "Summary", level: 2, text: `${risks.length} risk${risks.length === 1 ? "" : "s"} reported.` });
  for (const r of risks) {
    blocks.push({
      heading: `${(r.severity ?? "").toUpperCase()} — ${r.title}`,
      level: 3,
      text: [
        `Type: ${r.type ?? "—"}  ·  Status: ${r.status ?? "—"}`,
        r.relatedBuilding ? `Building: ${r.relatedBuilding}` : "",
        r.relatedDevice ? `Device: ${r.relatedDevice}` : "",
        "",
        r.description ?? "",
        r.impact ? `\nImpact: ${r.impact}` : "",
      ].filter(Boolean).join("\n"),
    });
  }
  return blocks;
}

router.get("/risks/docx", requireAuth, async (req: any, res) => {
  const scope = req.query.scope === "all" ? "all" : "open";
  const risks = await loadRisks(scope);
  const buf = await buildDocxBuffer(`SCCC IT — ${scope === "all" ? "Full" : "Open"} Risk Register`, riskBlocks(risks));
  return sendDocx(res, buf, `risk-register-${scope}.docx`);
});

router.get("/risks/pdf", requireAuth, async (req: any, res) => {
  const scope = req.query.scope === "all" ? "all" : "open";
  const risks = await loadRisks(scope);
  const sections: PdfSection[] = [
    { kind: "kv", label: "Risks reported", value: String(risks.length) },
    { kind: "kv", label: "Scope", value: scope === "all" ? "All risks" : "Open risks only" },
    { kind: "spacer" },
  ];
  for (const r of risks) {
    sections.push({ kind: "heading", level: 3, text: `${(r.severity ?? "").toUpperCase()} — ${r.title}` });
    sections.push({ kind: "kv", label: "Type", value: String(r.type ?? "—") });
    sections.push({ kind: "kv", label: "Status", value: String(r.status ?? "—") });
    if (r.relatedBuilding) sections.push({ kind: "kv", label: "Building", value: r.relatedBuilding });
    if (r.relatedDevice) sections.push({ kind: "kv", label: "Device", value: r.relatedDevice });
    if (r.description) sections.push({ kind: "paragraph", text: r.description });
    if (r.impact) sections.push({ kind: "kv", label: "Impact", value: r.impact });
    sections.push({ kind: "spacer" });
  }
  return streamPdf(res, {
    title: `SCCC IT — ${scope === "all" ? "Full" : "Open"} Risk Register`,
    subtitle: "Seward County Community College — IT Department",
    filename: `risk-register-${scope}.pdf`,
    sections,
  });
});

// ---- Process Library exports -----------------------------------------------
async function loadProcess(id: number) {
  const [proc] = await db.select().from(processesTable).where(eq(processesTable.id, id));
  if (!proc) return null;
  const [author] = await db.select().from(usersTable).where(eq(usersTable.id, proc.createdBy));
  return { proc, authorName: author?.name ?? "Unknown" };
}

router.get("/process/:id/pdf", requireAuth, async (req: any, res) => {
  try {
    const loaded = await loadProcess(parseInt(req.params.id));
    if (!loaded) return res.status(404).json({ error: "Not found" });
    const { proc, authorName } = loaded;
    const sections: PdfSection[] = [
      { kind: "kv", label: "Category", value: proc.category ?? "general" },
      { kind: "kv", label: "Author", value: authorName },
      { kind: "kv", label: "Last updated", value: proc.updatedAt.toLocaleString() },
    ];
    if (proc.tags && proc.tags.length > 0) {
      sections.push({ kind: "kv", label: "Tags", value: proc.tags.join(", ") });
    }
    if (proc.summary) {
      sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: "Summary" }, { kind: "paragraph", text: proc.summary });
    }
    sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: "Procedure" });
    for (const sec of markdownToPdfSections(proc.content || "")) sections.push(sec);
    return streamPdf(res, {
      title: proc.title,
      subtitle: "SCCC IT — Process Library",
      filename: `process-${proc.slug || proc.id}.pdf`,
      sections,
    });
  } catch (err: any) {
    console.error("Process PDF export failed:", err);
    return res.status(500).json({ error: "Export failed", message: err?.message });
  }
});

router.get("/process/:id/docx", requireAuth, async (req: any, res) => {
  try {
    const loaded = await loadProcess(parseInt(req.params.id));
    if (!loaded) return res.status(404).json({ error: "Not found" });
    const { proc, authorName } = loaded;
    const blocks: Array<{ heading?: string; level?: 1 | 2 | 3; text?: string; bullets?: string[] }> = [
      {
        text: `Category: ${proc.category ?? "general"}\nAuthor: ${authorName}\nLast updated: ${proc.updatedAt.toLocaleString()}` +
          (proc.tags?.length ? `\nTags: ${proc.tags.join(", ")}` : ""),
      },
    ];
    if (proc.summary) blocks.push({ heading: "Summary", level: 2, text: proc.summary });
    blocks.push({ heading: "Procedure", level: 2 });
    for (const b of markdownToBlocks(proc.content || "")) blocks.push(b);
    const buf = await buildDocxBuffer(proc.title, blocks);
    return sendDocx(res, buf, `process-${proc.slug || proc.id}.docx`);
  } catch (err: any) {
    console.error("Process DOCX export failed:", err);
    return res.status(500).json({ error: "Export failed", message: err?.message });
  }
});

// ---- Project exports --------------------------------------------------------
async function loadProject(id: number) {
  const [proj] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!proj) return null;
  const assigneeRows = await db
    .select({ userId: projectAssigneesTable.userId, name: usersTable.name, email: usersTable.email })
    .from(projectAssigneesTable)
    .leftJoin(usersTable, eq(usersTable.id, projectAssigneesTable.userId))
    .where(eq(projectAssigneesTable.projectId, id));
  return { proj, assignees: assigneeRows };
}

function projectStatusLabel(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

router.get("/project/:id/pdf", requireAuth, async (req: any, res) => {
  try {
    const loaded = await loadProject(parseInt(req.params.id));
    if (!loaded) return res.status(404).json({ error: "Not found" });
    const { proj, assignees } = loaded;
    const sections: PdfSection[] = [
      { kind: "kv", label: "Status", value: projectStatusLabel(proj.status) },
      { kind: "kv", label: "Progress", value: `${proj.progress ?? 0}%` },
      { kind: "kv", label: "Target date", value: proj.targetDate ?? "—" },
      ...(proj.newEstimatedDate
        ? [{ kind: "kv" as const, label: "New estimated date", value: proj.newEstimatedDate }]
        : []),
      { kind: "kv", label: "Team", value: assignees.length ? assignees.map((a) => a.name ?? "Unknown").join(", ") : "Unassigned" },
    ];
    if (proj.description) {
      sections.push(
        { kind: "spacer" },
        { kind: "heading", level: 2, text: "Description" },
        { kind: "paragraph", text: proj.description },
      );
    }
    const decisions = proj.pendingDecisions ?? [];
    if (decisions.length > 0) {
      sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: "Decisions" });
      for (const d of decisions) {
        sections.push({ kind: "heading", level: 3, text: `${d.status === "decided" ? "✓" : "•"} ${d.title}` });
        if (d.description) sections.push({ kind: "paragraph", text: d.description });
        if (d.status === "decided" && d.decidedBy) {
          sections.push({ kind: "kv", label: "Decided by", value: `${d.decidedBy}${d.decidedAt ? " on " + new Date(d.decidedAt).toLocaleDateString() : ""}` });
        }
      }
    }
    const attachments = proj.attachments ?? [];
    if (attachments.length > 0) {
      sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: "Attachments" });
      for (const a of attachments) {
        sections.push({ kind: "bullet", text: `${a.name} — ${a.url}` });
      }
    }
    const log = proj.progressLog ?? [];
    if (log.length > 0) {
      sections.push({ kind: "spacer" }, { kind: "heading", level: 2, text: "Progress history" });
      for (const e of log) {
        sections.push({ kind: "bullet", text: `${e.date}: ${e.value}%` });
      }
    }
    return streamPdf(res, {
      title: proj.title,
      subtitle: "SCCC IT — Project",
      filename: `project-${proj.id}.pdf`,
      sections,
    });
  } catch (err: any) {
    console.error("Project PDF export failed:", err);
    return res.status(500).json({ error: "Export failed", message: err?.message });
  }
});

router.get("/project/:id/docx", requireAuth, async (req: any, res) => {
  try {
    const loaded = await loadProject(parseInt(req.params.id));
    if (!loaded) return res.status(404).json({ error: "Not found" });
    const { proj, assignees } = loaded;
    const blocks: Array<{ heading?: string; level?: 1 | 2 | 3; text?: string; bullets?: string[] }> = [
      {
        text:
          `Status: ${projectStatusLabel(proj.status)}\n` +
          `Progress: ${proj.progress ?? 0}%\n` +
          `Target date: ${proj.targetDate ?? "—"}` +
          (proj.newEstimatedDate ? `\nNew estimated date: ${proj.newEstimatedDate}` : "") +
          `\nTeam: ${assignees.length ? assignees.map((a) => a.name ?? "Unknown").join(", ") : "Unassigned"}`,
      },
    ];
    if (proj.description) blocks.push({ heading: "Description", level: 2, text: proj.description });
    const decisions = proj.pendingDecisions ?? [];
    if (decisions.length > 0) {
      blocks.push({ heading: "Decisions", level: 2 });
      for (const d of decisions) {
        const lines: string[] = [`${d.status === "decided" ? "[Decided] " : "[Pending] "}${d.title}`];
        if (d.description) lines.push(d.description);
        if (d.status === "decided" && d.decidedBy) {
          lines.push(`Decided by ${d.decidedBy}${d.decidedAt ? " on " + new Date(d.decidedAt).toLocaleDateString() : ""}`);
        }
        blocks.push({ text: lines.join("\n") });
      }
    }
    const attachments = proj.attachments ?? [];
    if (attachments.length > 0) {
      blocks.push({ heading: "Attachments", level: 2, bullets: attachments.map((a) => `${a.name} — ${a.url}`) });
    }
    const log = proj.progressLog ?? [];
    if (log.length > 0) {
      blocks.push({ heading: "Progress history", level: 2, bullets: log.map((e) => `${e.date}: ${e.value}%`) });
    }
    const buf = await buildDocxBuffer(proj.title, blocks);
    return sendDocx(res, buf, `project-${proj.id}.docx`);
  } catch (err: any) {
    console.error("Project DOCX export failed:", err);
    return res.status(500).json({ error: "Export failed", message: err?.message });
  }
});

router.post("/report/:id/zendesk", requireAuth, requireCIO, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const schema = z.object({
    subject: z.string(),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    requesterEmail: z.string().optional(),
    additionalNotes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) return res.status(404).json({ error: "Not found" });

  const entries = await db.select().from(entriesTable).where(eq(entriesTable.weekOf, report.weekOf));

  const body = [
    `IT Department Weekly Report — Week of ${report.weekOf}`,
    "",
    report.summary ? `Summary: ${report.summary}` : "",
    "",
    `Total Entries: ${entries.length}`,
    `Total Tickets: ${entries.reduce((s, e) => s + (e.ticketCount ?? 0), 0)}`,
    parsed.data.additionalNotes ? `\nAdditional Notes: ${parsed.data.additionalNotes}` : "",
  ].join("\n");

  const zendeskDomain = process.env.ZENDESK_SUBDOMAIN;
  const zendeskToken = process.env.ZENDESK_API_TOKEN;
  const zendeskEmail = process.env.ZENDESK_EMAIL;

  if (!zendeskDomain || !zendeskToken || !zendeskEmail) {
    return res.status(500).json({ error: "Zendesk not configured" });
  }

  try {
    const credentials = Buffer.from(`${zendeskEmail}/token:${zendeskToken}`).toString("base64");
    const response = await fetch(`https://${zendeskDomain}.zendesk.com/api/v2/tickets.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${credentials}`,
      },
      body: JSON.stringify({
        ticket: {
          subject: parsed.data.subject,
          comment: { body },
          priority: parsed.data.priority,
          requester: parsed.data.requesterEmail ? { email: parsed.data.requesterEmail } : undefined,
          tags: ["it-report", "weekly-report"],
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: "Zendesk API error", message: text });
    }

    const data = await response.json() as any;
    return res.json({
      ticketId: data.ticket.id,
      ticketUrl: `https://${zendeskDomain}.zendesk.com/agent/tickets/${data.ticket.id}`,
      status: data.ticket.status,
    });
  } catch (err) {
    return res.status(502).json({ error: "Failed to create Zendesk ticket" });
  }
});

router.post("/entry/:id/zendesk", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const schema = z.object({
    subject: z.string(),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    requesterEmail: z.string().optional(),
    additionalNotes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.id, id));
  if (!entry) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && entry.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, entry.userId));

  const body = [
    `IT Log Entry: ${entry.title}`,
    `By: ${user?.name ?? "Unknown"} | Category: ${entry.category}`,
    `Week of: ${entry.weekOf}`,
    "",
    entry.description,
    entry.accomplishments ? `\nAccomplishments: ${entry.accomplishments}` : "",
    entry.challenges ? `\nChallenges: ${entry.challenges}` : "",
    parsed.data.additionalNotes ? `\nAdditional Notes: ${parsed.data.additionalNotes}` : "",
  ].join("\n");

  const zendeskDomain = process.env.ZENDESK_SUBDOMAIN;
  const zendeskToken = process.env.ZENDESK_API_TOKEN;
  const zendeskEmail = process.env.ZENDESK_EMAIL;

  if (!zendeskDomain || !zendeskToken || !zendeskEmail) {
    return res.status(500).json({ error: "Zendesk not configured" });
  }

  try {
    const credentials = Buffer.from(`${zendeskEmail}/token:${zendeskToken}`).toString("base64");
    const response = await fetch(`https://${zendeskDomain}.zendesk.com/api/v2/tickets.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${credentials}`,
      },
      body: JSON.stringify({
        ticket: {
          subject: parsed.data.subject,
          comment: { body },
          priority: parsed.data.priority,
          tags: ["it-report", "log-entry"],
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: "Zendesk API error", message: text });
    }

    const data = await response.json() as any;
    return res.json({
      ticketId: data.ticket.id,
      ticketUrl: `https://${zendeskDomain}.zendesk.com/agent/tickets/${data.ticket.id}`,
      status: data.ticket.status,
    });
  } catch (err) {
    return res.status(502).json({ error: "Failed to create Zendesk ticket" });
  }
});

export default router;
