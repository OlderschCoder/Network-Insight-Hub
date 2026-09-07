import type OpenAI from "openai";
import {
  aiKnowledgeTable,
  afterActionReportsTable,
  db,
  entriesTable,
  reportsTable,
} from "@workspace/db";
import { and, eq, ilike, or, sql } from "drizzle-orm";

export type FredActor = {
  id: number | null;
  name?: string | null;
  role?: string | null;
};

const confirmationProperty = {
  type: "boolean",
  description:
    "Must be true only after the user explicitly confirms this exact write action.",
} as const;

function actorRole(actor: FredActor): string {
  return String(actor.role || "")
    .trim()
    .toLowerCase();
}

export function canManageOwnedRecord(
  actor: FredActor,
  ownerId: number,
): boolean {
  return (
    actor.id != null && (actor.id === ownerId || actorRole(actor) === "cio")
  );
}

export function canManageWeeklyReports(actor: FredActor): boolean {
  return actor.id != null && actorRole(actor) === "cio";
}

export function confirmedWrite(args: Record<string, unknown>): boolean {
  return args.confirmed === true;
}

function parseArgs(rawArgs: string): Record<string, any> {
  const value = JSON.parse(rawArgs || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object.");
  }
  return value;
}

function cleanText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function cleanNumberArray(value: unknown): number[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value))
    throw new Error("Expected an array of record ids.");
  return Array.from(
    new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0)),
  );
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new Error("Expected a text array.");
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function requireActor(actor: FredActor): number {
  if (actor.id == null) throw new Error("An authenticated user is required.");
  return actor.id;
}

function requireConfirmation(args: Record<string, unknown>): string | null {
  return confirmedWrite(args)
    ? null
    : "Confirmation required. Show the exact record and proposed changes, then ask the user to confirm before writing.";
}

function zendeskConfig() {
  const subdomain = process.env.ZENDESK_SUBDOMAIN?.trim();
  const email = process.env.ZENDESK_EMAIL?.trim();
  const token = process.env.ZENDESK_API_TOKEN?.trim();
  if (!subdomain || !email || !token) return null;
  return {
    base: `https://${subdomain}.zendesk.com/api/v2`,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}/token:${token}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
  };
}

