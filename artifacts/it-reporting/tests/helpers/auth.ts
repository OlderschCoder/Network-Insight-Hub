import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";

// Shared sign-in helper for Playwright specs.
//
// It encodes the backend's current auth behavior in one place so specs don't
// each carry their own brittle copy:
//   - Registration is restricted to @sccc.edu addresses.
//   - Register always creates an inactive ("pending approval") account that
//     defaults to the "helpdesk" role and returns no token.
//   - Login rejects inactive users.
//
// So to get a logged-in session for an arbitrary role we register a fresh
// account, flip it active (and stamp the desired role) directly in the
// database, then log in. If any of those backend assumptions change again,
// this is the single file to update.

export type Role = "helpdesk" | "network_engineer" | "security_engineer" | "cio";

export const TEST_PASSWORD = "Password123";

// Registration is restricted to @sccc.edu addresses (see auth route).
export function uniqueEmail(prefix = "e2e"): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}@sccc.edu`;
}

export interface RegisterActivateLoginOptions {
  // Role to stamp on the account before logging in. Defaults to "helpdesk"
  // (the role register assigns), so callers that don't care about role can omit
  // it.
  role?: Role;
  // Prefix for the generated unique email and the account's display name.
  prefix?: string;
}

export interface Session {
  token: string;
  email: string;
  role: Role;
}

// Register a fresh account, activate it (and set its role) in the database,
// then log in. Returns the bearer token plus the email and role used.
export async function registerActivateLogin(
  request: APIRequestContext,
  options: RegisterActivateLoginOptions = {},
): Promise<Session> {
  const role: Role = options.role ?? "helpdesk";
  const prefix = options.prefix ?? `e2e_${role}`;
  const email = uniqueEmail(prefix);

  const regRes = await request.post("/api/auth/register", {
    data: { email, password: TEST_PASSWORD, name: `E2E ${role}` },
  });
  expect(
    regRes.ok(),
    `register failed for ${role}: ${regRes.status()} ${await regRes.text()}`,
  ).toBeTruthy();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      "UPDATE users SET is_active = true, role = $1 WHERE email = $2",
      [role, email],
    );
  } finally {
    await pool.end();
  }

  const loginRes = await request.post("/api/auth/login", {
    data: { email, password: TEST_PASSWORD },
  });
  expect(
    loginRes.ok(),
    `login failed for ${role}: ${loginRes.status()} ${await loginRes.text()}`,
  ).toBeTruthy();
  const body = await loginRes.json();
  expect(body.token, `no token returned for ${role}`).toBeTruthy();
  expect(body.user?.role).toBe(role);

  return { token: body.token as string, email, role };
}

// Seed the SPA's auth token into localStorage before any page script runs, so
// the app boots already authenticated.
export async function authenticate(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("auth_token", t);
    } catch {}
  }, token);
}
