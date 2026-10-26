import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Synthetic browser fixtures only. Never enroll endpoints or request live load.
const now = new Date().toISOString();
const adGuid = (id: string) => `30000000-0000-4000-8000-${id.charCodeAt(0).toString(16).padStart(12, "0")}`;
const device = (id: string, building: string, kind = "network-confirmed") => ({
  deviceId: id, adObjectGuid: adGuid(id), adDomain: "sccc.edu", enrolled: true, computerName: `PC-${id}`, adVerified: true, online: true,
  lastCheckIn: now, agentVersion: "1.1.0", loggedOnUser: "SCCC\\fixture", capabilities: ["external-probe-v2"],
  location: { building, kind, source: kind === "assigned" ? "desk-phone" : "switch", observedAt: now },
  lastResult: null,
});
const snapshot = {
  enabled: true, schedulerEnabled: false, targetLabel: "Fred HTTPS path", inventoryUpdatedAt: now,
  devices: [device("a", "AA"), device("b", "AA"), device("c", "SU"), device("d", "AA", "assigned"),
    { ...device("not-installed", ""), deviceId: null, enrolled: false, online: false, lastCheckIn: null, agentVersion: null, location: { building: null, kind: "unknown", source: null, observedAt: null } }],
  buildings: ["AA", "SU"].map(building => ({ building, onlineDevices: 2, eligibleDevices: 1, lastResult: null, noCurrentMeasurement: true })),
  jobs: [],
  settings: { schedulerArmed: false, rotationIntervalMinutes: 360, revision: 1, updatedAt: null, updatedBy: null, persisted: true, deploymentSchedulerEnabled: true, effectiveSchedulerEnabled: false },
};

async function mockPortal(page: import("@playwright/test").Page, role = "network", externalConfigured = false) {
  await page.addInitScript(() => localStorage.setItem("auth_token", "fixture-session"));
  const queued: string[][] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith("/auth/me")) body = { id: 1, name: "Fixture", email: "fixture@example.invalid", role, isActive: true };
    else if (path.endsWith("/building-diagnostics/overview")) body = { ...snapshot, externalProbe: { configured: externalConfigured, origin: externalConfigured ? "https://probe.example.invalid" : null, quickBytes: 5242880, sustainedEnabled: externalConfigured, dailyBudgetBytes: 1073741824 } };
    else if (path.endsWith("/building-diagnostics/jobs")) { queued.push(route.request().postDataJSON().deviceIds); body = { queued: queued[queued.length - 1].length }; }
    else if (path.includes("/todos") || path.includes("/notifications")) body = [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return queued;
}

test("shows missing measurements honestly and selects only network-confirmed building samples", async ({ page }) => {
  const queued = await mockPortal(page);
  await page.goto("/network/diagnostics");
  await expect(page.getByRole("heading", { name: "Building speed & computers" })).toBeVisible();
  await expect(page.getByText("No current measurement", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Assigned office", { exact: false })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select PC-not-installed", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Choose one per building" }).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await expect(page.getByRole("checkbox", { name: "Select PC-d", exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "Measure selected (2)", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 measurements queued" })).toBeVisible();
  expect(queued).toHaveLength(1);
  expect(queued[0]).toContain("c");
  expect(queued[0].filter(id => ["a", "b"].includes(id))).toHaveLength(1);
});