async function zendeskFetch<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const cfg = zendeskConfig();
  if (!cfg) throw new Error("Zendesk is not configured on this server.");
  const response = await fetch(`${cfg.base}/${path}`, {
    method,
    headers: cfg.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Zendesk ${response.status}: ${detail.slice(0, 200)}`);
  }
  return response.json() as Promise<T>;
}

async function resolveZendeskAgent(email: string): Promise<number> {
  const data = await zendeskFetch<{ users?: Array<{ id: number }> }>(
    "GET",
    `users/search.json?query=${encodeURIComponent(`email:${email}`)}`,
  );
  const id = data.users?.[0]?.id;
  if (!id) throw new Error(`No Zendesk agent found for ${email}.`);
  return id;
}

export const ZENDESK_CREATE_TICKET_TOOL: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: "zendesk_create_ticket",
      description:
        "Create a Zendesk support ticket. Present the subject, requester, priority, assignment, and initial public description first. Call only after the user explicitly confirms that exact ticket.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string" },
          body: {
            type: "string",
            description: "Initial public ticket description.",
          },
          requester_email: { type: "string" },
          requester_name: { type: "string" },
          assignee_email: { type: "string" },
          priority: {
            type: "string",
            enum: ["urgent", "high", "normal", "low"],
          },
          ticket_type: {
            type: "string",
            enum: ["question", "incident", "problem", "task"],
          },
          tags: { type: "array", items: { type: "string" } },
          confirmed: confirmationProperty,
        },
        required: ["subject", "body", "confirmed"],
      },
    },
  };

export const ZENDESK_SOLVE_TICKETS_TOOL: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: "zendesk_solve_tickets",
      description:
        "Mark a confirmed, explicit list of Zendesk tickets as solved. Zendesk performs final irreversible closure later through its automation. Never interpret an unbounded phrase like 'all tickets' as permission: search first, show the exact IDs, and require confirmation. Maximum 25 IDs per call.",
      parameters: {
        type: "object",
        properties: {
          ticket_ids: {
            type: "array",
            items: { type: "number" },
            maxItems: 25,
          },
          confirmed: confirmationProperty,
        },
        required: ["ticket_ids", "confirmed"],
      },
    },
  };

export async function executeZendeskCreateTicket(
  rawArgs: string,
): Promise<string> {
  const args = parseArgs(rawArgs);
  const confirmationError = requireConfirmation(args);
  if (confirmationError) return confirmationError;
  const subject = cleanText(args.subject);
  const body = cleanText(args.body);
  if (!subject || !body) return "Error: subject and body are required.";

  const ticket: Record<string, unknown> = {
    subject,
    comment: { body, public: true },
  };
  if (cleanText(args.priority)) ticket.priority = cleanText(args.priority);
  if (cleanText(args.ticket_type)) ticket.type = cleanText(args.ticket_type);
  const tags = cleanStringArray(args.tags);
  if (tags?.length) ticket.tags = tags;
  const requesterEmail = cleanText(args.requester_email);
  if (requesterEmail) {
    ticket.requester = {
      email: requesterEmail,
      name: cleanText(args.requester_name) || requesterEmail,
    };
  }
  const assigneeEmail = cleanText(args.assignee_email);
  if (assigneeEmail)
    ticket.assignee_id = await resolveZendeskAgent(assigneeEmail);

  const result = await zendeskFetch<{ ticket: { id: number; status: string } }>(
    "POST",
    "tickets.json",
    { ticket },
  );
  return `✓ Zendesk ticket #${result.ticket.id} created with status ${result.ticket.status}.`;
}

export async function executeZendeskSolveTickets(
  rawArgs: string,
): Promise<string> {
  const args = parseArgs(rawArgs);
  const confirmationError = requireConfirmation(args);
  if (confirmationError) return confirmationError;
  const ids = cleanNumberArray(args.ticket_ids) || [];
  if (ids.length === 0)
    return "Error: at least one explicit ticket id is required.";
  if (ids.length > 25)
    return "Error: at most 25 tickets can be solved in one confirmed batch.";

  const results = await Promise.allSettled(
    ids.map((id) =>
      zendeskFetch("PUT", `tickets/${id}.json`, {
        ticket: { status: "solved" },
      }),
    ),
  );
  const solved = ids.filter(
    (_, index) => results[index].status === "fulfilled",
  );
  const failed = ids.filter((_, index) => results[index].status === "rejected");
  return [
    `Solved ${solved.length} ticket${solved.length === 1 ? "" : "s"}${solved.length ? `: ${solved.map((id) => `#${id}`).join(", ")}` : ""}.`,
    failed.length
      ? `Failed ${failed.length}: ${failed.map((id) => `#${id}`).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const afterActionProperties = {
  title: { type: "string" },
  incident: { type: "string" },
  building: { type: "string" },
  device_type: { type: "string" },
  affected_systems: { type: "string" },
  timeline: { type: "string" },
  root_cause: { type: "string" },
  resolution: { type: "string" },
  lessons_learned: { type: "string" },
  prevention_measures: { type: "string" },
  status: { type: "string", enum: ["open", "resolved", "closed"] },
  severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
  zendesk_ticket_id: { type: ["number", "null"] },
  incident_date: { type: "string", description: "ISO date or datetime." },
} as const;

export const MANAGE_AFTER_ACTION_TOOL: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: "manage_post_incident_review",
      description:
        "Create or edit a Post-Incident Review, including every narrative, status, severity, system, building, date, and linked Zendesk field. A user may edit their own PIR; the CIO may edit any PIR. Show the exact change and call only after explicit confirmation.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update"] },
          id: { type: "number", description: "Required for update." },
          ...afterActionProperties,
          confirmed: confirmationProperty,
        },
        required: ["action", "confirmed"],
      },
    },
  };

function afterActionChanges(args: Record<string, any>) {
  const map: Array<[string, string]> = [
    ["title", "title"],
    ["incident", "incident"],
    ["building", "building"],
    ["device_type", "deviceType"],
    ["affected_systems", "affectedSystems"],
    ["timeline", "timeline"],
    ["root_cause", "rootCause"],
    ["resolution", "resolution"],
    ["lessons_learned", "lessonsLearned"],
    ["prevention_measures", "preventionMeasures"],
    ["status", "status"],
    ["severity", "severity"],
    ["zendesk_ticket_id", "zendeskTicketId"],
  ];
  const changes: Record<string, unknown> = {};
  for (const [source, target] of map) {
    if (Object.prototype.hasOwnProperty.call(args, source))
      changes[target] = args[source];
  }
  if (args.incident_date !== undefined) {
    const date = new Date(String(args.incident_date));
    if (Number.isNaN(date.getTime()))
      throw new Error("incident_date is invalid.");
    changes.incidentDate = date;
  }
  return changes;
}

