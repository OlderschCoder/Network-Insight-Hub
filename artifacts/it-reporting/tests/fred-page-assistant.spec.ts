import { expect, test } from "@playwright/test";

// Contract/UI tests: all API traffic stays in this fixture, never production.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("auth_token", "fred-ui-fixture"));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === "/api/auth/me"
      ? { id: 17, name: "Test Technician", email: "test@example.invalid", role: "helpdesk", isActive: true }
      : path === "/api/status-report/chat" ? { reply: "Here is the [Process Library](/processes). Tell me the procedure you want to record." }
      : path.includes("chat-session") ? { session: null, sessions: [] }
      : path.includes("widget-config") ? { enabled: false }
      : [];
    await route.fulfill({ json: data });
  });
});

test("Fred stays alongside the page and sends its exact context", async ({ page }, testInfo) => {
  await page.goto("/processes");
  await page.getByRole("button", { name: "Ask Fred", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Fred page assistant" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Add or update", exact: true }).click();
  const request = page.waitForRequest(req => new URL(req.url()).pathname === "/api/status-report/chat");
  await panel.getByRole("button", { name: "Send message to Fred" }).click();
  const body = (await request).postDataJSON();
  expect(body.pagePath).toBe("/processes");
  expect(body.messages.at(-1).content).toContain("Help me add or update");
  await expect(panel.getByText("Tell me the procedure", { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/processes$/);
  await page.screenshot({ path: testInfo.outputPath("fred-page-assistant.png") });
  await panel.getByRole("button", { name: "Close Fred", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Ask Fred", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Ask Fred", exact: true }).click();
  await expect(panel.getByText("Tell me the procedure", { exact: false })).toBeVisible();
});

test("home handoff preserves the actual question", async ({ page }) => {
  const question = "Where can I record completed work?";
  await page.goto(`/ai-report?from=%2Fprocesses&prompt=${encodeURIComponent(question)}`);
  await expect(page.getByPlaceholder("Ask a question or tell Fred what to add or update…")).toHaveValue(question);
});

test("assistant and composer fit a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/processes");
  await page.getByRole("button", { name: "Ask Fred", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Fred page assistant" });
  await expect(panel.getByRole("button", { name: "Send message to Fred" })).toBeInViewport();
  const box = await panel.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  await expect(panel.getByRole("button", { name: "Close Fred", exact: true })).toBeInViewport();
});
