import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod";
import { isEmailConfigured, sendReportEmail } from "../lib/email";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  generatePkce,
  getEntraConfig,
  getEntraProfile,
  isAccessAllowed,
  isAccessGateConfigured,
  isEntraConfigured,
  mapEntraToHubRole,
  randomState,
} from "../lib/entra";

const router = Router();

const sessions = new Map<string, number>();

function createToken(userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, userId);
  return token;
}

// ---- Entra SSO transient state ---------------------------------------------
// PKCE/state/nonce for an in-flight authorization request, keyed by `state`.
// One-time exchange codes let the SPA pick up its bearer token after the OIDC
// redirect without ever putting the long-lived token in a URL query param.
type EntraTx = { verifier: string; nonce: string; createdAt: number };
const entraTxns = new Map<string, EntraTx>();
type ExchangeEntry = { userId: number; token: string; createdAt: number };
const exchangeCodes = new Map<string, ExchangeEntry>();

const ENTRA_TX_TTL_MS = 10 * 60 * 1000; // 10 min to complete the login round-trip
const EXCHANGE_TTL_MS = 60 * 1000; // 60s for the SPA to redeem the one-time code

function sweepExpired() {
  const now = Date.now();
  for (const [k, v] of entraTxns) if (now - v.createdAt > ENTRA_TX_TTL_MS) entraTxns.delete(k);
  for (const [k, v] of exchangeCodes) if (now - v.createdAt > EXCHANGE_TTL_MS) exchangeCodes.delete(k);
}

export function getUserIdFromToken(token: string): number | null {
  return sessions.get(token) ?? null;
}

export function invalidateUserSessions(userId: number): void {
  for (const [token, uid] of sessions.entries()) {
    if (uid === userId) {
      sessions.delete(token);
    }
  }
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
  if (!user.isActive) {
    sessions.delete(token);
    return res.status(401).json({ error: "Account is deactivated" });
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

export function requireNetworkAdmin(req: any, res: any, next: any) {
  const allowedRoles = ["cio", "network", "network_engineer"];
  if (!allowedRoles.includes(req.user?.role)) {
    return res.status(403).json({ error: "Network administrator access required" });
  }
  next();
}

function formatUser(user: any) {
  const { passwordHash: _, ...rest } = user;
  return rest;
}

// Public self-registration has been removed. Accounts are provisioned via
// Microsoft Entra SSO (first sign-in) or created as local break-glass accounts.

// ---- Local (break-glass) login ---------------------------------------------
// Kept for emergency access when SSO is unavailable. Only accounts that have a
// local password (passwordHash set) can use this path — SSO-only users cannot.
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
  // Local password login is restricted to break-glass accounts. Everyone else
  // must sign in with Microsoft Entra — even if a legacy passwordHash lingers.
  if (!user.isBreakGlass || !user.passwordHash) {
    return res.status(401).json({
      error: "This account uses Microsoft sign-in. Use the \"Sign in with Microsoft\" button.",
    });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  if (!user.isActive) {
    return res.status(401).json({ error: "Account is deactivated" });
  }
  const token = createToken(user.id);
  return res.json({ user: formatUser(user), token });
});

// ---- Microsoft Entra SSO ----------------------------------------------------

// Whether SSO is available (drives the login page UI). Public.
// Requires BOTH the OIDC client config AND an access gate — without the gate
// every sign-in fails closed, so we don't advertise sign-in as available.
router.get("/entra/status", (_req, res) => {
  return res.json({ configured: isEntraConfigured() && isAccessGateConfigured() });
});

function frontendLoginUrl(req: any): string {
  const configured = process.env.ENTRA_POST_LOGIN_REDIRECT;
  if (configured) return configured;
  const origin =
    (req.headers["x-forwarded-proto"] && req.headers["x-forwarded-host"]
      ? `${req.headers["x-forwarded-proto"]}://${req.headers["x-forwarded-host"]}`
      : `${req.protocol}://${req.get("host")}`);
  return `${origin}/login`;
}

// Name of the httpOnly cookie that binds an in-flight OIDC transaction to the
// browser that started it. The callback requires the state in this cookie to
// match the state returned in the query — this defeats login-CSRF (an attacker
// cannot make a victim's browser complete a sign-in it never initiated).
const ENTRA_STATE_COOKIE = "entra_state";

function entraStateCookieOpts() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/auth/entra",
    maxAge: ENTRA_TX_TTL_MS,
  };
}

// Start the OIDC login: create PKCE + state + nonce, redirect to Microsoft.
router.get("/entra/login", (req, res) => {
  const cfg = getEntraConfig();
  if (!cfg) {
    return res.status(503).json({ error: "ENTRA_NOT_CONFIGURED", message: "Microsoft sign-in is not configured." });
  }
  sweepExpired();
  const { verifier, challenge } = generatePkce();
  const state = randomState();
  const nonce = randomState();
  entraTxns.set(state, { verifier, nonce, createdAt: Date.now() });
  // Bind this transaction to the initiating browser.
  res.cookie(ENTRA_STATE_COOKIE, state, entraStateCookieOpts());
  const url = buildAuthorizeUrl(cfg, { state, nonce, codeChallenge: challenge });
  return res.redirect(url);
});

