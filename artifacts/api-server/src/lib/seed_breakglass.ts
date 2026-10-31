import { db, usersTable } from "@workspace/db";
import { eq, ne, isNotNull, and } from "drizzle-orm";
import bcrypt from "bcrypt";
import { logger } from "./logger";

/**
 * Health of the break-glass emergency-login seeder, exposed so the startup
 * routine and the /healthz endpoint can surface a broken setup loudly.
 *
 *   "disabled" — BREAKGLASS_EMAIL / BREAKGLASS_PASSWORD not both set; feature off.
 *   "ok"       — the emergency CIO account was created or refreshed this boot.
 *   "failed"   — the env vars ARE set but the account could not be seeded
 *                (e.g. schema drift, DB error). This is the dangerous case: SSO
 *                could fail and leave the team with no way in.
 */
export type BreakGlassState = "disabled" | "ok" | "failed";

let breakGlassStatus: {
  state: BreakGlassState;
  error?: string;
  checkedAt?: string;
} = { state: "disabled" };

/**
 * Returns the current break-glass seeding status for health checks / diagnostics.
 */
export function getBreakGlassStatus(): {
  state: BreakGlassState;
  error?: string;
  checkedAt?: string;
} {
  return breakGlassStatus;
}

/**
 * Idempotent startup seeder for a local "break-glass" CIO account so there is
 * always a way into the Hub if Microsoft Entra SSO is unavailable.
 *
 * Driven entirely by env so no password is ever hardcoded:
 *   BREAKGLASS_EMAIL     — email for the emergency CIO account
 *   BREAKGLASS_PASSWORD  — its password (bcrypt-hashed on write)
 *
 * On boot: if both are set, ensure the account exists with role=cio, active,
 * flagged is_break_glass, and the given password. If the email already belongs
 * to an existing user (e.g. matched history), that row is (re)granted the
 * password + cio role + break-glass flag rather than creating a duplicate.
 * When the env vars are unset this is a no-op.
 *
 * Failure behavior (degraded-but-flagged, NOT fail-fast): if the env vars are
 * set but seeding throws, we do NOT crash the server — Microsoft Entra SSO may
 * still be working and taking the whole app down would be worse. Instead we
 * record a "failed" status (surfaced as a degraded /healthz response) and emit
 * a loud, multi-line FATAL banner so the failure is impossible to overlook.
 *
 * @returns the resulting {@link BreakGlassState} for the caller to act on.
 */
export async function seedBreakGlassAccount(): Promise<BreakGlassState> {
  const email = process.env.BREAKGLASS_EMAIL?.trim().toLowerCase();
  const password = process.env.BREAKGLASS_PASSWORD;
  if (!email || !password) {
    breakGlassStatus = { state: "disabled", checkedAt: new Date().toISOString() };
    return "disabled";
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existing) {
      await db
        .update(usersTable)
        .set({ passwordHash, role: "cio", isActive: true, isBreakGlass: true, updatedAt: new Date() })
        .where(eq(usersTable.id, existing.id));
      logger.info({ email }, "Break-glass CIO account refreshed");
    } else {
      await db.insert(usersTable).values({
        email,
        name: "Break-glass Admin",
        role: "cio",
        passwordHash,
        isActive: true,
        isBreakGlass: true,
      });
      logger.info({ email }, "Break-glass CIO account created");
    }
    breakGlassStatus = { state: "ok", checkedAt: new Date().toISOString() };
    return "ok";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    breakGlassStatus = {
      state: "failed",
      error: message,
      checkedAt: new Date().toISOString(),
    };
    logBreakGlassFailureBanner(email, err);
    return "failed";
  }
}

/**
 * Emit a multi-line, high-visibility FATAL banner when the emergency-login
 * seeder fails despite being configured. A single buried error line is easy to
 * miss; this makes the "no way in if SSO breaks" condition scream in the logs.
 */
function logBreakGlassFailureBanner(email: string, err: unknown): void {
  const line =
    "**************************************************************************";
  logger.fatal(
    { err, email },
    [
      "",
      line,
      "* BREAK-GLASS EMERGENCY LOGIN SETUP FAILED",
      "* BREAKGLASS_EMAIL / BREAKGLASS_PASSWORD are set, but the emergency CIO",
      "* account could NOT be created or refreshed on boot.",
      "* If Microsoft Entra SSO is unavailable, THERE IS NO WAY TO LOG IN.",
      "* /api/healthz now reports \"degraded\". Fix this immediately (likely a",
      "* database schema drift or connectivity error — see the attached err).",
      line,
      "",
    ].join("\n"),
  );
}

/**
 * Defense-in-depth cleanup: strip local credentials from every account that is
 * NOT flagged break-glass, so legacy pre-SSO passwords can never be used to
 * bypass the Entra sign-in gate. Idempotent — safe to run on every boot.
 * Nulls password_hash and any dangling reset token for non-break-glass users.
 */
export async function stripNonBreakGlassPasswords(): Promise<void> {
  try {
    const cleared = await db
      .update(usersTable)
      .set({
        passwordHash: null,
        passwordResetToken: null,
        passwordResetExpires: null,
        updatedAt: new Date(),
      })
      .where(and(ne(usersTable.isBreakGlass, true), isNotNull(usersTable.passwordHash)))
      .returning({ id: usersTable.id });
    if (cleared.length > 0) {
      logger.info({ count: cleared.length }, "Stripped local passwords from non-break-glass accounts");
    }
  } catch (err) {
    logger.error({ err }, "Failed to strip non-break-glass passwords");
  }
}