test("defaults configured external checks to quick and requires explicit scheduled sustained consent", async ({ page }) => {
  await mockPortal(page, "network", true);
  await page.goto("/network/diagnostics");
  await expect(page.getByLabel("Measurement type")).toHaveValue("external-quick");
  await page.getByLabel("Measurement type").selectOption("external-sustained");
  await page.getByRole("checkbox", { name: "Select PC-a", exact: true }).check();
  await expect(page.getByRole("button", { name: "Measure selected (1)", exact: true })).toBeDisabled();
  await page.getByLabel("Approve sustained data use").check();
  await expect(page.getByRole("button", { name: "Measure selected (1)", exact: true })).toBeEnabled();
  await page.getByRole("checkbox", { name: "Select PC-b", exact: true }).check();
  await expect(page.getByRole("button", { name: "Measure selected (2)", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Select PC-b", exact: true }).uncheck();
  const submitted = page.waitForRequest(request => request.url().endsWith("/building-diagnostics/jobs") && request.method() === "POST");
  await page.getByRole("button", { name: "Measure selected (1)", exact: true }).click();
  const payload = (await submitted).postDataJSON();
  expect(payload).toMatchObject({ type: "external-sustained", deviceIds: ["a"], sustainedConfirmed: true, maxBytes: 67108864 });
  expect(Date.parse(payload.scheduledAt)).toBeGreaterThan(Date.now());
});

test("does not fetch inventory or offer measurements to a helpdesk user", async ({ page }) => {
  await mockPortal(page, "helpdesk");
  let fetched = false;
  page.on("request", request => { if (request.url().includes("/building-diagnostics/")) fetched = true; });
  await page.goto("/network/diagnostics");
  await expect(page.getByRole("alert").filter({ hasText: "Network administrator access is required" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose one per building" })).toHaveCount(0);
  expect(fetched).toBe(false);
});

test("sender entry locates the verified AD object and never starts a measurement automatically", async ({ page }) => {
  const queued = await mockPortal(page);
  await page.goto(`/network/diagnostics?sso=1&adObjectGuid=${adGuid("a")}`);
  await expect(page.getByRole("checkbox", { name: "Select PC-a", exact: true })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "no test has started" })).toBeVisible();
  expect(queued).toHaveLength(0);
});

test("sender entry explains an unenrolled computer without selecting a name match", async ({ page }) => {
  const queued = await mockPortal(page);
  await page.goto(`/network/diagnostics?sso=1&adObjectGuid=${adGuid("not-installed")}`);
  await expect(page.getByRole("status").filter({ hasText: "Diagnostic agent not enrolled" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select PC-not-installed", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
  expect(queued).toHaveLength(0);
});

test("only CIO can edit the automatic rotation schedule", async ({ page }) => {
  await mockPortal(page, "network");
  await page.goto("/network/diagnostics");
  await expect(page.getByLabel("Enable automatic building rotation")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save rotation schedule" })).toHaveCount(0);
});

test("CIO saves an explicit rotation setting without queuing manual or external tests", async ({ page }) => {
  const queued = await mockPortal(page, "cio");
  await page.route("**/api/building-diagnostics/settings", route => route.fulfill({ json: { ...snapshot.settings, schedulerArmed: true, effectiveSchedulerEnabled: true } }));
  await page.goto("/network/diagnostics");
  await page.getByLabel("Enable automatic building rotation").check();
  await page.getByLabel("Rotation interval").selectOption("60");
  const saved = page.waitForRequest(request => request.url().endsWith("/building-diagnostics/settings") && request.method() === "PUT");
  await page.getByRole("button", { name: "Save rotation schedule" }).click();
  expect((await saved).postDataJSON()).toEqual({ schedulerArmed: true, rotationIntervalMinutes: 60 });
  await expect(page.getByRole("status").filter({ hasText: "Automatic Fred-path rotation enabled" })).toBeVisible();
  expect(queued).toHaveLength(0);
});

test("enrollment requires review and downloads a one-shot credential without persisting it in browser storage", async ({ page }) => {
  const queued = await mockPortal(page);
  const token = `sccc-diag.${"A".repeat(43)}`; // Synthetic credential, never valid against a server.
  let enrollments = 0;
  await page.route("**/api/building-diagnostics/devices/provision", route => {
    enrollments++;
    return route.fulfill({ json: { deviceId: "40000000-0000-4000-8000-000000000001", deviceToken: token, computerName: "PC-not-installed", domain: "sccc.edu" } });
  });
  await page.goto("/network/diagnostics");
  await page.getByRole("button", { name: "Enroll PC-not-installed", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review diagnostic enrollment" })).toBeVisible();
  expect(enrollments).toBe(0);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Confirm enroll", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("PC-not-installed-diagnostics-provisioning.json");
  const content = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(content).toMatchObject({ serverUrl: "https://insights.sccc.edu", computerName: "PC-not-installed", domain: "sccc.edu", deviceToken: token });
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(token);
  expect(enrollments).toBe(1);
  expect(queued).toHaveLength(0);
});

test("diagnostics entry starts existing Fred SSO once, preserving the selected AD target", async ({ page }) => {
  const canonical = "https://canonical.example.invalid";
  // Serve a second HTTPS origin's SPA/assets entirely from the loopback fixture.
  // No Microsoft request, real authentication cookie or external API is used.
  const localOrigin = test.info().project.use.baseURL || "http://127.0.0.1:18641";
  await page.route(`${canonical}/**`, async route => {
    const url = new URL(route.request().url());
    const response = await page.request.get(new URL(`${url.pathname}${url.search}`, localOrigin).href);
    await route.fulfill({ response });
  });
  let started = 0;
  await page.route("**/api/auth/entra/status", route => route.fulfill({ json: { configured: true, loginOrigin: canonical } }));
  await page.route("**/api/auth/entra/login", route => { started++; return route.fulfill({ contentType: "text/html", body: "Microsoft sign-in fixture" }); });
  const target = `/network/diagnostics?sso=1&adObjectGuid=${adGuid("a")}`;
  await page.goto(target);
  await page.waitForURL(`${canonical}/api/auth/entra/login`);
  expect(await page.evaluate(() => sessionStorage.getItem("post_login_redirect"))).toBe(target);
  expect(started).toBe(1);
});

test("Fred sign-in refusal stops automatic redirects and retains a manual retry", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("post_login_redirect", "/network/diagnostics?sso=1");
    sessionStorage.setItem("diagnostics_sso_attempted", "1");
  });
  let started = 0;
  await page.route("**/api/auth/entra/status", route => route.fulfill({ json: { configured: true } }));
  await page.route("**/api/auth/entra/login", route => { started++; return route.fulfill({ body: "Unexpected restart" }); });
  await page.goto("/login?entra_error=Access%20refused");
  await expect(page.getByRole("button", { name: "Sign in with Microsoft" })).toBeVisible();
  await expect(page.getByText("Access refused", { exact: true })).toBeVisible();
  expect(started).toBe(0);
});

test("canonical callback origin receives the complete diagnostics target before any OIDC start", async ({ page }) => {
  const canonical = "https://canonical.example.invalid";
  await page.addInitScript(() => sessionStorage.setItem("diagnostics_sso_attempted", "1"));
  await page.route("**/api/auth/entra/status", route => route.fulfill({ json: { configured: true, loginOrigin: canonical } }));
  let started = 0;
  await page.route("**/api/auth/entra/login", route => { started++; return route.fulfill({ body: "Unexpected alias OIDC start" }); });
  await page.route(`${canonical}/network/diagnostics?**`, route => route.fulfill({ contentType: "text/html", body: "Canonical diagnostics entry fixture" }));
  const target = `/network/diagnostics?sso=1&adObjectGuid=${adGuid("a")}`;
  await page.goto(target);
  await page.waitForURL(`${canonical}${target}`);
  expect(started).toBe(0);
});

test("invalid canonical metadata stops the automatic entry without navigating to an arbitrary origin", async ({ page }) => {
  await page.route("**/api/auth/entra/status", route => route.fulfill({ json: { configured: true, loginOrigin: "https://user:pass@evil.example.invalid/redirect?next=elsewhere" } }));
  await page.goto("/network/diagnostics?sso=1");
  await expect(page.getByRole("alert").filter({ hasText: "registered HTTPS address could not be verified" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/login");
});
