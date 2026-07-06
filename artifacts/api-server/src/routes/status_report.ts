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
  usersTable,
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

      const knowledgeContext = await getKnowledgeContext(undefined, (req as any).user?.id ?? null);
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
  async (req: Request, res: Response) => {
    if (!isAIConfigured()) {
      return res.status(503).json({ error: "AI service is not configured." });
    }
    try {
      const { messages: chatMessages = [], lookbackDays: rawLookback = 90, previewInventory = false } = req.body ?? {};

      if (!Array.isArray(chatMessages) || chatMessages.length === 0) {
        return res.status(400).json({ error: "messages array required" });
      }

      // Validate message shape — content may be a string or a vision array (image + text parts)
      const validRoles = new Set(["user", "assistant", "system"]);
      for (const m of chatMessages) {
        if (!m || typeof m !== "object" || !validRoles.has(m.role)) {
          return res.status(400).json({ error: "each message must have role (user|assistant|system)" });
        }
        if (typeof m.content !== "string" && !Array.isArray(m.content)) {
          return res.status(400).json({ error: "message content must be a string or content-part array" });
        }
      }

      const lookbackDays = Math.max(1, Math.min(365, Number(rawLookback) || 90));
      const since = new Date();
      since.setDate(since.getDate() - lookbackDays);
      const sinceStr = since.toISOString().slice(0, 10);
      // Team items: always pull last 7 days for all users (gives Fred current team context)
      const teamItemsDate = new Date();
      teamItemsDate.setDate(teamItemsDate.getDate() - 7);
      const teamItemsSince = teamItemsDate.toISOString().slice(0, 10);

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
            userName: usersTable.name,
            userRole: usersTable.role,
          })
          .from(entries)
          .innerJoin(usersTable, eq(entries.userId, usersTable.id))
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
            notes: logItemsTable.notes,
            itemDate: logItemsTable.itemDate,
            weekOf: logItemsTable.weekOf,
            userName: usersTable.name,
            userRole: usersTable.role,
          })
          .from(logItemsTable)
          .innerJoin(usersTable, eq(logItemsTable.userId, usersTable.id))
          .where(gte(logItemsTable.itemDate, teamItemsSince))
          .orderBy(logItemsTable.itemDate)
          .limit(300),
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
        // Team items: last 7 days, all users, with names — gives Fred current team activity
        teamRecentItems: tasksData,
        networkInventory: {
          switchCount: switchRows.length,
          vlanCount: vlanRows.length,
          buildings: networkByBuilding,
        },
      };

      const knowledgeContext = await getKnowledgeContext(undefined, (req as any).user?.id ?? null);

      const authUser = (req as any).user;
      const identityLine = authUser
        ? `You are currently assisting ${authUser.name || authUser.email}${authUser.email ? ` (${authUser.email})` : ""} — their role is "${authUser.role}"${authUser.jobTitle ? `, job title "${authUser.jobTitle}"` : ""}. You already know who they are, so never ask; address them by first name when natural and attribute anything they report (work done, updates, requests) to this person.`
        : "";

      const systemPrompt = `You are Fred — the SCCC IT Department's embedded AI. Think of yourself as the team's most experienced colleague: you've been here long enough to know every switch by hostname, every building by its quirks, and every recurring ticket by its real cause. You're direct, occasionally dry, always useful. You don't pad answers with disclaimers or corporate hedging. When something is clearly down, you say it's down. When a fix is obvious, you give it without a lecture. When you don't know, you say so in one sentence and move on.

You serve the whole team — help desk, network engineers, security, and Dr. Mark (CIO). You have access to the department's full operational picture: weekly log entries, tasks, risks, after-action reviews, projects, strategic objectives, the complete network inventory (every switch and VLAN, by building, with IPs and status), Azure infrastructure, and persistent memory the team has built up over time. You do NOT have access to credentials, passwords, or tokens — if someone pastes one, redact it silently and keep going.
${identityLine ? `\n${identityLine}\n` : ""}
**Tone:** Confident but not arrogant. Concise — one clear answer beats three hedged ones. A little dry humor is fine when the situation calls for it (3am outage banter, for instance). Never sycophantic. Never say "Great question!" Skip the filler. Get to the point.

Help the team understand data, diagnose problems, draft reports, capture work, and stay ahead of issues. For network questions — buildings, switches, VLANs, IPs, subnets — use the inventory. For Azure — use the live tools. For "what was that thing we fixed last month" — check memory and team work history before saying you don't know.

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

You keep the network inventory current as the team works. When any team member reports a real change — a switch replaced, moved, renamed, went online or offline, got a new IP or model; or a VLAN added, renamed, resubnetted — call upsert_switch or upsert_vlan immediately so the record stays accurate. Don't wait to be asked. Identify a switch by its hostname, a VLAN by its numeric id. The only rule: base updates on what the user actually states, never on inference or assumptions. If a hostname or VLAN id is missing and you can't derive it from context, ask just that one thing — don't ask for everything at once.

You can run live network diagnostics yourself — no need to ask the user to do it. Tools available:
- **ping_host** — ICMP reachability + round-trip time
- **test_net_connection** — TCP port open/closed check (use for services: 80, 443, 3389, 22, etc.)
- **scan_network** — sweep a subnet for live hosts
- **dns_lookup** — resolve hostname→IP or IP→hostname, any record type (A, MX, TXT, PTR…)
- **traceroute** — hop-by-hop path from the Fred server; useful when ping works but service doesn't
- **http_check** — GET/HEAD a URL and get the HTTP status + response time; confirms web service layer
- **ssl_check** — TLS cert expiry, issuer, SANs; flags certs expiring within 30 days automatically
- **snmp_get** — read-only SNMP query for switch uptime, interface status, errors (internal IPs only — needs appserver on internal subnet)

Important: these all run **from the Fred server**, not the user's machine. Public targets work now. Internal/private IPs (10.x, 192.168.x) will fail until the appserver moves to the internal subnet — when that happens say "server isn't on-network yet" rather than declaring the device down. Run the diagnostic first, report the concrete result, then interpret it.

When something is down, don't assume the person you're helping is standing in front of the gear — the team travels and works remotely, so whoever reports an outage may be hundreds of miles away. Work out where they are (ask if it's unclear) and adapt:
- If they are REMOTE: first size up the blast radius from the inventory and memory below — which building, uplinks, VLANs, and dependent devices that switch/segment feeds, and what is likely affected. Run a live on-prem sweep with scan_network (optionally scoped to the affected building) to see exactly which switches are UP vs DOWN right now, and probe specific hosts with ping_host / test_net_connection; cross-check live results against the recorded status to spot what actually changed. Then help them act at a distance: what they can verify from where they are (monitoring, other reachable switches, the FortiGate, upstream), and — when hands-on work is unavoidable — identify who is onsite or nearest and delegate it with create_task (assignee = that teammate), spelling out the exact checks and commands to run, so the outage gets worked even though the reporter can't touch the device.
- If they are ONSITE: be a hands-on partner and walk them through it one concrete step at a time: exact commands to run on their machine or the device console (Windows: \`ipconfig /all\`, \`ping <host>\`, \`tracert <host>\`, \`nslookup <host>\`, \`Test-NetConnection -ComputerName <host> -Port <port>\`; Cisco/Nexus: \`show interface status\`, \`show ip interface brief\`, \`show mac address-table\`, \`show cdp neighbors\`, \`show logging\`) plus physical checks (link/activity lights, cable seating, correct port and VLAN, power, SFP fully seated). Ask them to paste the output back, interpret it, and give the next step.
Either way: pull in how a teammate solved the same symptom before if it's in memory, and give one clear action at a time, not a wall of commands.

## Device Configuration Backups

You have access to stored backup configuration files for network devices — FortiGate firewalls, Aruba switches, and Cisco Nexus fiber distribution switches. Use **query_device_config** whenever someone asks:
- How a device is configured ("what VLANs are on SW-DIST-01?", "what are the trunk ports on the Nexus?")
- How to recover a failed device ("SW-DIST-01 is dead — what do I need to rebuild it?")
- Whether a feature is enabled ("is OSPF configured on the firewall?", "what's the SNMP config?")
- Anything requiring actual config detail — don't guess when the config is stored

Secrets (passwords, PSKs, SNMP communities) are automatically redacted in your responses. Network-role users can download the full unredacted file via the UI if needed for actual recovery work.

If someone uploads a config file via the chat paperclip, recognize it as a device config (check filename extension: .conf, .cfg, .txt with FortiGate/Aruba/Nexus content) and offer to save it — ask for the device name and any notes, then POST it to /api/network/configs.

## Azure — on-demand incident assistant

You have live access to the SCCC Azure subscription. Use these tools any time someone asks about cloud resources, not just during incidents:

- **query_azure_vm** — live VM power state (running/stopped/deallocated), IPs, size, OS
- **query_azure_resources** — full resource inventory by type or resource group (storage, SQL, App Services, Key Vault, etc.)
- **query_azure_health** — real-time Resource Health (Available/Degraded/Unavailable) — call this first in any Azure-related outage
- **query_azure_security** — live Defender for Cloud alerts by severity — call this for any security concern or during incident triage
- **query_azure_policy** — non-compliant resources by policy — call this for compliance/audit questions

**During an Azure incident or downtime event**, run this triage sequence without waiting to be asked:
1. query_azure_health (unhealthy_only=true) — is Azure itself degraded for our resources?
2. query_azure_vm — are the affected VMs still running?
3. query_azure_security — are there active High/Medium alerts tied to this?
4. query_azure_policy — any compliance drift that could explain access or config failures?
Then synthesize into a clear picture: platform issue vs. config issue vs. security event, with the next action for the person you're helping — even if it's 3am and they're remote.

## Memory

You have two memory scopes — use both proactively:

**Team memory** (scope: "team") — shared with the whole IT staff. Save anything about the SCCC environment that any teammate might need: device hostnames/IPs, config decisions, procedures, vendor contacts, policies, lessons learned, known issues, recurring problems. If a team member tells you something that would help a colleague next week, save it to team memory immediately without being asked.

**Personal memory** (scope: "personal") — private to the individual user, never shown to other staff. Save individual preferences, working styles, shortcuts, or context a person explicitly wants Fred to remember just for them. If someone says "remember that I prefer..." or "just for me, note that..." — save it personal.

Either way: save immediately, don't wait to be asked. Keep entries tight (1-3 sentences). Never save secrets, passwords, or credentials. The knowledge base below is what the team has built up — use it for SCCC-specific answers before falling back to generic IT knowledge.
${knowledgeContext ? `\n# SCCC Environment Knowledge Base\n${knowledgeContext}\n` : ""}
Current context (last ${lookbackDays} days):
${JSON.stringify(context, null, 2)}`;

      const authRole = (req as any).user?.role ?? null;
      const allowTaskCapture = true; // all roles — Fred captures work and delegates tasks for the whole team

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