export async function executeManageAfterAction(
  rawArgs: string,
  actor: FredActor,
): Promise<string> {
  const args = parseArgs(rawArgs);
  const confirmationError = requireConfirmation(args);
  if (confirmationError) return confirmationError;
  const actorId = requireActor(actor);
  const changes = afterActionChanges(args);

  if (args.action === "create") {
    const title = cleanText(changes.title);
    const incident = cleanText(changes.incident);
    if (!title || !incident)
      return "Error: title and incident are required to create a PIR.";
    const [created] = await db
      .insert(afterActionReportsTable)
      .values({
        ...changes,
        title,
        incident,
        userId: actorId,
        severity: cleanText(changes.severity) || "medium",
        status: cleanText(changes.status) || "open",
      } as any)
      .returning();
    return `✓ Post-Incident Review #${created.id} created: ${created.title}. Open /after-action/${created.id}`;
  }

  if (args.action !== "update")
    return "Error: action must be create or update.";
  const id = Number(args.id);
  if (!Number.isInteger(id) || id < 1)
    return "Error: a valid PIR id is required for update.";
  const [existing] = await db
    .select()
    .from(afterActionReportsTable)
    .where(eq(afterActionReportsTable.id, id));
  if (!existing) return `Error: Post-Incident Review #${id} was not found.`;
  if (!canManageOwnedRecord(actor, existing.userId))
    return "Error: you may edit only your own PIRs unless you are the CIO.";
  if (Object.keys(changes).length === 0)
    return "Error: no PIR fields were provided.";
  if (
    (changes.status === "resolved" || changes.status === "closed") &&
    !existing.resolvedAt
  ) {
    changes.resolvedAt = new Date();
  }
  const [updated] = await db
    .update(afterActionReportsTable)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(afterActionReportsTable.id, id))
    .returning();
  return `✓ Post-Incident Review #${updated.id} updated. Open /after-action/${updated.id}`;
}

export const MANAGE_WEEKLY_LOG_TOOL: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: "manage_weekly_log",
      description:
        "Create or edit a weekly log entry. Staff may manage their own entry; the CIO may edit any entry by id. Supports all narrative, category, submission, tag, completed-item, and Zendesk-link fields. Show the exact change and call only after explicit confirmation.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update"] },
          id: { type: "number", description: "Required for update." },
          week_of: { type: "string", description: "YYYY-MM-DD Monday." },
          category: {
            type: "string",
            enum: ["helpdesk", "network", "security", "general"],
          },
          title: { type: "string" },
          description: { type: "string" },
          accomplishments: { type: "string" },
          challenges: { type: "string" },
          support_needed: { type: "string" },
          entry_date: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          completed_items: { type: "array", items: { type: "object" } },
          zendesk_ticket_ids: { type: "array", items: { type: "number" } },
          is_submitted: { type: "boolean" },
          confirmed: confirmationProperty,
        },
        required: ["action", "confirmed"],
      },
    },
  };

function weeklyLogChanges(args: Record<string, any>) {
  const changes: Record<string, any> = {};
  const textMap: Array<[string, string]> = [
    ["week_of", "weekOf"],
    ["category", "category"],
    ["title", "title"],
    ["description", "description"],
    ["accomplishments", "accomplishments"],
    ["challenges", "challenges"],
    ["support_needed", "supportNeeded"],
    ["entry_date", "entryDate"],
  ];
  for (const [source, target] of textMap) {
    if (args[source] !== undefined) changes[target] = String(args[source]);
  }
  if (args.tags !== undefined) changes.tags = cleanStringArray(args.tags) || [];
  if (args.completed_items !== undefined) {
    if (!Array.isArray(args.completed_items))
      throw new Error("completed_items must be an array.");
    changes.completedItems = args.completed_items;
  }
  if (args.zendesk_ticket_ids !== undefined) {
    changes.zendeskTicketIds = cleanNumberArray(args.zendesk_ticket_ids) || [];
    changes.ticketCount = changes.zendeskTicketIds.length;
  }
  if (args.is_submitted !== undefined)
    changes.isSubmitted = args.is_submitted === true;
  return changes;
}

async function linkWeeklyItems(entry: {
  id: number;
  userId: number;
  weekOf: string;
}) {
  await db.execute(sql`
    UPDATE log_items
       SET weekly_entry_id = ${entry.id}
     WHERE user_id = ${entry.userId}
       AND week_of = ${entry.weekOf}
       AND (weekly_entry_id IS NULL OR weekly_entry_id = ${entry.id})
  `);
}

