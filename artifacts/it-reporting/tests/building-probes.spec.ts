import { test, expect, type Page } from "@playwright/test";

const id = "172dd03b-5f99-4692-a993-c28d768bf119";
const buildingId = "10000000-0000-4000-8000-000000000001";
const baseballId = "10000000-0000-4000-8000-000000000002";
const now = new Date().toISOString();
const buildings = [{ id: buildingId, label: "West Campus", normalizedKey: "west-campus" }, { id: baseballId, label: "Baseball Field", normalizedKey: "baseball-field" }];
const schedule = { enabled: false, targetReady: false, reason: "Recurring tests are staged; the server scheduler is disabled.", targetId: "fixed-pilot-target",
  profiles: { quick: { maxBytes: 5 * 1024 ** 2, timeoutSeconds: 10 }, hourly: { maxBytes: 64_000_000, timeoutSeconds: 10 }, capacity: { maxBytes: 10_000_000_000, timeoutSeconds: 900 } },
  timeZone: "America/Chicago", capacityWindows: ["07:00", "19:00"], staggerWindowSeconds: 2700,
  capacityStartDeadlineMinutes: 45, capacityHardEndMinutes: 60, quickConcurrency: 4, hourlyConcurrency: 1, capacityConcurrency: 1 };
const probe = { id, deviceId: "20000000-0000-4000-8000-000000000001", buildingId, assignmentBasis: "catalog-assignment", building: "West Campus", computerName: "WEST-LAB-01", state: "reporting", enabled: true,
  selected: true, selectionRevision: 1, activationAt: now, capabilities: ["throughput-v1"], capable: true, eligible: true, installedAt: now,
  missedSlot: null, missedSlotReason: null, consecutiveFailures: 0, lastThroughputAt: now, lastSeen: now, expectedVoiceSubnet: "10.30.25.0/24", adapterId: null,
  snapshot: { agentVersion: "0.1.4", uptimeSeconds: 3600,
    adapters: [{ id: "voice", name: "Ethernet", state: "Up", ipv4: ["10.30.25.94/24"], gateways: ["10.30.25.254"], dnsServers: ["10.40.1.1"] }],
    keyAlert: { installed: true, serviceState: "Running", version: "0.4.2", uiProcessCount: 1 } }, jobs: [] };
type MockOptions = { role?: string; history?: unknown[]; buildings?: typeof buildings; schedule?: typeof schedule };

