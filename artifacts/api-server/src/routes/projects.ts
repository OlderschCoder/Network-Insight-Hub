import { Router } from "express";
import { db, projectsTable, projectAssigneesTable, usersTable, risksTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";
import { z } from "zod";

const router = Router();

const attachmentSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  addedAt: z.string().optional(),
});

const decisionSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["pending", "decided"]),
  decidedBy: z.string().optional(),
  decidedAt: z.string().optional(),
  createdAt: z.string().optional(),
});

const projectBodySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["planning", "in_progress", "on_hold", "completed", "cancelled"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  targetDate: z.string().optional().nullable(),
  newEstimatedDate: z.string().optional().nullable(),
  attachments: z.array(attachmentSchema).optional(),
  pendingDecisions: z.array(decisionSchema).optional(),
  strategicObjectiveIds: z.array(z.number().int()).optional(),
  assigneeIds: z.array(z.number().int()).optional(),
});

async function enrichProject(id: number) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) return null;
  const assignees = await db
    .select({
      userId: projectAssigneesTable.userId,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
    })
    .from(projectAssigneesTable)
    .leftJoin(usersTable, eq(projectAssigneesTable.userId, usersTable.id))
    .where(eq(projectAssigneesTable.projectId, id));
  const risks = await db.select().from(risksTable).where(eq(risksTable.projectId, id));
  let createdByName: string | null = null;
  if (project.createdBy) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, project.createdBy));
    createdByName = u?.name ?? null;
  }
  return { ...project, assignees, risks, createdByName };
}

router.get("/", requireAuth, async (_req, res) => {
  const projects = await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));
  if (projects.length === 0) return res.json([]);
  const ids = projects.map((p) => p.id);
  const allAssignees = await db
    .select({
      projectId: projectAssigneesTable.projectId,
      userId: projectAssigneesTable.userId,
      name: usersTable.name,
    })
    .from(projectAssigneesTable)
    .leftJoin(usersTable, eq(projectAssigneesTable.userId, usersTable.id))
    .where(inArray(projectAssigneesTable.projectId, ids));
  const byProject: Record<number, { userId: number; name: string | null }[]> = {};
  for (const a of allAssignees) {
    (byProject[a.projectId] ||= []).push({ userId: a.userId, name: a.name ?? null });
  }
  return res.json(
    projects.map((p) => ({ ...p, assignees: byProject[p.id] ?? [] })),
  );
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const data = await enrichProject(id);
  if (!data) return res.status(404).json({ error: "Not found" });
  return res.json(data);
});

router.post("/", requireAuth, requireCIO, async (req: any, res) => {
  const parsed = projectBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", details: parsed.error.issues });
  }
  const { assigneeIds, ...data } = parsed.data;
  const [project] = await db.insert(projectsTable).values({
    ...data,
    targetDate: data.targetDate ?? null,
    newEstimatedDate: data.newEstimatedDate ?? null,
    createdBy: req.user.id,
  }).returning();
  if (assigneeIds && assigneeIds.length > 0) {
    await db.insert(projectAssigneesTable).values(
      assigneeIds.map((userId) => ({ projectId: project.id, userId })),
    );
  }
  const enriched = await enrichProject(project.id);
  return res.status(201).json(enriched);
});

router.patch("/:id", requireAuth, requireCIO, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const parsed = projectBodySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", details: parsed.error.issues });
  }
  const { assigneeIds, ...data } = parsed.data;
  const [existing] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const updates: any = { ...data, updatedAt: new Date() };
  if (typeof data.progress === "number" && data.progress !== existing.progress) {
    const log = Array.isArray(existing.progressLog) ? existing.progressLog : [];
    updates.progressLog = [...log, { date: new Date().toISOString(), value: data.progress }];
  }
  const [project] = await db.update(projectsTable)
    .set(updates)
    .where(eq(projectsTable.id, id))
    .returning();
  if (!project) return res.status(404).json({ error: "Not found" });
  if (assigneeIds) {
    await db.delete(projectAssigneesTable).where(eq(projectAssigneesTable.projectId, id));
    if (assigneeIds.length > 0) {
      await db.insert(projectAssigneesTable).values(
        assigneeIds.map((userId) => ({ projectId: id, userId })),
      );
    }
  }
  const enriched = await enrichProject(id);
  return res.json(enriched);
});

router.delete("/:id", requireAuth, requireCIO, async (req, res) => {
  const id = parseInt(req.params.id);
  const [deleted] = await db.delete(projectsTable).where(eq(projectsTable.id, id)).returning();
  if (!deleted) return res.status(404).json({ error: "Not found" });
  return res.json({ success: true });
});

export default router;
