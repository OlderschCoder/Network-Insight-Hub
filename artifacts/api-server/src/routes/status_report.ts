import { Router, type Request, type Response } from "express";
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
  vlansTable,
} from "@workspace/db";
import { and, eq, gte, lte, ne, notInArray, or, sql } from "drizzle-orm";

const entries = entriesTable;
const reports = reportsTable;
const risks = risksTable;
const afterActionReports = afterActionReportsTable;
import { requireAuth, requireCIO } from "./auth";
import { getKnowledgeContext, runChatWithMemory, messageRequestsCapture, getActiveRoster } from "../lib/ai_knowledge";
import { getOpenAI, isAIConfigured } from "../lib/openai";

const router = Router();

function parseDate(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function buildNetworkByBuilding(
  switches: Array<Record<string, any>>,
  vlans: Array<Record<string, any>>,
) {
  const map = new Map<string, { building: string; switches: any[]; vlans: any[] }>();
  const ensure = (b: unknown) => {
    const key = (typeof b === "string" && b.trim()) || "Unassigned";
    if (!map.has(key)) map.set(key, { building: key, switches: [], vlans: [] });
    return map.get(key)!;
  };
  for (const s of switches) {
    ensure(s.building).switches.push({
      hostname: s.hostname,
      ipAddress: s.ipAddress ?? null,
      model: s.model ?? null,
      status: s.status ?? null,
      location: s.location ?? null,
      notes: s.notes ?? null,
    });
  }
  for (const v of vlans) {
    ensure(v.building).vlans.push({
      vlanId: v.vlanId,
      name: v.name,
      type: v.type ?? null,
      subnet: v.subnet ?? null,
      gateway: v.gateway ?? null,
      description: v.description ?? null,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.building.localeCompare(b.building));
}

router.post(
  "/generate",
  requireAuth,
  requireCIO,
  async (req: Request, res: Response) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured." });
    }
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
        vlansData,
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
          // PIRs that occurred OR were resolved OR were created in the period
          // (matches /reports/:id/extras semantics so AI narrative sees the same
          // PIRs that show on the report card).
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
            createdAt: afterActionReports.createdAt,
          })
          .from(afterActionReports)
          .where(
            or(
              and(
                gte(afterActionReports.incidentDate, start),
                lte(afterActionReports.incidentDate, end),
              ),
              and(
                gte(afterActionReports.resolvedAt, start),
                lte(afterActionReports.resolvedAt, end),
              ),
              and(
                gte(afterActionReports.createdAt, start),
                lte(afterActionReports.createdAt, end),
              ),
            ),
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
        db.select({
          vlanId: vlansTable.vlanId,
          name: vlansTable.name,
          building: vlansTable.building,
          maintenanceLog: vlansTable.maintenanceLog,
        }).from(vlansTable),
      ]);

      // Filter maintenance windows to the date range — OR semantics on
      // createdAt / windowStart / windowEnd so a window qualifies if any one
      // date falls in the range.
      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);
      const inRange = (s?: string | null) => {
        if (!s) return false;
        const d = s.slice(0, 10);
        return d >= startStr && d <= endStr;
      };
      type MaintenanceWindow = {
        target: string;
        kind: "switch" | "vlan";
        building: string;
        author: string;
        windowStart: string | null;
        windowEnd: string | null;
        body: string;
      };
      const maintenanceWindows: MaintenanceWindow[] = [];
      for (const sw of switchesData) {
        for (const log of sw.maintenanceLog ?? []) {
          if (log.deletedAt) continue;
          if (inRange(log.createdAt) || inRange(log.windowStart) || inRange(log.windowEnd)) {
            maintenanceWindows.push({
              target: sw.hostname,
              kind: "switch",
              building: sw.building,
              author: log.authorName,
              windowStart: log.windowStart ?? null,
              windowEnd: log.windowEnd ?? null,
              body: log.body,
            });
          }
        }
      }
      for (const vlan of vlansData) {
        for (const log of vlan.maintenanceLog ?? []) {
          if (log.deletedAt) continue;
          if (inRange(log.createdAt) || inRange(log.windowStart) || inRange(log.windowEnd)) {
            maintenanceWindows.push({
              target: `VLAN ${vlan.vlanId} (${vlan.name})`,
              kind: "vlan",
              building: vlan.building,
              author: log.authorName,
              windowStart: log.windowStart ?? null,
              windowEnd: log.windowEnd ?? null,
              body: log.body,
            });
          }
        }
      }

      // Per-project date-range delta: progress at startDate (last progressLog
      // entry on/before startStr, else 0) vs current progress.
      const allProjectsForGoals = await db
        .select({
          id: projectsTable.id,
          title: projectsTable.title,
          status: projectsTable.status,
          progress: projectsTable.progress,
          progressLog: projectsTable.progressLog,
          strategicObjectiveIds: projectsTable.strategicObjectiveIds,
        })
        .from(projectsTable);
      const startIso = new Date(startStr + "T00:00:00.000Z").toISOString();
      const projectRangeDelta = (p: typeof allProjectsForGoals[number]) => {
        const log = Array.isArray(p.progressLog)
          ? (p.progressLog as { date: string; value: number }[])
          : [];
        const sorted = [...log].sort((a, b) => a.date.localeCompare(b.date));
        let startVal = 0;
        for (const e of sorted) {
          if (e.date <= startIso) startVal = e.value;
          else break;
        }
        const endVal = p.progress ?? 0;
        return { startVal, delta: endVal - startVal };
      };

      // Goal progress derived from projects → objectives, with date-range deltas.
      const goalProgress = objectivesData
        .filter((o) => o.status !== "archived")
        .map((o) => {
          const linked = allProjectsForGoals.filter((p) =>
            Array.isArray(p.strategicObjectiveIds) && (p.strategicObjectiveIds as number[]).includes(o.id),
          );
          const active = linked.filter((p) => p.status !== "completed" && p.status !== "cancelled");
          const avgProgress = linked.length > 0
            ? Math.round(linked.reduce((s, p) => s + (p.progress ?? 0), 0) / linked.length)
            : 0;
          const projectsWithDelta = linked.map((p) => {
            const d = projectRangeDelta(p);
            return {
              title: p.title,
              status: p.status,
              progressAtStart: d.startVal,
              progressNow: p.progress ?? 0,
              rangeDelta: d.delta,
            };
          });
          const sumRangeDelta = projectsWithDelta.reduce((s, p) => s + p.rangeDelta, 0);
          const avgRangeDelta = projectsWithDelta.length > 0
            ? Math.round(sumRangeDelta / projectsWithDelta.length)
            : 0;
          return {
            goal: o.title,
            description: o.description,
            linkedProjects: linked.length,
            activeProjects: active.length,
            avgProgress,
            avgRangeDelta,
            sumRangeDelta,
            projects: projectsWithDelta,
          };
        })
        .filter((g) => g.linkedProjects > 0);

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
        projects: projectsData.map((p) => {
          const objIds = Array.isArray(p.strategicObjectiveIds)
            ? (p.strategicObjectiveIds as number[])
            : [];
          const alignedGoals = objectivesData
            .filter((o) => objIds.includes(o.id))
            .map((o) => o.title);
          return {
            title: p.title,
            status: p.status,
            progress: p.progress,
            targetDate: p.targetDate,
            newEstimatedDate: p.newEstimatedDate,
            description: p.description,
            alignedDepartmentGoals: alignedGoals,
          };
        }),
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
- If accountInfo fields are empty, write "[To be provided]" rather than fabricating.

