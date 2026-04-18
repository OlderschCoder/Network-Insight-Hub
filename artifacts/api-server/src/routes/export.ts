import { Router } from "express";
import { db, reportsTable, entriesTable, risksTable, usersTable, afterActionReportsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

const router = Router();

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
  } catch (err) {
    return res.status(500).json({ error: "Export failed" });
  }
});

router.post("/report/:id/zendesk", requireAuth, async (req: any, res) => {
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
