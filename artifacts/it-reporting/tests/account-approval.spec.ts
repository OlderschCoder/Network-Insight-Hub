import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  authenticate,
  registerActivateLogin,
  uniqueEmail,
  TEST_PASSWORD,
} from "./helpers/auth";

// End-to-end coverage for the real CIO-approval gate (artifacts/api-server's
// auth route): registration creates an INACTIVE account, login refuses it until
// an admin activates it, and only then does login succeed.
//
// Every other spec deliberately short-circuits this by flipping `is_active` in
// the database (see helpers/auth.ts). This spec is the one place that exercises
// the activation step for real — through the CIO admin UI — so a regression in
// either half of the gate (register auto-activating, or login no longer
// checking `isActive`) is caught.

interface PendingAccount {
  id: number;
  email: string;
}

// Register a fresh @sccc.edu account straight through the public API and return
// its id + email. Intentionally does NOT activate it — that is what the test is
// verifying happens only via CIO approval.
async function registerPendingAccount(
  request: APIRequestContext,
): Promise<PendingAccount> {
  const email = uniqueEmail("e2e_pending");
  const res = await request.post("/api/auth/register", {
    data: { email, password: TEST_PASSWORD, name: "E2E Pending Staff" },
  });
  expect(
    res.ok(),
    `register failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const body = await res.json();
  // Register must never hand back a session token for a pending account.
  expect(body.token, "register should not return a token").toBeFalsy();
  expect(body.user?.id, "no user id returned from register").toBeTruthy();
  // The account must start inactive — that is the whole point of the gate.
  expect(body.user?.isActive, "new account should start inactive").toBe(false);
  return { id: body.user.id as number, email };
}

// Attempt a login through the public API and return the raw response so the
// caller can assert on status + body.
async function attemptLogin(request: APIRequestContext, email: string) {
  return request.post("/api/auth/login", {
    data: { email, password: TEST_PASSWORD },
  });
}

test.describe("CIO account-approval gate", () => {
  test("a pending account can't log in until a CIO activates it", async ({
    page,
    request,
  }) => {
    // 1. A freshly registered account exists but is pending approval.
    const pending = await registerPendingAccount(request);

    // 2. Login is rejected with the "deactivated" error while pending.
    const beforeRes = await attemptLogin(request, pending.email);
    expect(beforeRes.status(), "pending login should be rejected").toBe(401);
    const beforeBody = await beforeRes.json();
    expect(beforeBody.error).toBe("Account is deactivated");

    // 3. A CIO signs in and approves the account through the admin UI. The CIO
    //    session is set up via the shared helper (its own activation isn't what
    //    we're testing); the pending account's activation is done for real by
    //    clicking "Activate" in the admin page.
    const { token: cioToken } = await registerActivateLogin(request, {
      role: "cio",
      prefix: "e2e_approver",
    });
    await authenticate(page, cioToken);
    await page.goto("/admin");

    const row = page.getByTestId(`user-row-${pending.id}`);
    await expect(row).toBeVisible();
    // The pending account is shown as inactive with an "Activate" affordance.
    await expect(row.getByText("Inactive", { exact: true })).toBeVisible();
    const toggle = page.getByTestId(`button-toggle-active-${pending.id}`);
    await expect(toggle).toHaveText("Activate");

    await toggle.click();

    // Success toast + the row flips to active (button now offers "Deactivate").
    await expect(page.getByText("User activated", { exact: true })).toBeVisible();
    await expect(toggle).toHaveText("Deactivate");

    // 4. Login now succeeds and returns a usable session token.
    const afterRes = await attemptLogin(request, pending.email);
    expect(
      afterRes.ok(),
      `login after activation failed: ${afterRes.status()} ${await afterRes.text()}`,
    ).toBeTruthy();
    const afterBody = await afterRes.json();
    expect(afterBody.token, "no token returned after activation").toBeTruthy();
    expect(afterBody.user?.email).toBe(pending.email);
  });
});