# Required data inputs (use them all — do not omit a section because data is light)
The user message contains an \`operationalData\` JSON object with these top-level keys — reference them by name:
- \`entries\` (categorized log entries from the period) and \`weeklyReports\` (finalized status reports): drive On-going Projects / Services and Recent Wins / Challenges.
- \`completedTasks\` (closed log items): use these to support delivery / wins claims and inform Key Actions / Decisions where in-progress.
- \`projects\` (each with title, status, progress, alignedDepartmentGoals): cite project name, status, and progress in On-going Projects / Services.
- \`departmentGoals\` (each item: \`goal\`, \`linkedProjects\`, \`activeProjects\`, \`avgProgress\`, \`avgRangeDelta\`, \`sumRangeDelta\`, and per-project rows under \`projects[]\` with \`progressAtStart\` → \`progressNow\` and \`rangeDelta\`): summarize movement against strategic objectives, e.g., "Modernize Network advanced +12 pts this period (avg +6%)".
- \`networkMaintenance\` (each item: \`kind\` of "switch" or "vlan", \`target\` (switch hostname or "VLAN <id> (<name>)"), building, window times, notes): mention notable switch and VLAN maintenance windows in On-going Projects / Services or Service Level Metrics.
- \`afterActionReports\` (PIRs with severity, incident, resolution, lessonsLearned): summarize incidents and learnings in Recent Wins / Challenges.
- \`openRisksAndIssues\`, \`mitigatedRisks\`, \`closedRisks\`: open ones belong in Key Actions / Decisions and (if material) Challenges; mitigated/closed support Recent Wins.
- \`ticketStats\` (helpdesk volume + categories): use for Service Level Metrics.`;

      const knowledgeContext = await getKnowledgeContext();
      const systemPromptWithKnowledge = knowledgeContext
        ? `${systemPrompt}\n\n# SCCC Environment Knowledge Base (institutional context — use for accurate terminology, systems, and environment specifics)\n${knowledgeContext}`
        : systemPrompt;

      const userPrompt = `Generate the Managed Services Status Report from the following operational data:\n\n${JSON.stringify(operationalData, null, 2)}`;

      const completion = await getOpenAI().chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 8192,
        messages: [
          { role: "system", content: systemPromptWithKnowledge },
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
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured." });
    }
    try {
      const { messages: chatMessages = [], lookbackDays: rawLookback = 90, previewInventory = false } = req.body ?? {};

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

      const [
        entriesData,
        risksData,
        aarData,
        projectsData,
        objectivesData,
        tasksData,
        switchRows,
        vlanRows,
      ] = await Promise.all([
        db
          .select({
            id: entries.id,
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
            id: risks.id,
            type: risks.type,
            severity: risks.severity,
            status: risks.status,
            title: risks.title,
            description: risks.description,
            mitigation: risks.mitigation,
            relatedBuilding: risks.relatedBuilding,
          })
          .from(risks)
          .limit(50),
        db
          .select({
            id: afterActionReports.id,
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
        db
          .select({
            id: projectsTable.id,
            title: projectsTable.title,
            status: projectsTable.status,
            progress: projectsTable.progress,
            targetDate: projectsTable.targetDate,
            description: projectsTable.description,
          })
          .from(projectsTable)
          .limit(100),
        db
          .select({
            id: strategicObjectivesTable.id,
            title: strategicObjectivesTable.title,
            status: strategicObjectivesTable.status,
          })
          .from(strategicObjectivesTable)
          .limit(50),
        db
          .select({
            id: logItemsTable.id,
            title: logItemsTable.title,
            category: logItemsTable.category,
            itemDate: logItemsTable.itemDate,
            weekOf: logItemsTable.weekOf,
          })
          .from(logItemsTable)
          .where(gte(logItemsTable.itemDate, sinceStr))
          .limit(200),
        db.select().from(networkSwitchesTable).orderBy(networkSwitchesTable.building),
        db.select().from(vlansTable).orderBy(vlansTable.vlanId),
      ]);

      const networkByBuilding = buildNetworkByBuilding(switchRows, vlanRows);
      const teamRoster = await getActiveRoster();

      const context = {
        lookbackDays,
        teamRoster,
        recentEntries: entriesData,
        risksAndIssues: risksData,
        afterActionReports: aarData,
        projects: projectsData,
        strategicObjectives: objectivesData,
        recentTasks: tasksData,
        networkInventory: {
          switchCount: switchRows.length,
          vlanCount: vlanRows.length,
          buildings: networkByBuilding,
        },
      };

      const knowledgeContext = await getKnowledgeContext();

      const authUser = (req as any).user;
      const identityLine = authUser
        ? `You are currently assisting ${authUser.name || authUser.email}${authUser.email ? ` (${authUser.email})` : ""} — their role is "${authUser.role}"${authUser.jobTitle ? `, job title "${authUser.jobTitle}"` : ""}. You already know who they are, so never ask; address them by first name when natural and attribute anything they report (work done, updates, requests) to this person.`
        : "";

      const systemPrompt = `You are an AI assistant for the Seward County Community College IT Department reporting platform. You have read-only access to the department's operational data: weekly log entries, individual tasks (log items), weekly reports, risks/issues/design suggestions, after-action (post-incident) reviews, projects, department strategic objectives, and the full network inventory — every switch and VLAN grouped by campus building, including IP addresses, models, status, subnets, and gateways. You do NOT have access to any credentials, passwords, tokens, or user login details; never claim to.
${identityLine ? `\n${identityLine}\n` : ""}
Help the user understand the data, summarize trends, draft sections of executive reports, identify risks, and answer specific questions — including questions about the campus network such as which buildings contain which switches and VLANs, IP/subnet/gateway details, and device status. Be concise and professional. If the data does not support an answer, say so.

When you reference a specific record that exists in the context below, add a clickable Markdown citation linking to that exact record in the app, using the exact id/identifier from the context:
- Risk/issue → \`[label](/risks/<id>)\`
- After-action review → \`[label](/after-action/<id>)\`
- Weekly log entry → \`[label](/entries/<id>)\`
- Project → \`[label](/projects/<id>)\`
- Network switch → \`[label](/network?tab=switches&q=<hostname>)\` (use the switch's exact hostname)
- VLAN → \`[label](/network?tab=vlans&q=<vlanId>)\` (use the numeric VLAN id)
Keep the link label short (e.g. the record's title). Only cite records that appear in the context; never invent ids or hostnames.

When answering questions about how to use or navigate the app (where a feature lives, how to reach a page), rely ONLY on the navigation and pages documented in the SCCC Environment Knowledge Base below. There IS a built-in "User Guide" page (in the "Systems & Tools" menu group, at /user-guide) with full step-by-step instructions — point users there for detailed how-to help, in addition to giving them the quick steps. Do NOT invent any other pages, menu items, or features that are not documented (there is no separate "Help" or "FAQ" page). If you are unsure where something is, say so instead of guessing.

You can capture work directly into the user's records. When the user describes concrete work in the conversation — something they did, fixed, completed, or need to do — call the create_task tool to save it as an item in their personal "My Tasks" list for the current week. These items roll up into their weekly report automatically, so this is how their conversation turns into their report. Capture each distinct piece of work as its own task, and prefer capturing over asking. After saving, briefly confirm in plain language what you added (the app also shows them a toast with an Undo option). Do not use create_task for questions, hypotheticals, or durable environment facts.

You can also DELEGATE work to teammates. When the user assigns or hands off work to someone else — e.g. "have Cecil check the SFP", "assign this to Jane", "add this to Mark's list", or describes work another team member is doing or should do — call create_task with the "assignee" set to that person's name or email from the team roster in the context. The task lands in that teammate's My Tasks (stamped with who assigned it), not the user's. Match the name against the roster; if it's ambiguous or you can't find them, ask the user which teammate they mean rather than guessing. Use critical thinking: not every task is for the person you're talking to — assign it to whoever is actually going to do the work.

When (and ONLY when) you are assisting the CIO, you have a private "shadow memory" for reporting time. If, while reviewing the data, you notice something the CIO should weigh when writing the weekly executive report — a risk or red flag worth surfacing, a trend across the team's work, a metric to highlight, a follow-up, or framing/wording advice — call the save_shadow_note tool to stage it as a reviewable suggestion for the current week. These notes are shown to the CIO privately for review only; they never modify any report, entry, or deliverable, and they are never visible to other staff. Do not stage shadow notes for anyone who is not the CIO.

You can also keep the network inventory current. When a network administrator reports a real change to a switch (added, replaced, moved building/location, went online/offline, or an IP/model change) or a VLAN (new VLAN, or a changed subnet/gateway/name/type), call upsert_switch or upsert_vlan so the switch and VLAN records stay up to date — identify a switch by its hostname and a VLAN by its numeric id. Only do this for concrete changes the user actually states; never invent inventory. If the user is not a network administrator, these updates will be refused — just tell them who to ask.

You can run live network diagnostics yourself. When the user asks whether a device is up or reachable, or whether a port/service is open — or asks you to "ping" something or "test" a connection — call ping_host (ICMP reachability + latency) or test_net_connection (TCP host:port check, like Test-NetConnection -Port). Prefer test_net_connection when a specific service/port matters. These run from the reporting server, which can only reach devices it has a network path to: internal/private IPs require the server to be on the SCCC network or VPN, so an off-network probe may come back unreachable — if so, say the server likely isn't on-network rather than declaring the device down. Report the concrete result (reachable/open, latency) in plain language.

You have a persistent memory: the SCCC Environment Knowledge Base below. Use it to give SCCC-specific answers instead of generic IT advice. When the user tells you a durable new fact about the environment (a device, configuration, procedure, contact, or policy) or explicitly asks you to remember something, call the save_memory tool to persist it. Never save secrets or passwords.
${knowledgeContext ? `\n# SCCC Environment Knowledge Base\n${knowledgeContext}\n` : ""}
Current context (last ${lookbackDays} days):
${JSON.stringify(context, null, 2)}`;

      // The CIO's chat does not auto-capture work into their task list — only
      // when they explicitly ask for it in the message — so their reporting
      // conversations aren't silently turned into report items. (This route is
      // CIO-only; ordinary staff capture via other chat surfaces.)
      const lastUserMsg = [...chatMessages].reverse().find((m: any) => m.role === "user")?.content ?? "";
      const authRole = (req as any).user?.role ?? null;
      const allowTaskCapture = authRole !== "cio" || messageRequestsCapture(lastUserMsg);

      const { reply, savedMemories, createdTasks, networkUpdates, savedShadowNotes, pendingNetworkChanges } =
        await runChatWithMemory(getOpenAI(), {
          model: "gpt-5.2",
          maxCompletionTokens: 4096,
          messages: [
            { role: "system", content: systemPrompt },
            ...chatMessages,
          ],
          userId: (req as any).user?.id ?? null,
          userRole: authRole,
          userName: (req as any).user?.name ?? null,
          allowTaskCapture,
          previewInventory: previewInventory === true,
        });

      return res.json({ reply, savedMemories, createdTasks, networkUpdates, savedShadowNotes, pendingNetworkChanges });
    } catch (error) {
      console.error("AI chat error:", error);
      return res.status(500).json({
        error: "Failed to get AI response",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

// ---- AI Red Flags ----------------------------------------------------------
// CIO-only. Scans a week's operational data and produces a structured list of
// "red flags" plus three ready-to-use formats: a report narrative block, a
// Risks & Issues entry, and a concise alert note. This endpoint only READS data
// and returns text — it never writes reports, risks, or notes itself; the CIO
// promotes the output using the existing endpoints.
function isoWeekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7;
  const monday = new Date(dt.getTime() - (dow - 1) * 86400000);
  return monday.toISOString().slice(0, 10);
}

const SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

router.post("/red-flags", requireAuth, requireCIO, async (req: Request, res: Response) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ error: "AI service is not configured." });
  }
  try {
    const rawWeek = typeof req.body?.weekOf === "string" ? req.body.weekOf : "";
    const weekOf = /^\d{4}-\d{2}-\d{2}$/.test(rawWeek)
      ? isoWeekStart(rawWeek)
      : isoWeekStart(new Date().toISOString().slice(0, 10));
    const weekEnd = new Date(new Date(weekOf + "T00:00:00Z").getTime() + 7 * 86400000)
      .toISOString()
      .slice(0, 10);

    const [tasksData, entriesData, risksData, aarData, projectsData] = await Promise.all([
      db
        .select({
          id: logItemsTable.id,
          title: logItemsTable.title,
          category: logItemsTable.category,
          itemDate: logItemsTable.itemDate,
        })
        .from(logItemsTable)
        .where(eq(logItemsTable.weekOf, weekOf))
        .limit(300),
      db
        .select({
          id: entriesTable.id,
          title: entriesTable.title,
          category: entriesTable.category,
          challenges: entriesTable.challenges,
          description: entriesTable.description,
        })
        .from(entriesTable)
        .where(eq(entriesTable.weekOf, weekOf))
        .limit(100),
      db
        .select({
          id: risksTable.id,
          type: risksTable.type,
          severity: risksTable.severity,
          status: risksTable.status,
          title: risksTable.title,
          description: risksTable.description,
          relatedBuilding: risksTable.relatedBuilding,
        })
        .from(risksTable)
        .where(ne(risksTable.status, "closed"))
        .limit(80),
      db
        .select({
          id: afterActionReportsTable.id,
          title: afterActionReportsTable.title,
          severity: afterActionReportsTable.severity,
          status: afterActionReportsTable.status,
          incident: afterActionReportsTable.incident,
        })
        .from(afterActionReportsTable)
        .where(
          or(
            ne(afterActionReportsTable.status, "closed"),
            and(
              gte(afterActionReportsTable.incidentDate, new Date(weekOf + "T00:00:00Z")),
              lte(afterActionReportsTable.incidentDate, new Date(weekEnd + "T00:00:00Z")),
            ),
          ),
        )
        .limit(60),
      db
        .select({
          id: projectsTable.id,
          title: projectsTable.title,
          status: projectsTable.status,
          progress: projectsTable.progress,
          targetDate: projectsTable.targetDate,
        })
        .from(projectsTable)
        .where(notInArray(projectsTable.status, ["completed", "cancelled"]))
        .limit(100),
    ]);

    const knowledgeContext = await getKnowledgeContext();
    const context = {
      weekOf,
      weekEnd,
      thisWeekTasks: tasksData,
      thisWeekEntries: entriesData,
      currentlyOpenRisksAndIssues: risksData,
      openOrThisWeekIncidents: aarData,
      activeProjects: projectsData,
    };

    const systemPrompt = `You are the CIO's private analyst for the Seward County Community College IT Department. Review the operational data for the week of ${weekOf} and identify the most important "red flags" — risks, slipping projects, recurring problems, unresolved incidents, capacity/coverage gaps, or anything the CIO should proactively call out before finalizing the weekly executive report. Be specific and grounded strictly in the provided data; do not invent facts, and if the week is quiet, return few or zero flags. Note on the data: "thisWeekTasks"/"thisWeekEntries" are scoped to this week, while "currentlyOpenRisksAndIssues", "openOrThisWeekIncidents", and "activeProjects" reflect current outstanding state (they may have originated earlier) — treat a still-open risk or slipping project as a live red flag regardless of when it started.

Return ONLY a JSON object with this exact shape:
{
  "flags": [
    { "title": string, "detail": string, "severity": "low"|"medium"|"high"|"critical", "source": string }
  ],
  "narrative": string,
  "alertNote": string
}
- "flags": up to 6 concise items, most important first. "source" briefly names the record(s) it came from (e.g. "Risk: <title>", "PIR: <title>", "Project: <title>").
- "narrative": a short Markdown block (a lead sentence plus bullet points) the CIO can paste directly into the weekly report under a "Risks & Red Flags" heading.
- "alertNote": one tight paragraph (2-4 sentences) written as an at-a-glance alert for the CIO.
Keep it professional and executive-ready. Do not include secrets, credentials, or personal login details.${knowledgeContext ? `\n\n# SCCC Environment Knowledge Base (reference)\n${knowledgeContext}` : ""}`;

    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Operational data for the week:\n${JSON.stringify(context, null, 2)}`,
        },
      ],
    });

    let parsed: any = {};
    try {
      parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    } catch {
      parsed = {};
    }

    const rawFlags = Array.isArray(parsed.flags) ? parsed.flags : [];
    const flags = rawFlags
      .map((f: any) => {
        const sev = String(f?.severity ?? "medium").toLowerCase();
        return {
          title: String(f?.title ?? "").trim().slice(0, 300),
          detail: String(f?.detail ?? "").trim().slice(0, 2000),
          severity: SEVERITY_RANK[sev] ? sev : "medium",
          source: String(f?.source ?? "").trim().slice(0, 300),
        };
      })
      .filter((f: any) => f.title.length > 0)
      .slice(0, 6);

    const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim() : "";
    const alertNote = typeof parsed.alertNote === "string" ? parsed.alertNote.trim() : "";

    // Derive a ready-to-create Risks & Issues entry from the flags.
    const topSeverity = flags.reduce(
      (max: string, f: any) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[max] ? f.severity : max),
      "low",
    );
    const riskEntry =
      flags.length > 0
        ? {
            type: "issue" as const,
            severity: topSeverity,
            title: `AI Red Flags — week of ${weekOf}`,
            description: flags
              .map((f: any) => `[${f.severity.toUpperCase()}] ${f.title}: ${f.detail}${f.source ? ` (${f.source})` : ""}`)
              .join("\n\n"),
          }
        : null;

    return res.json({ weekOf, flags, narrative, alertNote, riskEntry });
  } catch (error) {
    console.error("AI red-flags error:", error);
    return res.status(500).json({
      error: "Failed to generate red flags",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