// Handle the redirect back from Microsoft. Validates, provisions/links the
// user, then bounces to the SPA login page with a one-time exchange code.
router.get("/entra/callback", async (req: any, res) => {
  const loginUrl = frontendLoginUrl(req);
  const fail = (reason: string) =>
    res.redirect(`${loginUrl}?entra_error=${encodeURIComponent(reason)}`);

  const cfg = getEntraConfig();
  if (!cfg) return fail("Microsoft sign-in is not configured.");

  const { code, state, error, error_description } = req.query as Record<string, string>;
  // Clear the browser-binding cookie regardless of outcome.
  const cookieState: string | undefined = req.cookies?.[ENTRA_STATE_COOKIE];
  res.clearCookie(ENTRA_STATE_COOKIE, { path: "/api/auth/entra" });

  if (error) return fail(error_description || error);
  if (!code || !state) return fail("Missing authorization response.");

  // The state returned by Microsoft must match the state we bound to this
  // browser via the httpOnly cookie at /entra/login — rejects login-CSRF and
  // cross-browser code injection.
  if (!cookieState || cookieState !== state) {
    req.log?.warn("Entra callback state/cookie mismatch");
    return fail("Your sign-in could not be verified. Please try again.");
  }

  sweepExpired();
  const tx = entraTxns.get(state);
  entraTxns.delete(state);
  if (!tx) return fail("Your sign-in request expired. Please try again.");

  try {
    const tokens = await exchangeCodeForTokens(cfg, {
      code,
      codeVerifier: tx.verifier,
      expectedNonce: tx.nonce,
    });
    const profile = await getEntraProfile(tokens);

    if (!isAccessAllowed(profile)) {
      req.log?.warn({ email: profile.email }, "Entra sign-in refused: not in IT group/role");
      return fail("Your account is not authorized to access the IT Hub. Contact the CIO if you believe this is a mistake.");
    }

    // Match an existing account by Entra object id first, then by email so
    // prior history (entries/reports) stays attached to the same row.
    let [user] = await db.select().from(usersTable).where(eq(usersTable.entraObjectId, profile.oid));
    if (!user) {
      [user] = await db.select().from(usersTable).where(eq(usersTable.email, profile.email));
    }

    if (!user) {
      // First-ever sign-in for this person → create with mapped Hub role.
      const role = mapEntraToHubRole(profile);
      [user] = await db
        .insert(usersTable)
        .values({
          email: profile.email,
          name: profile.name,
          role,
          jobTitle: profile.jobTitle,
          entraObjectId: profile.oid,
          isActive: true,
        })
        .returning();
    } else {
      // Existing account: link Entra + refresh profile, but PRESERVE role
      // (existing/manual assignment) on subsequent sign-ins.
      await db
        .update(usersTable)
        .set({
          entraObjectId: profile.oid,
          name: profile.name || user.name,
          jobTitle: profile.jobTitle ?? user.jobTitle,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, user.id));
      [user] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    }

    if (!user.isActive) {
      return fail("Your account is deactivated. Contact the CIO to regain access.");
    }

    // Mint the bearer token now, hand it to the SPA via a short-lived one-time
    // code (never the token itself in the URL).
    const token = createToken(user.id);
    const oneTime = crypto.randomBytes(24).toString("base64url");
    exchangeCodes.set(oneTime, { userId: user.id, token, createdAt: Date.now() });
    return res.redirect(`${loginUrl}?entra_code=${encodeURIComponent(oneTime)}`);
  } catch (err) {
    req.log?.error({ err }, "Entra callback failed");
    return fail("Sign-in failed. Please try again.");
  }
});

// Redeem the one-time code for the bearer token + user (single use).
router.post("/entra/exchange", async (req, res) => {
  const schema = z.object({ code: z.string().min(10) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });

  sweepExpired();
  const entry = exchangeCodes.get(parsed.data.code);
  if (!entry) {
    return res.status(400).json({ error: "Invalid or expired sign-in code" });
  }
  exchangeCodes.delete(parsed.data.code);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, entry.userId));
  if (!user || !user.isActive) {
    sessions.delete(entry.token);
    return res.status(401).json({ error: "Account is unavailable" });
  }
  return res.json({ user: formatUser(user), token: entry.token });
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

  // Password reset is only for break-glass accounts — SSO users have no local
  // password. Non-break-glass emails get the same generic response (no token
  // is issued) so this can't be used to bypass the Entra gate.
  if (user && user.isBreakGlass) {
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

  if (!user || !user.isBreakGlass) {
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
