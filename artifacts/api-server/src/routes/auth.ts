import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod";
import { isEmailConfigured, sendReportEmail } from "../lib/email";

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

// ---- Password reset ---------------------------------------------------------
// Always responds 200 to avoid leaking whether an email exists.
// In non-production environments (NODE_ENV !== "production") AND when SMTP
// isn't configured, the response includes the resetUrl so a developer can
// finish the flow locally. We never include the token in production responses
// or when email delivery is configured — it would be a credential leak.
router.post("/forgot-password", async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email));

  const isDev = process.env.NODE_ENV !== "production";
  let resetUrl: string | undefined;
  let devOnlyUrl: string | undefined;

  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db
      .update(usersTable)
      .set({ passwordResetToken: token, passwordResetExpires: expires, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    const origin =
      (req.headers.origin as string | undefined) ||
      (req.headers["x-forwarded-proto"] && req.headers["x-forwarded-host"]
        ? `${req.headers["x-forwarded-proto"]}://${req.headers["x-forwarded-host"]}`
        : `${req.protocol}://${req.get("host")}`);
    resetUrl = `${origin}/reset-password?token=${token}`;

    if (isEmailConfigured()) {
      try {
        await sendReportEmail({
          to: [user.email],
          subject: "SCCC IT Hub — Reset your password",
          text: `Hi ${user.name},\n\nA password reset was requested for your SCCC IT Hub account. ` +
            `If this was you, follow the link below within the next hour to set a new password:\n\n${resetUrl}\n\n` +
            `If you didn't request this, you can ignore this email — your password will stay the same.`,
          html: `<p>Hi ${user.name},</p>` +
            `<p>A password reset was requested for your SCCC IT Hub account. If this was you, ` +
            `follow the link below within the next hour to set a new password:</p>` +
            `<p><a href="${resetUrl}">Reset your password</a></p>` +
            `<p>If you didn't request this, you can ignore this email — your password will stay the same.</p>`,
        });
      } catch (err) {
        console.error("forgot-password: email send failed:", err);
      }
    } else if (isDev) {
      // Local development convenience: surface the link in-band so the dev
      // can complete the flow without an SMTP server. Never in production.
      devOnlyUrl = resetUrl;
    }
  }

  // Same shape regardless of whether the user exists.
  return res.json({
    ok: true,
    emailConfigured: isEmailConfigured(),
    ...(devOnlyUrl ? { resetUrl: devOnlyUrl } : {}),
  });
});

router.post("/reset-password", async (req, res) => {
  const schema = z.object({
    token: z.string().min(10),
    password: z.string().min(6),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  const [user] = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.passwordResetToken, parsed.data.token),
        gt(usersTable.passwordResetExpires, new Date()),
      ),
    );

  if (!user) {
    return res.status(400).json({ error: "Invalid or expired reset link" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await db
    .update(usersTable)
    .set({
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, user.id));

  return res.json({ ok: true });
});

export default router;
