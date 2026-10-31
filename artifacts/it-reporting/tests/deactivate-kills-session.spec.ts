import { test, expect, type APIRequestContext } from "@playwright/test";
import { authenticate, registerActivateLogin } from "./helpers/auth";

// Deactivating a user must kill their already-active session immediately, not
// just block their next login. The CIO update route (artifacts/api-server's
// users route) proactively calls invalidateUserSessions(id) when an account is
// deactivated, dropping every live bearer token for that user. Even if a token
// survived that sweep, requireAuth re-checks `isActive` on every request and
// rejects deactivated accounts. Either path means a deactivated user's next
// authenticated request is rejected with 401.
//
// This spec exercises that for real: a staff user logs in and confirms their
// token works, a CIO deactivates them through the admin UI, and then the
// original token's next authenticated request is rejected. A regression that
// only enforced deactivation at login time (leaving live sessions working)
// would be caught here.
//
// The 401 body is either "Unauthorized" (the proactive invalidation path —
// token already gone from the session map) or "Account is deactivated" (the
// lazy requireAuth path — token present but the account is inactive). Both are
// valid "session killed" outcomes, so we accept either and assert the message
// is one of them rather than pinning to a single enforcement path.
const REJECTION_MESSAGES = ["Unauthorized", "Account is deactivated"];

// Make an authenticated request with a raw bearer token and return the response
// so the caller can assert on status + body.
async function meWithToken(request: APIRequestContext, token: string) {
  return request.get("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test.describe("Deactivating a user kills their active session", () => {
  test("an active session is rejected immediately after a CIO deactivates the user", async ({
    page,
    request,
  }) => {
    // 1. A staff user signs in and holds a live session token.
    const victim = await registerActivateLogin(request, {
      role: "helpdesk",
      prefix: "e2e_victim",
    });

    // The token works before deactivation, and tells us the user's id so we can
    // find their row in the admin UI.
    const beforeRes = await meWithToken(request, victim.token);
    expect(
      beforeRes.ok(),
      `session should work before deactivation: ${beforeRes.status()} ${await beforeRes.text()}`,
    ).toBeTruthy();
    const beforeBody = await beforeRes.json();
    expect(beforeBody.email).toBe(victim.email);
    const victimId = beforeBody.id as number;
    expect(victimId, "no user id returned from /api/auth/me").toBeTruthy();

    // 2. A CIO signs in and deactivates the staff user through the admin UI.
    const { token: cioToken } = await registerActivateLogin(request, {
      role: "cio",
      prefix: "e2e_deactivator",
    });
    await authenticate(page, cioToken);
    await page.goto("/admin");

    const row = page.getByTestId(`user-row-${victimId}`);
    await expect(row).toBeVisible();
    const toggle = page.getByTestId(`button-toggle-active-${victimId}`);
    // The account starts active, so the affordance offers to deactivate it.
    await expect(toggle).toHaveText("Deactivate");

    await toggle.click();

    // Success toast + the row flips to inactive (button now offers "Activate").
    await expect(
      page.getByText("User deactivated", { exact: true }),
    ).toBeVisible();
    await expect(toggle).toHaveText("Activate");
    await expect(row.getByText("Inactive", { exact: true })).toBeVisible();

    // 3. The victim's ORIGINAL, previously-working token is now rejected on its
    //    next authenticated request — the live session was killed, not just
    //    future logins.
    const afterRes = await meWithToken(request, victim.token);
    expect(afterRes.status(), "deactivated session should be rejected").toBe(
      401,
    );
    const afterBody = await afterRes.json();
    expect(REJECTION_MESSAGES).toContain(afterBody.error);
  });
});
