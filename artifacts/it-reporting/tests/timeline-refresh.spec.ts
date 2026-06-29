import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { authenticate, registerActivateLogin } from "./helpers/auth";

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

// The Zendesk timeline endpoint is mocked, so no special role or ticket
// assignment is required to exercise the refresh flow — a default (helpdesk)
// account is enough.
async function loginAsTester(request: APIRequestContext): Promise<string> {
  const { token } = await registerActivateLogin(request, {
    prefix: "e2e_timeline",
  });
  return token;
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

// Click the destructive "Replace all" button in the bulk-refresh confirm dialog.
async function confirmReplaceAll(page: Page) {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Replace all", exact: true }).click();
}

// Mock the reviews list endpoint so the page renders exactly the reviews we
// created for this test. The list route is global (not user-scoped), so without
// this the shared dev DB would leak other reviews into the bulk action and make
// the "Refreshed N timelines" count non-deterministic. PATCH (apply) still hits
// the real API because the reviews really exist.
async function mockReviewList(page: Page, reviews: unknown[]) {
  await page.route("**/api/after-action", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reviews),
    });
  });
}

// Mock the Zendesk timeline endpoint per ticket: the ticket id in `successId`
// returns a usable timeline, every other ticket returns nothing (simulating a
// ticket Zendesk has no comments for), which the hook counts as a failure.
async function mockTimelineByTicket(
  page: Page,
  successId: number,
  timeline: string,
) {
  await page.route(TIMELINE_ENDPOINT, async (route) => {
    const m = route.request().url().match(/\/ticket\/(\d+)\/timeline/);
    const id = m ? parseInt(m[1]!, 10) : 0;
    const usable = id === successId;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        usable
          ? { ticketId: id, commentCount: 1, includedCount: 1, timeline }
          : { ticketId: id, commentCount: 0, timeline: "" },
      ),
    });
  });
}

// Build a minimal review object shaped like the list endpoint's response, using
// a real review id so the apply (PATCH) call succeeds against the live API.
function listReview(id: number, zendeskTicketId: number) {
  return {
    id,
    title: `Bulk refresh review ${id}`,
    incidentDate: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    zendeskTicketId,
    timeline: `OLD bulk timeline ${rand()}`,
  };
}

test.describe("Refresh from Zendesk", () => {
  test("review detail: refresh replaces the timeline and shows a success toast", async ({
    page,
    request,
  }) => {
    const token = await loginAsTester(request);
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
    const token = await loginAsTester(request);
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
    const token = await loginAsTester(request);
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
    const token = await loginAsTester(request);
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

  test("reviews list: 'Refresh all from Zendesk' refreshes every linked review", async ({
    page,
    request,
  }) => {
    const token = await loginAsTester(request);
    const ticketA = 100000 + Math.floor(Math.random() * 400000);
    const ticketB = ticketA + 1 + Math.floor(Math.random() * 400000);
    const idA = await createReviewViaApi(request, token, {
      zendeskTicketId: ticketA,
      timeline: `OLD A ${rand()}`,
    });
    const idB = await createReviewViaApi(request, token, {
      zendeskTicketId: ticketB,
      timeline: `OLD B ${rand()}`,
    });

    // Pin the list to exactly our two reviews so the bulk count is deterministic.
    await mockReviewList(page, [
      listReview(idA, ticketA),
      listReview(idB, ticketB),
    ]);
    await mockTimelineSuccess(page, `FRESH bulk ${rand()}`);
    await authenticate(page, token);

    await page.goto(`/after-action`);
    await page.getByTestId("button-refresh-all-timelines").click();
    await confirmReplaceAll(page);

    await expectToast(page, "Timelines refreshed");
    await expectToast(page, "Refreshed 2 timelines.");
  });

  test("reviews list: bulk refresh reports failures when a ticket returns nothing", async ({
    page,
    request,
  }) => {
    const token = await loginAsTester(request);
    const ticketA = 100000 + Math.floor(Math.random() * 400000);
    const ticketB = ticketA + 1 + Math.floor(Math.random() * 400000);
    const idA = await createReviewViaApi(request, token, {
      zendeskTicketId: ticketA,
      timeline: `OLD A ${rand()}`,
    });
    const idB = await createReviewViaApi(request, token, {
      zendeskTicketId: ticketB,
      timeline: `OLD B ${rand()}`,
    });

    await mockReviewList(page, [
      listReview(idA, ticketA),
      listReview(idB, ticketB),
    ]);
    // Only ticketA returns a usable timeline; ticketB returns nothing and is
    // counted as a failure.
    await mockTimelineByTicket(page, ticketA, `FRESH bulk ${rand()}`);
    await authenticate(page, token);

    await page.goto(`/after-action`);
    await page.getByTestId("button-refresh-all-timelines").click();
    await confirmReplaceAll(page);

    await expectToast(page, "Timelines refreshed");
    // The summary now names the review that failed, not just the count, so the
    // user can tell which one needs attention.
    await expectToast(
      page,
      `Refreshed 1 timeline, 1 failed: Bulk refresh review ${idB}.`,
    );
  });
});