// All requests are intercepted fixtures. No campus credential, job, or endpoint is used.
async function mock(page: Page, enabled = true, probes: unknown[] = [probe], options: MockOptions = {}) {
  const jobs: unknown[] = [], mutations: { path: string; body: Record<string, unknown> }[] = [];
  let current = structuredClone(probes), catalog = structuredClone(options.buildings || buildings);
  await page.addInitScript(() => localStorage.setItem("auth_token", "local-ui-test"));
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.route("**/api/**", async route => {
    const { pathname: path } = new URL(route.request().url());
    const method = route.request().method();
    const input = method === "POST" ? route.request().postDataJSON() : null;
    if (method === "POST" && path.startsWith("/api/building-probes")) mutations.push({ path, body: input });
    let body: unknown = [];
    if (path === "/api/auth/me") body = { id: 42, name: "Probe reviewer", email: "reviewer@example.test", role: options.role || "cio", status: "active" };
    if (path.replace(/\/$/, "") === "/api/building-probes") body = { enabled, probes: current, buildings: catalog, schedule: options.schedule || schedule };
    if (path === "/api/building-probes/history") body = { probes: options.history || [] };
    if (path.endsWith("/jobs")) { jobs.push(input); body = { id, status: "pending" }; }
    if (path.endsWith("/selection")) {
      const target = path.split("/").at(-2);
      current = current.map(row => { const value = row as typeof probe; return value.id === target ? { ...value, selected: input.selected, eligible: input.selected && value.capable, selectionRevision: 2, activationAt: input.selected ? now : null } : row; });
      body = { selected: input.selected, revision: 2, activationAt: input.selected ? now : null };
    }
    if (path === "/api/building-probes/buildings" && method === "POST") {
      const created = { id: "10000000-0000-4000-8000-000000000003", label: input.label, normalizedKey: "it-office" };
      catalog.push(created); body = created;
    }
    if (path === "/api/building-probes/assignments") body = { provisioning: { computerName: input.computerName, bootstrapToken: "test-only" } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return { jobs, mutations };
}

test("retains separate bounded network/paging checks and starts no automatic job", async ({ page }) => {
  const state = await mock(page);
  await page.goto("/network/building-probes");
  await expect(page.getByRole("heading", { name: "Building probes", exact: true })).toBeVisible();
  await expect(page.getByText("Hourly · every 60 minutes per computer", { exact: true })).toBeVisible();
  const card = page.getByTestId("probe-card");
  await expect(card).toContainText("WEST-LAB-01");
  await expect(card).toContainText("10.30.25.94/24");
  await expect(card).toContainText("Paging is not yet verified");
  expect(state.mutations).toHaveLength(0);
  await page.screenshot({ path: "test-results/building-probes-desktop.png", fullPage: true });
  await card.screenshot({ path: "test-results/building-probes-desktop-card.png" });
  await card.getByRole("button", { name: "Listen for paging" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Paging capture queued" })).toBeVisible();
  expect(state.jobs).toEqual([{ kind: "multicast" }]);
});

test("stale target shows missed sample and failure status on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, true, [{ ...probe, state: "stale", eligible: false, missedSlot: new Date(Date.now() - 5 * 60_000).toISOString(), missedSlotReason: "skipped_due_to_capacity_contention", consecutiveFailures: 3, lastThroughputAt: new Date(Date.now() - 20 * 60_000).toISOString(), jobs: [{ id, kind: "multicast", status: "completed", createdAt: now,
    result: { completedAt: now, outcome: "no_packets_observed", details: { packets: 0, localAddress: "10.30.25.94", scopeVerified: true } } }] }]);
  await page.goto("/network/building-probes");
  const card = page.getByTestId("probe-card");
  await expect(card).toContainText("no packets observed");
  await expect(card).toContainText("Missed scheduled slot");
  await expect(card).toContainText("skipped due to capacity contention");
  await expect(card).toContainText("Consecutive failures: 3");
  await expect(card).toContainText(/Last speed sample: \d+m ago/);
  await expect(card).toContainText("Probe offline / awaiting check-in");
  await expect(card.getByRole("button", { name: "Listen for paging" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/building-probes-narrow.png", fullPage: true });
  await card.screenshot({ path: "test-results/building-probes-narrow-card.png" });
});

test("disabled monitor cannot enroll or activate a schedule", async ({ page }) => {
  const state = await mock(page, false, []);
  await page.goto("/network/building-probes");
  await expect(page.getByText("Monitoring is not enabled yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create target & provisioning file" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /enable|activate/i })).toHaveCount(0);
  expect(state.mutations).toHaveLength(0);
});

test("enrollment uses an explicit catalog ID and does not select the computer", async ({ page }) => {
  const state = await mock(page, true, []);
  await page.goto("/network/building-probes");
  await page.getByLabel("Canonical building", { exact: true }).selectOption(baseballId);
  await page.getByLabel("Windows computer name", { exact: true }).fill("BASEBALL-LAB");
  await page.getByRole("button", { name: "Create target & provisioning file" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Provision BASEBALL-LAB");
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download provisioning JSON" }).click();
  expect((await downloading).suggestedFilename()).toBe("BASEBALL-LAB.probe.json");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(state.mutations).toEqual([{ path: "/api/building-probes/assignments", body: { buildingId: baseballId, computerName: "BASEBALL-LAB", adapterId: null, expectedVoiceSubnet: null } }]);
  expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain("test-only");
});

test("current and historical duplicates render one computer and one set of adapters/jobs", async ({ page }) => {
  const job = { id: "30000000-0000-4000-8000-000000000001", kind: "network", status: "completed", createdAt: now, result: null };
  const current = { ...probe, computerName: "LP-AA152MB-01", jobs: [job, job], snapshot: { ...probe.snapshot, adapters: [...probe.snapshot.adapters, ...probe.snapshot.adapters] } };
  const historical = { ...current, id: "40000000-0000-4000-8000-000000000001", computerName: " lp-aa152mb-01 ", enabled: false, selected: false, state: "revoked" };
  const retired = { ...historical, id: "40000000-0000-4000-8000-000000000002", deviceId: "20000000-0000-4000-8000-000000000099", computerName: "RETIRED-01" };
  await mock(page, true, [current, current], { history: [historical, historical, retired, retired], buildings: [...buildings, ...buildings] });
  await page.goto("/network/building-probes");
  await expect(page.getByTestId("probe-card")).toHaveCount(1);
  await expect(page.getByTestId("probe-card").getByText("Ethernet · Up", { exact: true })).toHaveCount(1);
  await expect(page.getByTestId("probe-card").getByText("network · completed", { exact: true })).toHaveCount(1);
  await expect(page.getByTestId("assignment-history").locator("summary")).toHaveText("Previous assignments (1)");
  await expect(page.getByTestId("retired-history").locator("summary")).toHaveText("Retired computer history (1)");
  await expect(page.getByTestId("summary-selected-buildings")).toContainText("1");
});

test("two selected PCs share one canonical building; deselection retains enrollment and frees the slot", async ({ page }) => {
  const second = { ...probe, id: "50000000-0000-4000-8000-000000000002", deviceId: "20000000-0000-4000-8000-000000000002", computerName: "LP-F6K6S64" };
  const third = { ...probe, id: "50000000-0000-4000-8000-000000000003", deviceId: "20000000-0000-4000-8000-000000000003", computerName: "IT-SPARE-01", selected: false, eligible: false };
  const state = await mock(page, true, [{ ...probe, computerName: "LP-AA152MB-01" }, second, third]);
  await page.goto("/network/building-probes");
  await expect(page.getByTestId("summary-selected-buildings")).toContainText("1");
  await expect(page.getByTestId("summary-selected-enrolled-computers")).toContainText("2 / 3");
  const spare = page.getByRole("checkbox", { name: "Select IT-SPARE-01 for recurring tests" });
  await expect(spare).toBeDisabled();
  await page.getByRole("checkbox", { name: "Select LP-AA152MB-01 for recurring tests" }).uncheck();
  await expect(spare).toBeEnabled();
  await spare.check();
  await expect(spare).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "IT-SPARE-01 selected persistently" })).toBeVisible();
  expect(state.mutations.map(mutation => mutation.path)).toEqual([`/api/building-probes/assignments/${id}/selection`, `/api/building-probes/assignments/${third.id}/selection`]);
  expect(state.mutations.map(mutation => mutation.body)).toEqual([{ selected: false }, { selected: true }]);
  expect(state.mutations.some(mutation => mutation.path.endsWith("/revoke"))).toBe(false);
  expect(state.jobs).toHaveLength(0);
});

