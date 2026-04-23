import { Router, type Request, type Response } from "express";
import OpenAI from "openai";
import {
  db,
  entriesTable,
  reportsTable,
  risksTable,
  afterActionReportsTable,
  logItemsTable,
  projectsTable,
  strategicObjectivesTable,
  networkSwitchesTable,
} from "@workspace/db";
import { and, gte, lte, sql } from "drizzle-orm";

const entries = entriesTable;
const reports = reportsTable;
const risks = risksTable;
const afterActionReports = afterActionReportsTable;
import { requireAuth, requireCIO } from "./auth";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const router = Router();

function parseDate(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

router.post(
  "/generate",
  requireAuth,
  requireCIO,
  async (req: Request, res: Response) => {
    try {
      const {
        startDate,
        endDate,
        accountName = "Seward County Community College",
        stakeholders = "",
        accountStatus = "Active – In Good Standing",
        oculusPM = "",
        oculusITO = "",
        revenue = "",
        profitability = "",
        contractValid = "",
        additionalNotes = "",
      } = req.body ?? {};

      const start = parseDate(startDate);
      const end = parseDate(endDate);
      if (!start || !end) {
        return res.status(400).json({ error: "startDate and endDate must be valid ISO dates" });
      }
      if (start > end) {
        return res.status(400).json({ error: "startDate must be on or before endDate" });
      }

      // Gather operational data from DB
      const [
        entriesData,
        reportsData,
        risksData,
        aarData,
        ticketStats,
        logItemsData,
        projectsData,
        objectivesData,
        switchesData,
      ] = await Promise.all([
        db
          .select({
            category: entries.category,
            title: entries.title,
            description: entries.description,
            accomplishments: entries.accomplishments,
            challenges: entries.challenges,
            ticketCount: entries.ticketCount,
            entryDate: entries.entryDate,
            weekOf: entries.weekOf,
          })
          .from(entries)
          .where(
            and(
              gte(entries.entryDate, start.toISOString().slice(0, 10)),
              lte(entries.entryDate, end.toISOString().slice(0, 10))
            )
          ),
        db
          .select({
            weekOf: reports.weekOf,
            title: reports.title,
            summary: reports.summary,
            accomplishments: reports.accomplishments,
            challenges: reports.challenges,
            strategicProgress: reports.strategicProgress,
            nextWeekPlans: reports.nextWeekPlans,
            status: reports.status,
          })
          .from(reports)
          .where(
            and(
              gte(reports.weekOf, start.toISOString().slice(0, 10)),
              lte(reports.weekOf, end.toISOString().slice(0, 10))
            )
          ),
        db
          .select({
            type: risks.type,
            severity: risks.severity,
            status: risks.status,
            title: risks.title,
            description: risks.description,
            mitigation: risks.mitigation,
            updatedAt: risks.updatedAt,
          })
          .from(risks)
          .where(
            and(
              gte(risks.updatedAt, start),
              lte(risks.updatedAt, end)
            )
          ),
        db
          .select({
            title: afterActionReports.title,
            incident: afterActionReports.incident,
            building: afterActionReports.building,
            severity: afterActionReports.severity,
            status: afterActionReports.status,
            timeline: afterActionReports.timeline,
            rootCause: afterActionReports.rootCause,
            resolution: afterActionReports.resolution,
            lessonsLearned: afterActionReports.lessonsLearned,
            preventionMeasures: afterActionReports.preventionMeasures,
            incidentDate: afterActionReports.incidentDate,
            resolvedAt: afterActionReports.resolvedAt,
          })
          .from(afterActionReports)
          .where(
            and(
              gte(afterActionReports.incidentDate, start),
              lte(afterActionReports.incidentDate, end)
            )
          ),
        db
          .select({
            total: sql<number>`COALESCE(SUM(${entries.ticketCount}), 0)::int`,
            categoryCounts: sql<string>`STRING_AGG(DISTINCT ${entries.category}, ',')`,
          })
          .from(entries)
          .where(
            and(
              gte(entries.entryDate, start.toISOString().slice(0, 10)),
              lte(entries.entryDate, end.toISOString().slice(0, 10))
            )
          ),
        db
          .select({
            title: logItemsTable.title,
            category: logItemsTable.category,
            notes: logItemsTable.notes,
            itemDate: logItemsTable.itemDate,
          })
          .from(logItemsTable)
          .where(
            and(
              gte(logItemsTable.itemDate, start.toISOString().slice(0, 10)),
              lte(logItemsTable.itemDate, end.toISOString().slice(0, 10))
            )
          ),
        db.select({
          id: projectsTable.id,
          title: projectsTable.title,
          description: projectsTable.description,
          status: projectsTable.status,
          progress: projectsTable.progress,
          targetDate: projectsTable.targetDate,
          newEstimatedDate: projectsTable.newEstimatedDate,
          strategicObjectiveIds: projectsTable.strategicObjectiveIds,
        }).from(projectsTable),
        db.select({
          id: strategicObjectivesTable.id,
          title: strategicObjectivesTable.title,
          description: strategicObjectivesTable.description,
          status: strategicObjectivesTable.status,
        }).from(strategicObjectivesTable),
        db.select({
          hostname: networkSwitchesTable.hostname,
          building: networkSwitchesTable.building,
          maintenanceLog: networkSwitchesTable.maintenanceLog,
        }).from(networkSwitchesTable),
      ]);

      // Filter maintenance windows to the date range
      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);
      const maintenanceWindows: any[] = [];
      for (const sw of switchesData) {
        for (const log of sw.maintenanceLog ?? []) {
          const d = (log.windowStart || log.createdAt || "").slice(0, 10);
          if (d >= startStr && d <= endStr) {
            maintenanceWindows.push({
              switch: sw.hostname,
              building: sw.building,
              author: log.authorName,
              windowStart: log.windowStart ?? null,
              windowEnd: log.windowEnd ?? null,
              body: log.body,
            });
          }
        }
      }

      // Goal progress derived from projects → objectives
      const goalProgress = objectivesData
        .filter((o) => o.status !== "archived")
        .map((o) => {
          const linked = projectsData.filter((p) =>
            Array.isArray(p.strategicObjectiveIds) && (p.strategicObjectiveIds as number[]).includes(o.id),
          );
          const active = linked.filter((p) => p.status !== "completed" && p.status !== "cancelled");
          const avgProgress = linked.length > 0
            ? Math.round(linked.reduce((s, p) => s + (p.progress ?? 0), 0) / linked.length)
            : 0;
          return {
            goal: o.title,
            description: o.description,
            linkedProjects: linked.length,
            activeProjects: active.length,
            avgProgress,
          };
        });

      const operationalData = {
        period: { startDate, endDate },
        accountInfo: {
          accountName,
          stakeholders,
          accountStatus,
          oculusPM,
          oculusITO,
          revenue,
          profitability,
          contractValid,
          additionalNotes,
        },
        ticketStats: ticketStats[0] ?? { total: 0, categoryCounts: "" },
        entries: entriesData,
        completedTasks: logItemsData,
        weeklyReports: reportsData,
        openRisksAndIssues: risksData.filter((r) => r.status === "open"),
        mitigatedRisks: risksData.filter((r) => r.status === "mitigated"),
        closedRisks: risksData.filter((r) => r.status === "closed"),
        afterActionReports: aarData,
        projects: projectsData.map((p) => ({
          title: p.title,
          status: p.status,
          progress: p.progress,
          targetDate: p.targetDate,
          newEstimatedDate: p.newEstimatedDate,
          description: p.description,
        })),
        departmentGoals: goalProgress,
        networkMaintenance: maintenanceWindows,
      };

      const systemPrompt = `You are an MSP (Managed Services Provider) account executive writing a professional executive Managed Services Status Report for OculusIT's client, Seward County Community College.

Use the exact format and tone of OculusIT's "Managed Services Status" report:

# Format Required (use this exact section structure):

**Managed Services Status**

Date: [report date]
Account Name: [name]
Client/Stakeholder: [stakeholders]
Account Status: [status]
OculusIT PM: [pm]
OculusIT ITO (site leader): [ito]
Revenue: [revenue]
Profitability: [profitability]
Contract Valid Until: [date]

**On-going Projects / Services**
[Bulleted narrative paragraphs describing ongoing IT operations, modernization work, etc. Synthesize from entries categorized as network, security, project, etc. Use professional MSP language.]

**Service Level Metrics**
[Bullets covering: helpdesk responsiveness, project delivery timelines, priority incident response, service restoration, delivery milestones, infrastructure availability/uptime %, downtime %. Use the ticket counts and AAR data to calculate or infer realistic metrics. If data is sparse, use reasonable industry-standard targets.]

**Client Satisfaction**
[Brief paragraph on satisfaction posture.]

**Recent Wins / Challenges**
[Bullet list. Wins from completed entries, finalized reports, and successful AARs. Challenges from open risks, failed AARs, and reported challenges in entries. Be specific — reference actual events from the data.]

**Key Actions / Decisions (in-progress)**
[Bullet list from open risks, design suggestions, and ongoing entries. Use forward-looking language.]

# Rules
- Use professional, executive-level language. No jargon overload.
- Synthesize, don't just list. Each bullet should sound like an MSP account manager wrote it.
- If the data references specific events (outages, projects, incidents), include them by name/date.
- Calculate reasonable approximations for uptime and ticket SLA when data permits.
- Use Markdown formatting with bold section headings.
- Do NOT invent stakeholder names, dollar amounts, or contract dates — use only what is provided in accountInfo.
- If accountInfo fields are empty, write "[To be provided]" rather than fabricating.`;

      const userPrompt = `Generate the Managed Services Status Report from the following operational data:\n\n${JSON.stringify(operationalData, null, 2)}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 8192,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const reportText = completion.choices[0]?.message?.content ?? "";

      return res.json({
        report: reportText,
        dataSummary: {
          entriesCount: entriesData.length,
          weeklyReportsCount: reportsData.length,
          openRisksCount: operationalData.openRisksAndIssues.length,
          aarCount: aarData.length,
          totalTickets: ticketStats[0]?.total ?? 0,
          completedTasksCount: logItemsData.length,
          projectsCount: projectsData.length,
          activeProjectsCount: projectsData.filter((p) => p.status !== "completed" && p.status !== "cancelled").length,
          goalsCount: goalProgress.length,
          maintenanceWindowsCount: maintenanceWindows.length,
        },
      });
    } catch (error) {
      console.error("Status report generation error:", error);
      return res.status(500).json({
        error: "Failed to generate status report",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

router.post(
  "/chat",
  requireAuth,
  requireCIO,
  async (req: Request, res: Response) => {
    try {
      const { messages: chatMessages = [], lookbackDays: rawLookback = 90 } = req.body ?? {};

      if (!Array.isArray(chatMessages) || chatMessages.length === 0) {
        return res.status(400).json({ error: "messages array required" });
      }

      // Validate message shape
      const validRoles = new Set(["user", "assistant", "system"]);
      for (const m of chatMessages) {
        if (!m || typeof m !== "object" || !validRoles.has(m.role) || typeof m.content !== "string") {
          return res.status(400).json({ error: "each message must have role (user|assistant|system) and string content" });
        }
      }

      const lookbackDays = Math.max(1, Math.min(365, Number(rawLookback) || 90));
      const since = new Date();
      since.setDate(since.getDate() - lookbackDays);
      const sinceStr = since.toISOString().slice(0, 10);

      const [entriesData, risksData, aarData, switchCount, vlanCount] = await Promise.all([
        db
          .select({
            category: entries.category,
            title: entries.title,
            description: entries.description,
            accomplishments: entries.accomplishments,
            challenges: entries.challenges,
            ticketCount: entries.ticketCount,
            entryDate: entries.entryDate,
          })
          .from(entries)
          .where(gte(entries.entryDate, sinceStr))
          .limit(100),
        db
          .select({
            type: risks.type,
            severity: risks.severity,
            status: risks.status,
            title: risks.title,
            description: risks.description,
            mitigation: risks.mitigation,
          })
          .from(risks)
          .limit(50),
        db
          .select({
            title: afterActionReports.title,
            incident: afterActionReports.incident,
            severity: afterActionReports.severity,
            status: afterActionReports.status,
            resolution: afterActionReports.resolution,
            incidentDate: afterActionReports.incidentDate,
          })
          .from(afterActionReports)
          .where(gte(afterActionReports.incidentDate, since))
          .limit(50),
        db.execute(sql`SELECT COUNT(*)::int AS count FROM network_switches`),
        db.execute(sql`SELECT COUNT(*)::int AS count FROM vlans`),
      ]);

      const context = {
        lookbackDays,
        recentEntries: entriesData,
        risksAndIssues: risksData,
        afterActionReports: aarData,
        networkInventory: {
          switches: (switchCount.rows[0] as any)?.count ?? 0,
          vlans: (vlanCount.rows[0] as any)?.count ?? 0,
        },
      };

      const systemPrompt = `You are an AI assistant for the Seward County Community College IT Department reporting platform. You have read-only access to operational data: log entries, weekly reports, risks/issues/design suggestions, after-action reports, and network inventory (switches and VLANs).

Help the user understand the data, summarize trends, draft sections of executive reports, identify risks, and answer specific questions. Be concise and professional. Cite specific entries, AARs, or risks by title/date when relevant. If the data does not support an answer, say so.

Current context (last ${lookbackDays} days):
${JSON.stringify(context, null, 2)}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          ...chatMessages,
        ],
      });

      const reply = completion.choices[0]?.message?.content ?? "";
      return res.json({ reply });
    } catch (error) {
      console.error("AI chat error:", error);
      return res.status(500).json({
        error: "Failed to get AI response",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

export default router;
