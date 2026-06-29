import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";

// End-to-end coverage for the shared "Refresh from Zendesk" flow
// (src/hooks/useTimelineRefresh.ts) across every place it is used: the
// post-incident review detail page, the reviews list, and the new-review form.
// The Zendesk timeline endpoint is mocked at the network layer so these tests
// stay deterministic and never depend on live Zendesk data or ticket assignee
// matching.

const TIMELINE_ENDPOINT = "**/api/zendesk/ticket/*/timeline";

function rand(): string {
  return Math.random().toString(36).slice(2, 8);
}

const PASSWORD = "Password123";

// Registration is restricted to @sccc.edu addresses (see auth route).
function uniqueEmail(): string {
  return `e2e_timeline_${Date.now()}_${rand()}@sccc.edu`;
}

// New registrations land in a pending/inactive state and return no token, so we
// register a fresh account, flip it active directly in the database, then log
// in. The Zendesk timeline endpoint itself is mocked, so no special role or
// ticket assignment is required to exercise the refresh flow.
async function registerActivateLogin(
  request: APIRequestContext,
): Promise<string> {
  const email = uniqueEmail();
  const regRes = await request.post("/api/auth/register", {
    data: { email, password: PASSWORD, name: "E2E Timeline" },
  });
  expect(
    regRes.ok(),
    `register failed: ${regRes.status()} ${await regRes.text()}`,
  ).toBeTruthy();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query("UPDATE users SET is_active = true WHERE email = $1", [
      email,
    ]);
  } finally {
    await pool.end();
  }

  const loginRes = await request.post("/api/auth/login", {
    data: { email, password: PASSWORD },
  });
  expect(
    loginRes.ok(),
    `login failed: ${loginRes.status()} ${await loginRes.text()}`,
  ).toBeTruthy();
  const body = await loginRes.json();
  expect(body.token, "no token returned").toBeTruthy();
  return body.token as string;
}

async function createReviewViaApi(
  request: APIRequestContext,
  token: string,
  opts: { zendeskTicketId: number; timeline: string },
): Promise<number> {
  const res = await request.post("/api/after-action", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: `Timeline refresh review ${rand()}`,
      incident: "Synthetic incident created by the timeline-refresh e2e test.",
      status: "open",
      severity: "medium",
      timeline: opts.timeline,
      zendeskTicketId: opts.zendeskTicketId,
      incidentDate: new Date().toISOString().slice(0, 10),
    },
  });
  expect(
    res.ok(),
    `create review failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const body = await res.json();
  expect(body.id, "no review id returned").toBeTruthy();
  return body.id as number;
}

async function authenticate(page: Page, token: string) {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("auth_token", t);
    } catch {}
  }, token);
}

// Mock the Zendesk timeline endpoint with a successful payload.
async function mockTimelineSuccess(page: Page, timeline: string) {
  await page.route(TIMELINE_ENDPOINT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ticketId: 0,
        commentCount: 1,
        includedCount: 1,
        timeline,
      }),
    });
  });
}

// Mock the Zendesk timeline endpoint with a response that carries no timeline,
// simulating "Zendesk returned nothing usable" — the hook should surface the
// error toast.
async function mockTimelineEmpty(page: Page) {
  await page.route(TIMELINE_ENDPOINT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ticketId: 0, commentCount: 0, timeline: "" }),
    });
  });
}

// Assert a toast with the given title is shown. Scoped to the visible toast
// title element; the toast also renders a duplicate aria-live status region, so
// an exact, role-scoped match avoids strict-mode collisions.
async function expectToast(page: Page, title: string) {
  await expect(
    page.getByText(title, { exact: true }).first(),
  ).toBeVisible();
}

// Click the destructive "Replace" button in the confirm dialog that guards an
// existing timeline from being overwritten.
async function confirmReplace(page: Page) {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Replace", exact: true }).click();
}

test.describe("Refresh from Zendesk", () => {
  test("review detail: refresh replaces the timeline and shows a success toast", async ({
    page,
    request,
  }) => {
    const token = await registerActivateLogin(request);
    const ticketId = 100000 + Math.floor(Math.random() * 800000);
    const oldTimeline = `OLD timeline ${rand()}`;
    const id = await createReviewViaApi(request, token, {
      zendeskTicketId: ticketId,
      timeline: oldTimeline,
    });

    const newTimeline = `FRESH timeline ${rand()}`;
    await mockTimelineSuccess(page, newTimeline);
    await authenticate(page, token);

    await page.goto(`/after-action/${id}`);
    await expect(page.getByText(oldTimeline)).toBeVisible();

    await page.getByTestId("button-refresh-timeline").click();
    await confirmReplace(page);

    await expectToast(page, "Timeline refreshed");
    await expect(page.getByText(newTimeline)).toBeVisible();
    await expect(page.getByText(oldTimeline)).toHaveCount(0);
  });

  test("review detail: an empty Zendesk timeline shows the error toast", async ({
    page,
    request,
  }) => {
    const token = await registerActivateLogin(request);
    const ticketId = 100000 + Math.floor(Math.random() * 800000);
    const oldTimeline = `OLD timeline ${rand()}`;
    const id = await createReviewViaApi(request, token, {
      zendeskTicketId: ticketId,
      timeline: oldTimeline,
    });

    await mockTimelineEmpty(page);
    await authenticate(page, token);

    await page.goto(`/after-action/${id}`);
    await expect(page.getByText(oldTimeline)).toBeVisible();

    await page.getByTestId("button-refresh-timeline").click();
    await confirmReplace(page);

    await expectToast(page, "Couldn't refresh timeline");
    // The original timeline must remain untouched after a failed refresh.
    await expect(page.getByText(oldTimeline)).toBeVisible();
  });

  test("reviews list: per-row refresh updates the timeline and toasts success", async ({
    page,
    request,
  }) => {
    const token = await registerActivateLogin(request);
    const ticketId = 100000 + Math.floor(Math.random() * 800000);
    const id = await createReviewViaApi(request, token, {
      zendeskTicketId: ticketId,
      timeline: `OLD list timeline ${rand()}`,
    });

    await mockTimelineSuccess(page, `FRESH list timeline ${rand()}`);
    await authenticate(page, token);

    // Filter the list down to just our review so the row is easy to target.
    await page.goto(`/after-action?`);
    const refreshButton = page.getByTestId(`button-refresh-timeline-${id}`);
    await refreshButton.scrollIntoViewIfNeeded();
    await refreshButton.click();
    await confirmReplace(page);

    await expectToast(page, "Timeline refreshed");
  });

  test("new review form: refresh pulls the timeline and toasts success", async ({
    page,
    request,
  }) => {
    const token = await registerActivateLogin(request);
    const ticketId = 100000 + Math.floor(Math.random() * 800000);

    const fresh = `FRESH form timeline ${rand()}`;
    await mockTimelineSuccess(page, fresh);
    await authenticate(page, token);

    // Linking a ticket id makes the form auto-fetch the timeline on mount and
    // renders the "Refresh from Zendesk" button.
    await page.goto(`/after-action/new?zendeskTicketId=${ticketId}`);

    const timelineField = page.locator("#timeline");
    await expect(timelineField).toHaveValue(fresh);

    await page.getByTestId("button-refresh-timeline").click();
    // The auto-fetch already populated the field, so a confirm dialog guards it.
    await confirmReplace(page);

    await expectToast(page, "Timeline refreshed");
    await expect(timelineField).toHaveValue(fresh);
  });
});
