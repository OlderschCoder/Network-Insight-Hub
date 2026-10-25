import { test, expect, type Page } from "@playwright/test";
const id = "172dd03b-5f99-4692-a993-c28d768bf119";
const now = new Date().toISOString();
const probe = { id, building: "West Campus", computerName: "WEST-LAB-01", state: "reporting", enabled: true,
  lastSeen: now, expectedVoiceSubnet: "10.30.25.0/24", adapterId: null,
  snapshot: { agentVersion: "0.1.0", uptimeSeconds: 3600,
    adapters: [{ id: "voice", name: "Ethernet", state: "Up", ipv4: ["10.30.25.94/24"], gateways: ["10.30.25.254"], dnsServers: ["10.40.1.1"] }],
    keyAlert: { installed: true, serviceState: "Running", version: "0.4.2", uiProcessCount: 1 } }, jobs: [] };
async function mock(page: Page, enabled = true, probes: unknown[] = [probe]) {
  const jobs: unknown[] = [];
  await page.addInitScript(() => localStorage.setItem("auth_token", "local-ui-test"));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname === "/api/auth/me") body = { id: 42, name: "Probe reviewer", email: "reviewer@example.test", role: "cio", status: "active" };
    if (url.pathname.replace(/\/$/, "") === "/api/building-probes") body = { enabled, probes };
    if (url.pathname.endsWith("/jobs")) { jobs.push(route.request().postDataJSON()); body = { id, status: "pending" }; }
    if (url.pathname === "/api/building-probes/assignments") body = { provisioning: { computerName: "BASEBALL-LAB", bootstrapToken: "test-only" } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return jobs;
}
test("selected building status, bounded job request and inconclusive paging label", async ({ page }) => {
  const jobs = await mock(page);
  await page.goto("/network/building-probes");
  await expect(page.getByRole("heading", { name: "Building probes", exact: true })).toBeVisible();
  const card = page.getByTestId("probe-card");
  await expect(card).toContainText("WEST-LAB-01"); await expect(card).toContainText("10.30.25.94/24");
  await expect(card).toContainText("Paging is not yet verified");
  await card.getByRole("button", { name: "Listen for paging" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Paging capture queued" })).toBeVisible();
  expect(jobs).toEqual([{ kind: "multicast" }]);
  await page.locator("main.overflow-auto").evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: "test-results/building-probes-desktop.png" });
});
test("stale target disables tests and no packets remain inconclusive on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, true, [{ ...probe, state: "stale", jobs: [{ id, kind: "multicast", status: "completed", createdAt: now,
    result: { completedAt: now, outcome: "no_packets_observed", details: { packets: 0, localAddress: "10.30.25.94", scopeVerified: true } } }] }]);
  await page.goto("/network/building-probes");
  await expect(page.getByTestId("probe-card")).toContainText("no packets observed");
  await expect(page.getByRole("button", { name: "Listen for paging" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("disabled monitor cannot create targets", async ({ page }) => {
  await mock(page, false, []); await page.goto("/network/building-probes");
  await expect(page.getByText("Monitoring is not enabled yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create target & provisioning file" })).toHaveCount(0);
});
test("creates and downloads a target provision without retaining it after closing", async ({ page }) => {
  await mock(page, true, []); await page.goto("/network/building-probes");
  await page.getByLabel("Building", { exact: true }).fill("Baseball Field");
  await page.getByLabel("Windows computer name", { exact: true }).fill("BASEBALL-LAB");
  await page.getByRole("button", { name: "Create target & provisioning file" }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toContainText("Provision BASEBALL-LAB");
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download provisioning JSON" }).click();
  expect((await downloading).suggestedFilename()).toBe("BASEBALL-LAB.probe.json");
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain("test-only");
});
