import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod";

const router = Router();

const sessions = new Map<string, number>();

function createToken(userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, userId);
  return token;
}

export function getUserIdFromToken(token: string): number | null {
  return sessions.get(token) ?? null;
}

export async function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = authHeader.slice(7);
  const userId = getUserIdFromToken(token);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.user = user;
  next();
}

export function requireCIO(req: any, res: any, next: any) {
  if (req.user?.role !== "cio") {
    return res.status(403).json({ error: "CIO access required" });
  }
  next();
}

function formatUser(user: any) {
  const { passwordHash: _, ...rest } = user;
  return rest;
}

router.post("/register", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(1),
    role: z.enum(["cio", "helpdesk", "network", "security", "network_engineer", "security_engineer", "staff"]).optional().default("helpdesk"),
    department: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  }
  const { email, password, name, role, department } = parsed.data;
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing.length > 0) {
    return res.status(400).json({ error: "Email already registered" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({ email, passwordHash, name, role, department }).returning();
  const token = createToken(user.id);
  return res.status(201).json({ user: formatUser(user), token });
});

router.post("/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error" });
  }
  const { email, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = createToken(user.id);
  return res.json({ user: formatUser(user), token });
});

router.post("/logout", requireAuth, async (req: any, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    sessions.delete(authHeader.slice(7));
  }
  return res.json({ success: true });
});

router.get("/me", requireAuth, async (req: any, res) => {
  return res.json(formatUser(req.user));
});

export default router;
