import { db, usersTable } from "@workspace/db";
import { eq, ne, isNotNull, and } from "drizzle-orm";
import bcrypt from "bcrypt";
import { logger } from "./logger";

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
 */
export async function seedBreakGlassAccount(): Promise<void> {
  const email = process.env.BREAKGLASS_EMAIL?.trim().toLowerCase();
  const password = process.env.BREAKGLASS_PASSWORD;
  if (!email || !password) return;

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
  } catch (err) {
    logger.error({ err }, "Failed to seed break-glass account");
  }
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
