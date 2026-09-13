import type OpenAI from "openai";
import {
  aiKnowledgeTable,
  afterActionReportsTable,
  db,
  entriesTable,
  reportsTable,
  teamTodosTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  canAccessTodo,
  canManageTeamTodos,
  todoAssigneeForCreate,
  type TodoActor,
} from "./team_todo_policy";
import {
  findFredApplicationPages,
  renderFredApplicationPage,
} from "./fred_app_catalog";

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

export const QUERY_TEAM_TODOS_TOOL: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: "query_team_todos",
      description:
        "List the to-dos the signed-in user is allowed to see. Mark and Tracy may see the whole team; everyone else receives only their own items. Use this before completing, editing, or reassigning a to-do when its exact id is not already known.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional title/details search text.",
          },
          status: {
            type: "string",
            enum: ["active", "open", "in_progress", "completed", "all"],
            description: "Defaults to active (open and in progress).",
          },
          assignee: {
            type: "string",
            description:
              "Optional exact team member name or email. Available only to Mark and Tracy.",
          },
        },
        required: [],
      },
    },
  };

export const MANAGE_TEAM_TODO_TOOL: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: "manage_team_todo",
      description:
        "Create, edit, complete, or reassign a portal to-do. Reassignment is called 'move' in ordinary conversation. Resolve an existing item with query_team_todos first and show its exact id/title and every proposed change. Call only after explicit confirmation. Mark and Tracy may manage or reassign any team item; everyone else may create and manage only their own.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create", "update", "complete", "reassign"],
          },
          id: {
            type: "number",
            description: "Required for update, complete, or reassign.",
          },
          title: { type: "string" },
          details: { type: ["string", "null"] },
          due_date: {
            type: ["string", "null"],
            description: "YYYY-MM-DD or null to clear.",
          },
          priority: {
            type: "string",
            enum: ["low", "normal", "high", "urgent"],
          },
          status: {
            type: "string",
            enum: ["open", "in_progress", "completed"],
          },
          assignee: {
            type: "string",
            description:
              "Exact active team member name or email. Required for reassign; optional for create.",
          },
          confirmed: confirmationProperty,
        },
        required: ["action", "confirmed"],
      },
    },
  };

const TODO_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const TODO_STATUSES = new Set(["open", "in_progress", "completed"]);
const TODO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function todoTextError(title?: string, details?: string): string | null {
  if (title && title.length > 500)
    return "Error: a to-do title cannot exceed 500 characters.";
  if (details && details.length > 10_000)
    return "Error: to-do details cannot exceed 10,000 characters.";
  return null;
}

async function todoActor(actor: FredActor): Promise<TodoActor> {
  const actorId = requireActor(actor);
  const [user] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      canManageTodos: usersTable.canManageTodos,
    })
    .from(usersTable)
    .where(eq(usersTable.id, actorId));
  if (!user) throw new Error("The signed-in user was not found.");
  return user;
}

async function resolveTodoAssignee(reference: unknown) {
  const value = cleanText(reference);
  if (!value) return null;
  const exact = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.isActive, true),
        or(ilike(usersTable.name, value), ilike(usersTable.email, value)),
      ),
    );
  if (exact.length === 1) return exact[0];

  const matches = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.isActive, true),
        or(
          ilike(usersTable.name, `%${value}%`),
          ilike(usersTable.email, `%${value}%`),
        ),
      ),
    )
    .limit(6);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0)
    throw new Error(`No active team member matched “${value}”.`);
  throw new Error(
    `Assignee “${value}” is ambiguous. Choose one exact name or email: ${matches
      .map((user) => `${user.name} <${user.email}>`)
      .join(", ")}.`,
  );
}

