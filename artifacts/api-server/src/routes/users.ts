import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireCIO, invalidateUserSessions } from "./auth";
import { z } from "zod";

const router = Router();

function formatUser(user: any) {
  const { passwordHash: _, ...rest } = user;
  return rest;
}

router.get("/", requireAuth, requireCIO, async (req, res) => {
  const users = await db.select().from(usersTable);
  return res.json(users.map(formatUser));
});

router.post("/", requireAuth, requireCIO, async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(255),
    email: z.string().trim().email().max(255).transform((v) => v.toLowerCase()),
    role: z.enum(["cio", "helpdesk", "network_engineer", "security_engineer", "staff"]),
    department: z.string().trim().max(255).optional().default(""),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  try {
    const [user] = await db.insert(usersTable).values({
      ...parsed.data,
      department: parsed.data.department || null,
      isActive: true,
      isBreakGlass: false,
    }).returning();
    return res.status(201).json(formatUser(user));
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A user with that email already exists." });
    }
    throw err;
  }
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  if (req.user.role !== "cio" && req.user.id !== id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) return res.status(404).json({ error: "Not found" });
  return res.json(formatUser(user));
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const isCIO = req.user.role === "cio";
  const isSelf = req.user.id === id;

  if (!isCIO && !isSelf) {
    return res.status(403).json({ error: "Forbidden" });
  }

  let schema;
  if (isCIO) {
    schema = z.object({
      name: z.string().optional(),
      role: z.enum(["cio", "helpdesk", "network", "security", "network_engineer", "security_engineer", "staff"]).optional(),
      department: z.string().optional(),
      isActive: z.boolean().optional(),
    });
  } else {
    schema = z.object({
      name: z.string().optional(),
      department: z.string().optional(),
    });
  }

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  const updates: any = { ...parsed.data, updatedAt: new Date() };

  if (isCIO && (parsed.data as { isActive?: boolean }).isActive === false) {
    await invalidateUserSessions(id);
  }

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!user) return res.status(404).json({ error: "Not found" });
  return res.json(formatUser(user));
});

router.delete("/:id", requireAuth, requireCIO, async (req: any, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid user id" });
  if (req.user.id === id) return res.status(400).json({ error: "You cannot delete your own account." });

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.isActive) {
    return res.status(409).json({ error: "Deactivate the account before deleting it." });
  }

  try {
    await invalidateUserSessions(id);
    await db.delete(usersTable).where(eq(usersTable.id, id));
    return res.status(204).send();
  } catch (err: any) {
    if (err?.code === "23503") {
      return res.status(409).json({
        error: "This account has related history and cannot be deleted. Leave it inactive to preserve audit records.",
      });
    }
    throw err;
  }
});

export default router;
