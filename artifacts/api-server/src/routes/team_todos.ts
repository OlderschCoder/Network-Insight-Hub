import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, teamTodosTable, usersTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "./auth";
import {
  canAccessTodo,
  canManageTeamTodos,
  todoAssigneeForCreate,
} from "../lib/team_todo_policy";

const router = Router();

const statusSchema = z.enum(["open", "in_progress", "completed"]);
const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function activeUser(id: number) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, id), eq(usersTable.isActive, true)));
  return user;
}

async function enrichTodos(rows: any[]) {
  if (rows.length === 0) return [];
  const users = await db.select().from(usersTable);
  const byId = new Map(users.map((user) => [user.id, user]));
  return rows.map((todo) => ({
    ...todo,
    assigneeName: byId.get(todo.assigneeId)?.name ?? "Unknown",
    createdByName: byId.get(todo.createdById)?.name ?? "Unknown",
  }));
}

router.get("/assignees", requireAuth, async (req: any, res) => {
  const users = canManageTeamTodos(req.user)
    ? await db.select().from(usersTable).where(eq(usersTable.isActive, true))
    : [await activeUser(req.user.id)].filter(Boolean);

  return res.json(
    users
      .map((user: any) => ({
        id: user.id,
        name: user.name,
        role: user.role,
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
  );
});

router.get("/", requireAuth, async (req: any, res) => {
  const parsed = z
    .object({
      assigneeId: z.string().regex(/^\d+$/).optional(),
      status: statusSchema.optional(),
    })
    .safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query" });
  }

  const requestedAssigneeId = parsed.data.assigneeId
    ? Number(parsed.data.assigneeId)
    : undefined;
  const manager = canManageTeamTodos(req.user);
  if (
    !manager &&
    requestedAssigneeId !== undefined &&
    requestedAssigneeId !== req.user.id
  ) {
    return res
      .status(403)
      .json({ error: "You may only view your own to-dos." });
  }

  const conditions: any[] = [];
  if (manager && requestedAssigneeId !== undefined) {
    conditions.push(eq(teamTodosTable.assigneeId, requestedAssigneeId));
  } else if (!manager) {
    conditions.push(eq(teamTodosTable.assigneeId, req.user.id));
  }
  if (parsed.data.status) {
    conditions.push(eq(teamTodosTable.status, parsed.data.status));
  }

  const rows = conditions.length
    ? await db
        .select()
        .from(teamTodosTable)
        .where(and(...conditions))
        .orderBy(desc(teamTodosTable.createdAt))
    : await db
        .select()
        .from(teamTodosTable)
        .orderBy(desc(teamTodosTable.createdAt));

  return res.json(await enrichTodos(rows));
});

router.post("/", requireAuth, async (req: any, res) => {
  const parsed = z
    .object({
      title: z.string().trim().min(1).max(500),
      details: z.string().trim().max(10_000).nullable().optional(),
      assigneeId: z.number().int().positive().optional(),
      dueDate: dateSchema.nullable().optional(),
      priority: prioritySchema.optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation error",
      message: parsed.error.message,
    });
  }

  const assigneeId = todoAssigneeForCreate(req.user, parsed.data.assigneeId);
  if (assigneeId === null) {
    return res.status(403).json({
      error: "Only Mark and Tracy may assign to-dos to other team members.",
    });
  }
  if (!(await activeUser(assigneeId))) {
    return res.status(400).json({ error: "Assignee must be an active user." });
  }

  const [row] = await db
    .insert(teamTodosTable)
    .values({
      assigneeId,
      createdById: req.user.id,
      title: parsed.data.title,
      details: parsed.data.details || null,
      dueDate: parsed.data.dueDate || null,
      priority: parsed.data.priority ?? "normal",
    })
    .returning();
  return res.status(201).json((await enrichTodos([row]))[0]);
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id))
    return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db
    .select()
    .from(teamTodosTable)
    .where(eq(teamTodosTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!canAccessTodo(req.user, existing.assigneeId)) {
    return res
      .status(403)
      .json({ error: "You may only update your own to-dos." });
  }

  const parsed = z
    .object({
      title: z.string().trim().min(1).max(500).optional(),
      details: z.string().trim().max(10_000).nullable().optional(),
      assigneeId: z.number().int().positive().optional(),
      dueDate: dateSchema.nullable().optional(),
      priority: prioritySchema.optional(),
      status: statusSchema.optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation error",
      message: parsed.error.message,
    });
  }

  if (
    parsed.data.assigneeId !== undefined &&
    parsed.data.assigneeId !== existing.assigneeId &&
    !canManageTeamTodos(req.user)
  ) {
    return res.status(403).json({
      error: "Only Mark and Tracy may reassign team to-dos.",
    });
  }
  if (
    parsed.data.assigneeId !== undefined &&
    !(await activeUser(parsed.data.assigneeId))
  ) {
    return res.status(400).json({ error: "Assignee must be an active user." });
  }

  const updates: Record<string, unknown> = {
    ...parsed.data,
    updatedAt: new Date(),
  };
  if (parsed.data.status === "completed") updates.completedAt = new Date();
  if (parsed.data.status && parsed.data.status !== "completed") {
    updates.completedAt = null;
  }

  const [row] = await db
    .update(teamTodosTable)
    .set(updates)
    .where(eq(teamTodosTable.id, id))
    .returning();
  return res.json((await enrichTodos([row]))[0]);
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id))
    return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db
    .select()
    .from(teamTodosTable)
    .where(eq(teamTodosTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!canAccessTodo(req.user, existing.assigneeId)) {
    return res
      .status(403)
      .json({ error: "You may only delete your own to-dos." });
  }
  await db.delete(teamTodosTable).where(eq(teamTodosTable.id, id));
  return res.status(204).send();
});

export default router;