export async function executeQueryTeamTodos(
  rawArgs: string,
  actor: FredActor,
): Promise<string> {
  const args = parseArgs(rawArgs);
  const policyActor = await todoActor(actor);
  const manager = canManageTeamTodos(policyActor);
  const requestedAssignee = args.assignee
    ? await resolveTodoAssignee(args.assignee)
    : null;
  if (
    requestedAssignee &&
    !manager &&
    requestedAssignee.id !== policyActor.id
  ) {
    return "Error: you may only view your own to-dos.";
  }

  const conditions: any[] = [];
  if (!manager) {
    conditions.push(eq(teamTodosTable.assigneeId, policyActor.id));
  } else if (requestedAssignee) {
    conditions.push(eq(teamTodosTable.assigneeId, requestedAssignee.id));
  }

  const status = cleanText(args.status) || "active";
  if (status === "active") {
    conditions.push(
      or(
        eq(teamTodosTable.status, "open"),
        eq(teamTodosTable.status, "in_progress"),
      )!,
    );
  } else if (["open", "in_progress", "completed"].includes(status)) {
    conditions.push(eq(teamTodosTable.status, status));
  } else if (status !== "all") {
    return "Error: status must be active, open, in_progress, completed, or all.";
  }

  const query = cleanText(args.query);
  if (query) {
    conditions.push(
      or(
        ilike(teamTodosTable.title, `%${query}%`),
        ilike(teamTodosTable.details, `%${query}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: teamTodosTable.id,
      title: teamTodosTable.title,
      details: teamTodosTable.details,
      status: teamTodosTable.status,
      priority: teamTodosTable.priority,
      dueDate: teamTodosTable.dueDate,
      assigneeId: teamTodosTable.assigneeId,
      assigneeName: usersTable.name,
      updatedAt: teamTodosTable.updatedAt,
    })
    .from(teamTodosTable)
    .leftJoin(usersTable, eq(teamTodosTable.assigneeId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(teamTodosTable.updatedAt))
    .limit(50);

  return rows.length
    ? JSON.stringify({ todos: rows }, null, 2)
    : "No matching to-dos were found.";
}

export async function executeManageTeamTodo(
  rawArgs: string,
  actor: FredActor,
): Promise<string> {
  const args = parseArgs(rawArgs);
  const confirmationError = requireConfirmation(args);
  if (confirmationError) return confirmationError;
  const policyActor = await todoActor(actor);
  const manager = canManageTeamTodos(policyActor);
  const action = cleanText(args.action);

  if (action === "create") {
    const title = cleanText(args.title);
    if (!title) return "Error: title is required to create a to-do.";
    const details = cleanText(args.details);
    const textError = todoTextError(title, details);
    if (textError) return textError;
    const dueDate = cleanText(args.due_date);
    if (dueDate && !TODO_DATE_PATTERN.test(dueDate))
      return "Error: due_date must use YYYY-MM-DD.";
    const priority = cleanText(args.priority) || "normal";
    if (!TODO_PRIORITIES.has(priority))
      return "Error: priority must be low, normal, high, or urgent.";
    const assignee = args.assignee
      ? await resolveTodoAssignee(args.assignee)
      : null;
    const assigneeId = todoAssigneeForCreate(
      policyActor,
      assignee?.id ?? policyActor.id,
    );
    if (assigneeId == null) {
      return "Error: only Mark and Tracy may create a to-do for another team member.";
    }
    const [created] = await db
      .insert(teamTodosTable)
      .values({
        title,
        details: details || null,
        dueDate: dueDate || null,
        priority,
        assigneeId,
        createdById: policyActor.id,
      })
      .returning();
    return `✓ To-do #${created.id} created for ${assignee?.name ?? actor.name ?? "you"}: ${created.title}. Open /todos`;
  }

  if (!["update", "complete", "reassign"].includes(action || "")) {
    return "Error: action must be create, update, complete, or reassign.";
  }
  const id = Number(args.id);
  if (!Number.isInteger(id) || id < 1)
    return "Error: a valid to-do id is required.";
  const [existing] = await db
    .select()
    .from(teamTodosTable)
    .where(eq(teamTodosTable.id, id));
  if (!existing) return `Error: To-do #${id} was not found.`;
  if (!canAccessTodo(policyActor, existing.assigneeId)) {
    return "Error: you may only update your own to-dos unless you are Mark or Tracy.";
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  let assigneeName: string | null = null;
  if (action === "complete") {
    updates.status = "completed";
    updates.completedAt = new Date();
  } else if (action === "reassign") {
    if (!manager) return "Error: only Mark and Tracy may reassign team to-dos.";
    const assignee = await resolveTodoAssignee(args.assignee);
    if (!assignee) return "Error: assignee is required for reassignment.";
    updates.assigneeId = assignee.id;
    assigneeName = assignee.name;
  } else {
    if (args.title !== undefined) {
      const title = cleanText(args.title);
      if (!title) return "Error: title cannot be empty.";
      if (title.length > 500)
        return "Error: a to-do title cannot exceed 500 characters.";
      updates.title = title;
    }
    if (args.details !== undefined) {
      const details = cleanText(args.details);
      if (details && details.length > 10_000)
        return "Error: to-do details cannot exceed 10,000 characters.";
      updates.details = details || null;
    }
    if (args.due_date !== undefined) {
      const dueDate = cleanText(args.due_date);
      if (dueDate && !TODO_DATE_PATTERN.test(dueDate))
        return "Error: due_date must use YYYY-MM-DD.";
      updates.dueDate = dueDate || null;
    }
    if (args.priority !== undefined) {
      const priority = cleanText(args.priority);
      if (!priority || !TODO_PRIORITIES.has(priority))
        return "Error: priority must be low, normal, high, or urgent.";
      updates.priority = priority;
    }
    if (args.status !== undefined) {
      const status = cleanText(args.status);
      if (!status || !TODO_STATUSES.has(status))
        return "Error: status must be open, in_progress, or completed.";
      updates.status = status;
      updates.completedAt = status === "completed" ? new Date() : null;
    }
  }

  if (Object.keys(updates).length === 1)
    return "Error: no to-do changes were provided.";
  const [updated] = await db
    .update(teamTodosTable)
    .set(updates)
    .where(eq(teamTodosTable.id, id))
    .returning();
  if (action === "complete")
    return `✓ To-do #${updated.id} marked completed: ${updated.title}.`;
  if (action === "reassign")
    return `✓ To-do #${updated.id} moved to ${assigneeName}: ${updated.title}.`;
  return `✓ To-do #${updated.id} updated: ${updated.title}.`;
}

export const APPLICATION_GUIDANCE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: "get_application_guidance",
      description:
        "Read the release-owned catalog for every SCCC Insights page, route, permission, function, and Fred execution boundary. Always call this for navigation, permissions, workflows, or any question about what a page or function does. Use an approved action tool when the catalog says Fred can perform the action; otherwise give the exact route and UI steps without pretending the action was performed.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description:
              "Optional page name, route, feature, or workflow. Pass an exact route when one is known. Omit to list the complete page catalog.",
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
  const catalogPages = findFredApplicationPages(topic);
  if (catalogPages.length) {
    if (!topic) {
      return [
        "# SCCC Insights application capability catalog",
        "Use get_application_guidance again with a page name, route, feature, or workflow for full functions and Fred action boundaries.",
        ...catalogPages.map(
          (page) =>
            `- ${page.name}: ${page.routes.join(", ")} | ${page.menu} | ${page.access}`,
        ),
      ].join("\n");
    }
    return catalogPages
      .slice(0, 12)
      .map(renderFredApplicationPage)
      .join("\n\n");
  }
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
    return `No application guidance matched ${topic ? `“${topic}”` : "that request"}. Do not invent a page or function; say that the current catalog has no match.`;
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
    QUERY_TEAM_TODOS_TOOL,
    MANAGE_TEAM_TODO_TOOL,
    APPLICATION_GUIDANCE_TOOL,
    ...(String(role || "")
      .trim()
      .toLowerCase() === "cio"
      ? [MANAGE_WEEKLY_REPORT_TOOL]
      : []),
  ];
}