export async function executeManageWeeklyLog(
  rawArgs: string,
  actor: FredActor,
): Promise<string> {
  const args = parseArgs(rawArgs);
  const confirmationError = requireConfirmation(args);
  if (confirmationError) return confirmationError;
  const actorId = requireActor(actor);
  const changes = weeklyLogChanges(args);

  if (args.action === "create") {
    const weekOf = cleanText(changes.weekOf);
    if (!weekOf) return "Error: week_of is required to create a weekly log.";
    const values = {
      ...changes,
      userId: actorId,
      weekOf,
      category: cleanText(changes.category) || "general",
      title: cleanText(changes.title) || `Weekly Log – week of ${weekOf}`,
      description: cleanText(changes.description) || "Weekly activity summary",
      tags: changes.tags || [],
      completedItems: changes.completedItems || [],
      zendeskTicketIds: changes.zendeskTicketIds || [],
      ticketCount: changes.ticketCount || 0,
    };
    const [entry] = await db
      .insert(entriesTable)
      .values(values as any)
      .onConflictDoUpdate({
        target: [entriesTable.userId, entriesTable.weekOf],
        set: { ...changes, updatedAt: new Date() },
      })
      .returning();
    await linkWeeklyItems(entry);
    return `✓ Weekly log #${entry.id} saved for ${entry.weekOf}. Open /entries/${entry.id}`;
  }

  if (args.action !== "update")
    return "Error: action must be create or update.";
  const id = Number(args.id);
  if (!Number.isInteger(id) || id < 1)
    return "Error: a valid weekly log id is required for update.";
  const [existing] = await db
    .select()
    .from(entriesTable)
    .where(eq(entriesTable.id, id));
  if (!existing) return `Error: Weekly log #${id} was not found.`;
  if (!canManageOwnedRecord(actor, existing.userId))
    return "Error: you may edit only your own weekly log unless you are the CIO.";
  if (Object.keys(changes).length === 0)
    return "Error: no weekly-log fields were provided.";
  const [entry] = await db
    .update(entriesTable)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(entriesTable.id, id))
    .returning();
  await linkWeeklyItems(entry);
  return `✓ Weekly log #${entry.id} updated. Open /entries/${entry.id}`;
}

export const MANAGE_WEEKLY_REPORT_TOOL: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: "manage_weekly_status_report",
      description:
        "CIO-only: create, edit, or finalize a department weekly status report, including all narrative, selection, inclusion, project, risk, PIR, maintenance, recipient, and custom-task fields. Show the exact change and call only after explicit confirmation.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update", "finalize"] },
          id: {
            type: "number",
            description: "Required for update or finalize.",
          },
          week_of: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          accomplishments: { type: "string" },
          challenges: { type: "string" },
          strategic_progress: { type: "string" },
          next_week_plans: { type: "string" },
          selected_item_ids: {
            type: ["array", "null"],
            items: { type: "number" },
          },
          custom_tasks: { type: "array", items: { type: "object" } },
          project_ids: { type: "array", items: { type: "number" } },
          selected_after_action_ids: {
            type: ["array", "null"],
            items: { type: "number" },
          },
          selected_maintenance_ids: {
            type: ["array", "null"],
            items: { type: "string" },
          },
          selected_risk_ids: {
            type: ["array", "null"],
            items: { type: "number" },
          },
          include_goal_progress: { type: "boolean" },
          include_open_risks: { type: "boolean" },
          include_cloud_inventory: { type: "boolean" },
          email_recipients: { type: "array", items: { type: "string" } },
          confirmed: confirmationProperty,
        },
        required: ["action", "confirmed"],
      },
    },
  };

