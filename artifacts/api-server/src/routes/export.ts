import { Router } from "express";
import { db, reportsTable, entriesTable, risksTable, usersTable, afterActionReportsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";
import { z } from "zod";
import { streamPdf, type PdfSection } from "../lib/pdf";

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
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

    const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
    if (!report) return res.status(404).json({ error: "Not found" });

    const entries = await db.select().from(entriesTable).where(eq(entriesTable.weekOf, report.weekOf));
    const userIds = [...new Set(entries.map(e => e.userId))];
    const users = await Promise.all(userIds.map(async uid => {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, uid));
      return u;
    }));
    const userMap = Object.fromEntries(users.filter(Boolean).map(u => [u!.id, u!]));

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: `IT Department Weekly Report — ${report.weekOf}`, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Status: ${report.status.toUpperCase()}`, children: [new TextRun({ text: `Status: ${report.status.toUpperCase()}`, bold: true })] }),
          new Paragraph({ text: "" }),
          ...(report.summary ? [
            new Paragraph({ text: "Executive Summary", heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: report.summary }),
            new Paragraph({ text: "" }),
          ] : []),
          ...(report.accomplishments ? [
            new Paragraph({ text: "Accomplishments", heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: report.accomplishments }),
            new Paragraph({ text: "" }),
          ] : []),
          ...(report.challenges ? [
            new Paragraph({ text: "Challenges", heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: report.challenges }),
            new Paragraph({ text: "" }),
          ] : []),
          ...(report.strategicProgress ? [
            new Paragraph({ text: "Strategic Progress", heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: report.strategicProgress }),
            new Paragraph({ text: "" }),
          ] : []),
          ...(report.nextWeekPlans ? [
            new Paragraph({ text: "Plans for Next Week", heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: report.nextWeekPlans }),
            new Paragraph({ text: "" }),
          ] : []),
          new Paragraph({ text: "Team Entries", heading: HeadingLevel.HEADING_2 }),
          ...entries.flatMap(entry => [
            new Paragraph({ text: entry.title, heading: HeadingLevel.HEADING_3 }),
            new Paragraph({ text: `By: ${userMap[entry.userId]?.name ?? "Unknown"} | Category: ${entry.category}` }),
            new Paragraph({ text: entry.description }),
            ...(entry.accomplishments ? [new Paragraph({ text: `Accomplishments: ${entry.accomplishments}` })] : []),
            ...(entry.challenges ? [new Paragraph({ text: `Challenges: ${entry.challenges}` })] : []),
            new Paragraph({ text: "" }),
          ]),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="it-report-${report.weekOf}.docx"`);
    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ error: "Export failed" });
  }
});

router.get("/report/:id/xlsx", requireAuth, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const ExcelJS = (await import("exceljs")).default;

    const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
    if (!report) return res.status(404).json({ error: "Not found" });

    const entries = await db.select().from(entriesTable).where(eq(entriesTable.weekOf, report.weekOf));
    const risks = await db.select().from(risksTable).where(eq(risksTable.status, "open"));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SCCC IT Reporting Platform";
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet("Summary");
    summarySheet.addRow(["IT Department Weekly Report"]);
    summarySheet.addRow(["Week Of", report.weekOf]);
    summarySheet.addRow(["Status", report.status]);
    summarySheet.addRow(["Entries", entries.length]);
    summarySheet.addRow(["Total Tickets", entries.reduce((s, e) => s + (e.ticketCount ?? 0), 0)]);

    const entriesSheet = workbook.addWorksheet("Entries");
    entriesSheet.addRow(["ID", "Category", "Title", "Description", "Accomplishments", "Challenges", "Tickets", "Submitted", "Date"]);
    for (const entry of entries) {
      entriesSheet.addRow([
        entry.id, entry.category, entry.title, entry.description,
        entry.accomplishments ?? "", entry.challenges ?? "",
        entry.ticketCount ?? 0, entry.isSubmitted ? "Yes" : "No", entry.createdAt.toISOString(),
      ]);
    }

    const risksSheet = workbook.addWorksheet("Open Risks");
    risksSheet.addRow(["ID", "Type", "Severity", "Status", "Title", "Description", "Impact", "Building", "Device"]);
    for (const risk of risks) {
      risksSheet.addRow([
        risk.id, risk.type, risk.severity, risk.status,
        risk.title, risk.description, risk.impact ?? "",
        risk.relatedBuilding ?? "", risk.relatedDevice ?? "",
      ]);
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="it-report-${report.weekOf}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
    return;
  } catch (err) {
    return res.status(500).json({ error: "Export failed" });
  }
});

router.get("/report/:id/pdf", requireAuth, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
    if (!report) return res.status(404).json({ error: "Not found" });
    const entries = await db.select().from(entriesTable).where(eq(entriesTable.weekOf, report.weekOf));
    const userIds = [...new Set(entries.map(e => e.userId))];
    const users = await Promise.all(userIds.map(async uid => {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, uid));
      return u;
    }));
    const userMap = Object.fromEntries(users.filter(Boolean).map(u => [u!.id, u!]));

    const sections: PdfSection[] = [];
    sections.push({ kind: "kv", label: "Status", value: report.status.toUpperCase() });
    sections.push({ kind: "kv", label: "Total entries", value: String(entries.length) });
    sections.push({ kind: "kv", label: "Total tickets", value: String(entries.reduce((s, e) => s + (e.ticketCount ?? 0), 0)) });
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
    sections.push({ kind: "heading", level: 2, text: "Team Entries" });
    if (entries.length === 0) {
      sections.push({ kind: "paragraph", text: "No entries logged for this week.", italic: true });
    }
    for (const entry of entries) {
      sections.push({ kind: "heading", level: 3, text: entry.title });
      sections.push({ kind: "kv", label: "By", value: `${userMap[entry.userId]?.name ?? "Unknown"}  ·  Category: ${entry.category}` });
      if (entry.description) sections.push({ kind: "paragraph", text: entry.description });
      if (entry.accomplishments) sections.push({ kind: "kv", label: "Accomplishments", value: entry.accomplishments });
      if (entry.challenges) sections.push({ kind: "kv", label: "Challenges", value: entry.challenges });
      sections.push({ kind: "spacer" });
    }

    return streamPdf(res, {
      title: `IT Department Weekly Report — ${report.weekOf}`,
      subtitle: "Seward County Community College — IT Department",
      filename: `it-report-${report.weekOf}.pdf`,
      sections,
    });
  } catch (err) {
    return res.status(500).json({ error: "Export failed" });
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