test("old or unenrolled clients can retain staged membership without being called throughput eligible", async ({ page }) => {
  const old = { ...probe, computerName: "LP-AA152MB-01", selected: false, capable: false, eligible: false, capabilities: [], snapshot: { ...probe.snapshot, agentVersion: "0.1.3" }, activationAt: null };
  const waiting = { ...probe, id: "60000000-0000-4000-8000-000000000002", computerName: "LP-F6K6S64", deviceId: null, state: "awaiting_enrollment", selected: false, capable: false, eligible: false, capabilities: [], snapshot: null, activationAt: null };
  const state = await mock(page, true, [old, waiting]);
  await page.goto("/network/building-probes");
  await expect(page.getByText("Staged · not running", { exact: true })).toBeVisible();
  await expect(page.getByText(schedule.reason, { exact: true })).toBeVisible();
  await expect(page.getByText("Up to 64 MB · 10s", { exact: true })).toBeVisible();
  await expect(page.getByText("Configured global transfer lanes: quick 4 · hourly 1 · capacity 1. A computer runs one measurement at a time.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("probe-card").filter({ hasText: "LP-AA152MB-01" })).toContainText("Probe installed version: 0.1.3");
  await expect(page.getByTestId("probe-card").filter({ hasText: "Throughput upgrade required" })).toHaveCount(2);
  await page.getByRole("checkbox", { name: "Select LP-AA152MB-01 for recurring tests" }).check();
  await page.getByRole("checkbox", { name: "Select LP-F6K6S64 for recurring tests" }).check();
  await expect(page.getByRole("status").filter({ hasText: "LP-F6K6S64 selected persistently" })).toBeVisible();
  await expect(page.getByText("Not eligible for throughput", { exact: false })).toHaveCount(2);
  await expect(page.getByTestId("probe-card").filter({ hasText: "LP-AA152MB-01" }).getByRole("button", { name: "Listen for paging" })).toBeEnabled();
  expect(state.jobs).toHaveLength(0);
  expect(state.mutations.every(mutation => mutation.path.endsWith("/selection"))).toBe(true);
});

test("network viewers can request selected manual checks but cannot manage selection or catalog", async ({ page }) => {
  await mock(page, true, [probe], { role: "network" });
  await page.goto("/network/building-probes");
  await expect(page.getByRole("checkbox", { name: "Select WEST-LAB-01 for recurring tests" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Listen for paging" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Create canonical building" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke target", exact: true })).toHaveCount(0);
});

test("non-network users do not load or display current or historical computer reports", async ({ page }) => {
  await mock(page, true, [probe], { role: "helpdesk", history: [{ ...probe, enabled: false }] });
  let requestedReports = false;
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/building-probes")) requestedReports = true; });
  await page.goto("/network/building-probes");
  await expect(page.getByRole("alert").filter({ hasText: "Network administrator access is required" })).toBeVisible();
  await expect(page.getByTestId("probe-card")).toHaveCount(0);
  await expect(page.getByTestId("retired-history")).toHaveCount(0);
  expect(requestedReports).toBe(false);
});

test("canonical catalog creation is explicit and transfer bounds come from the server", async ({ page }) => {
  const custom = { ...schedule, capacityStartDeadlineMinutes: 20, capacityHardEndMinutes: 35, profiles: { ...schedule.profiles, hourly: { maxBytes: 32_000_000, timeoutSeconds: 7 } } };
  const state = await mock(page, true, [], { buildings: [], schedule: custom });
  await page.goto("/network/building-probes");
  await expect(page.getByRole("button", { name: "Create target & provisioning file" })).toBeDisabled();
  await expect(page.getByText("Up to 32 MB · 7s", { exact: true })).toBeVisible();
  await expect(page.getByText("Last capacity starts: 07:20 and 19:20. Hard stops: 07:35 and 19:35 · America/Chicago.", { exact: true })).toBeVisible();
  await page.getByLabel("New canonical building label", { exact: true }).fill("IT Office");
  await page.getByRole("button", { name: "Create canonical building" }).click();
  await expect(page.getByLabel("Canonical building", { exact: true }).getByRole("option", { name: "IT Office" })).toHaveCount(1);
  expect(state.mutations).toEqual([{ path: "/api/building-probes/buildings", body: { label: "IT Office" } }]);
});

test("a time-budget capacity measurement shows partial bytes and never claims the full transfer completed", async ({ page }) => {
  const job = { id: "70000000-0000-4000-8000-000000000001", kind: "throughput", status: "completed", createdAt: now, slotAt: now,
    options: { profile: "capacity", maxBytes: 10_000_000_000, timeoutSeconds: 900 },
    result: { outcome: "completed", completedAt: now, details: { profile: "capacity", bytes: 64_000_000, elapsedMs: 900_000, mbps: 0.5688889, termination: "time_budget", rangeCount: 1,
      segments: [{ ordinal: 0, requestedBytes: 1_073_741_824, bytes: 64_000_000, status: 206, elapsedMs: 900_000 }] } } };
  await mock(page, true, [{ ...probe, jobs: [job] }]);
  await page.goto("/network/building-probes");
  const card = page.getByTestId("probe-card");
  await expect(card).toContainText("capacity · finished · measurement recorded");
  await expect(card).toContainText("Transferred 64 MB of up to 10 GB in 15 minutes");
  await expect(card).toContainText("Termination: time budget · measured 0.6 Mbps");
  await expect(card).toContainText("Partial transfer: the byte ceiling was not reached");
  await expect(card).not.toContainText("[object Object]");
});