function weeklyReportChanges(args: Record<string, any>) {
  const changes: Record<string, any> = {};
  const directMap: Array<[string, string]> = [
    ["week_of", "weekOf"],
    ["title", "title"],
    ["summary", "summary"],
    ["accomplishments", "accomplishments"],
    ["challenges", "challenges"],
    ["strategic_progress", "strategicProgress"],
    ["next_week_plans", "nextWeekPlans"],
    ["custom_tasks", "customTasks"],
    ["include_goal_progress", "includeGoalProgress"],
    ["include_open_risks", "includeOpenRisks"],
    ["include_cloud_inventory", "includeCloudInventory"],
  ];
  for (const [source, target] of directMap) {
    if (args[source] !== undefined) changes[target] = args[source];
  }
  const numberArrays: Array<[string, string]> = [
    ["selected_item_ids", "selectedItemIds"],
    ["project_ids", "projectIds"],
    ["selected_after_action_ids", "selectedAfterActionIds"],
    ["selected_risk_ids", "selectedRiskIds"],
  ];
  for (const [source, target] of numberArrays) {
    if (args[source] !== undefined) {
      changes[target] =
        args[source] === null ? null : cleanNumberArray(args[source]);
    }
  }
  if (args.selected_maintenance_ids !== undefined) {
    changes.selectedMaintenanceIds =
      args.selected_maintenance_ids === null
        ? null
        : cleanStringArray(args.selected_maintenance_ids);
  }
  if (args.email_recipients !== undefined) {
    changes.emailRecipients = cleanStringArray(args.email_recipients) || [];
  }
  return changes;
}

export async function executeManageWeeklyReport(
  rawArgs: string,
  actor: FredActor,
): Promise<string> {
  const args = parseArgs(rawArgs);
  const confirmationError = requireConfirmation(args);
  if (confirmationError) return confirmationError;
  const actorId = requireActor(actor);
  if (!canManageWeeklyReports(actor))
    return "Error: only the CIO can manage weekly status reports.";
  const changes = weeklyReportChanges(args);

  if (args.action === "create") {
    const weekOf = cleanText(changes.weekOf);
    if (!weekOf)
      return "Error: week_of is required to create a weekly status report.";
    const [report] = await db
      .insert(reportsTable)
      .values({
        ...changes,
        weekOf,
        createdBy: actorId,
        status: "draft",
      } as any)
      .returning();
    return `✓ Weekly status report #${report.id} created for ${report.weekOf}. Open /reports/${report.id}`;
  }

  if (args.action !== "update" && args.action !== "finalize") {
    return "Error: action must be create, update, or finalize.";
  }
  const id = Number(args.id);
  if (!Number.isInteger(id) || id < 1)
    return "Error: a valid report id is required.";
  const [existing] = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.id, id));
  if (!existing) return `Error: Weekly status report #${id} was not found.`;
  if (args.action === "finalize") {
    changes.status = "finalized";
    changes.finalizedAt = new Date();
  }
  if (Object.keys(changes).length === 0)
    return "Error: no weekly-report fields were provided.";
  const [report] = await db
    .update(reportsTable)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(reportsTable.id, id))
    .returning();
  return `✓ Weekly status report #${report.id} ${args.action === "finalize" ? "finalized" : "updated"}. Open /reports/${report.id}`;
}

export const APPLICATION_GUIDANCE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: "get_application_guidance",
      description:
        "Read the current, seeded step-by-step guidance for the SCCC IT Portal. Use for navigation, permissions, workflows, or any 'how do I use this app?' question instead of guessing from an old interface.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "Optional feature or workflow to narrow the guide.",
          },
        },
        required: [],
      },
    },
  };

export async function executeApplicationGuidance(
  rawArgs: string,
): Promise<string> {
  const args = parseArgs(rawArgs);
  const topic = cleanText(args.topic);
  const conditions = [
    eq(aiKnowledgeTable.source, "seed"),
    eq(aiKnowledgeTable.isActive, true),
    ...(topic
      ? [
          or(
            ilike(aiKnowledgeTable.title, `%${topic}%`),
            ilike(aiKnowledgeTable.content, `%${topic}%`),
          )!,
        ]
      : []),
  ];
  const rows = await db
    .select({
      title: aiKnowledgeTable.title,
      content: aiKnowledgeTable.content,
    })
    .from(aiKnowledgeTable)
    .where(and(...conditions))
    .limit(20);
  if (!rows.length)
    return `No application guidance matched ${topic ? `“${topic}”` : "that request"}.`;
  return rows.map((row) => `## ${row.title}\n${row.content}`).join("\n\n");
}

export function fredApplicationToolsForRole(
  role?: string | null,
  zendeskConfigured = true,
) {
  return [
    ...(zendeskConfigured
      ? [ZENDESK_CREATE_TICKET_TOOL, ZENDESK_SOLVE_TICKETS_TOOL]
      : []),
    MANAGE_AFTER_ACTION_TOOL,
    MANAGE_WEEKLY_LOG_TOOL,
    APPLICATION_GUIDANCE_TOOL,
    ...(String(role || "")
      .trim()
      .toLowerCase() === "cio"
      ? [MANAGE_WEEKLY_REPORT_TOOL]
      : []),
  ];
}
