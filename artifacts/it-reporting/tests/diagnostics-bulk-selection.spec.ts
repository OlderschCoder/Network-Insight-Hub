import { test, expect, type Page } from "@playwright/test";

// Every API request is intercepted. These fixtures never enroll a machine or run a measurement.
const now = new Date().toISOString();
const guid = (n: number) => `30000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const computer = (n: number, building: string, extra: Record<string, unknown> = {}) => ({
  deviceId: guid(n + 100), adObjectGuid: guid(n), adDomain: "sccc.edu", enrolled: true, revoked: false,
  computerName: `PC-${n}`, adVerified: true, adEnabled: true, online: true, lastCheckIn: now,
  agentVersion: "1.1.0", loggedOnUser: null, capabilities: ["external-probe-v2"],
  location: { building, kind: "network-confirmed", source: "fixture", observedAt: now }, lastResult: null, ...extra,
});
const devices = [computer(1, "AA"), computer(2, "AA"), computer(3, "SU"),
  computer(4, "AA", { online: false }), computer(5, "AA", { revoked: true }),
  computer(11, "AA", { deviceId: null, enrolled: false, online: false }),
  computer(12, "SU", { deviceId: null, enrolled: false, online: false }),
  computer(13, "AA", { deviceId: null, enrolled: false, online: false, adEnabled: false }),
  computer(14, "AA", { deviceId: null, enrolled: false, online: false, adVerified: false }),
  computer(15, "AA", { deviceId: null, enrolled: false, online: false, revoked: true })];

async function portal(page: Page, rows = devices, observedAt = now, entryQuery = "") {
  const calls: { enrollment: { requestId: string; adObjectGuids: string[] }[]; measurements: unknown[]; downloads: number } = { enrollment: [], measurements: [], downloads: 0 };
  page.on("download", () => calls.downloads++);
  await page.addInitScript(() => localStorage.setItem("auth_token", "synthetic-session"));
  const batch = (requestId: string) => {
    const ids = calls.enrollment.find(item => item.requestId === requestId)?.adObjectGuids || [];
    return { requestId, status: "queued", requested: ids.length,
      counts: { queued: ids.length, claimed: 0, installing: 0, installed: 0, online: 0, skipped: 0, unreachable: 0, failed: 0 },
      worker: { ready: false, lastSeenAt: null }, items: ids.map(id => ({ adObjectGuid: id, computerName: rows.find(row => row.adObjectGuid === id)?.computerName, status: "queued" })) };
  };
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path.endsWith("/auth/me")) body = { id: 1, name: "Fixture", email: "fixture@example.invalid", role: "network", isActive: true };
    else if (path.endsWith("/building-diagnostics/overview")) body = { enabled: true, schedulerEnabled: false, targetLabel: "Fred HTTPS path", inventoryUpdatedAt: now,
      adObservedAt: observedAt, devices: rows, buildings: ["AA", "SU"].map(building => ({ building, onlineDevices: 1, eligibleDevices: 1, lastResult: null, noCurrentMeasurement: true })), jobs: [] };
    else if (path.endsWith("/devices/bulk-enrollment") && request.method() === "POST") { const value = request.postDataJSON(); calls.enrollment.push(value); body = batch(value.requestId); }
    else if (path.includes("/devices/bulk-enrollment/")) body = batch(path.split("/").at(-1)!);
    else if (path.endsWith("/building-diagnostics/jobs") && request.method() === "POST") { calls.measurements.push(request.postDataJSON()); body = { queued: 1 }; }
    else if (path.includes("/todos") || path.includes("/notifications")) body = [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/network/diagnostics" + entryQuery);
  await expect(page.getByRole("heading", { name: "Building speed & computers" })).toBeVisible();
  return calls;
}

test("the two master checkboxes are independent and bulk enrollment starts no measurements", async ({ page }) => {
  const calls = await portal(page);
  const enrollAll = page.getByRole("checkbox", { name: "Select all eligible shown computers for enrollment", exact: true });
  const measureAll = page.getByRole("checkbox", { name: "Select all eligible shown computers for speed tests", exact: true });
  await enrollAll.check();
  await expect(page.getByRole("checkbox", { name: "Select PC-11 for enrollment", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Select PC-12 for enrollment", exact: true })).toBeChecked();
  for (const n of [1, 13, 14, 15]) await expect(page.getByRole("checkbox", { name: `Select PC-${n} for enrollment`, exact: true })).toBeDisabled();
  await expect(measureAll).not.toBeChecked();
  await measureAll.check();
  for (const n of [1, 2, 3]) await expect(page.getByRole("checkbox", { name: `Select PC-${n}`, exact: true })).toBeChecked();
  for (const n of [4, 5, 11]) await expect(page.getByRole("checkbox", { name: `Select PC-${n}`, exact: true })).toBeDisabled();
  await expect(enrollAll).toBeChecked();
  expect(calls.enrollment).toHaveLength(0); expect(calls.measurements).toHaveLength(0);
  await page.getByRole("button", { name: "Enroll selected (2)", exact: true }).click();
  await expect.poll(() => calls.enrollment.length).toBe(1);
  expect(calls.enrollment[0].adObjectGuids.sort()).toEqual([guid(11), guid(12)]);
  expect(calls.enrollment[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.getByText("The central deployment worker is unavailable.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Measure selected (3)", exact: true })).toBeEnabled();
  expect(calls.measurements).toHaveLength(0); expect(calls.downloads).toBe(0);
});

test("sender multi-computer handoff deduplicates and selects eligible identities without starting work", async ({ page }) => {
  const calls = await portal(page, devices, now, `?adObjectGuids=${[guid(1), guid(1).toUpperCase(), guid(3), guid(4), guid(99)].join(",")}`);
  await expect(page.getByRole("button", { name: "Measure selected (2)", exact: true })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: "Select PC-1", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Select PC-3", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Select PC-4", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Select PC-2", exact: true })).toHaveCount(0);
  await expect(page.getByText("2 of 4 unique AD computers selected", { exact: false })).toBeVisible();
  expect(calls.measurements).toHaveLength(0); expect(calls.enrollment).toHaveLength(0);
});

test("sender handoff rejects malformed or oversized identity selections", async ({ page }) => {
  const calls = await portal(page, devices, now, `?adObjectGuids=${Array.from({ length: 101 }, (_, n) => guid(n + 1)).join(",")}`);
  await expect(page.getByRole("button", { name: "Measure selected (0)", exact: true })).toBeDisabled();
  await expect(page.getByText("valid selection of up to 100 AD identities", { exact: false })).toBeVisible();
  expect(calls.measurements).toHaveLength(0); expect(calls.enrollment).toHaveLength(0);
});

test("sender handoff never partly accepts a malformed multi-computer selection", async ({ page }) => {
  const calls = await portal(page, devices, now, `?adObjectGuids=${guid(1)},not-an-ad-guid`);
  await expect(page.getByRole("button", { name: "Measure selected (0)", exact: true })).toBeDisabled();
  await expect(page.getByText("valid selection of up to 100 AD identities", { exact: false })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select PC-1", exact: true })).not.toBeChecked();
  expect(calls.measurements).toHaveLength(0); expect(calls.enrollment).toHaveLength(0);
});

test("select all respects shown filters and renders a partial selection as indeterminate", async ({ page }) => {
  const calls = await portal(page);
  await page.getByLabel("Filter building").selectOption("AA");
  await page.getByRole("checkbox", { name: "Select PC-1", exact: true }).check();
  const master = page.getByRole("checkbox", { name: "Select all eligible shown computers for speed tests", exact: true });
  await expect.poll(() => master.evaluate(element => (element as HTMLInputElement).indeterminate)).toBe(true);
  await master.check();
  await expect(page.getByRole("button", { name: "Measure selected (2)", exact: true })).toBeEnabled();
  await page.getByRole("checkbox", { name: "Select all eligible shown computers for enrollment", exact: true }).check();
  await expect(page.getByRole("button", { name: "Enroll selected (1)", exact: true })).toBeEnabled();
  await page.getByLabel("Filter building").selectOption("SU");
  await expect(master).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Select PC-3", exact: true }).check();
  await master.uncheck();
  await expect(page.getByRole("button", { name: "Measure selected (2)", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Enroll selected (1)", exact: true })).toBeEnabled();
  expect(calls.enrollment).toHaveLength(0); expect(calls.measurements).toHaveLength(0);
});

test("stale AD evidence prevents bulk enrollment", async ({ page }) => {
  const calls = await portal(page, devices, new Date(Date.now() - 25 * 60 * 60_000).toISOString());
  await expect(page.getByRole("checkbox", { name: "Select all eligible shown computers for enrollment", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Enroll selected (0)", exact: true })).toBeDisabled();
  expect(calls.enrollment).toHaveLength(0); expect(calls.measurements).toHaveLength(0);
});

test("select all preserves the existing 100-computer measurement request bound", async ({ page }) => {
  const calls = await portal(page, Array.from({ length: 101 }, (_, index) => computer(index + 1, "AA")));
  await page.getByRole("checkbox", { name: "Select all eligible shown computers for speed tests", exact: true }).check();
  await expect(page.getByRole("button", { name: "Measure selected (101)", exact: true })).toBeDisabled();
  await expect(page.getByText("A measurement request supports up to 100 computers.", { exact: false })).toBeVisible();
  expect(calls.measurements).toHaveLength(0);
});

test("one bulk enrollment request includes a full 675-computer eligible roster", async ({ page }) => {
  const calls = await portal(page, Array.from({ length: 675 }, (_, index) => computer(index + 1, "AA", { deviceId: null, enrolled: false, online: false })));
  await page.getByRole("checkbox", { name: "Select all eligible shown computers for enrollment", exact: true }).check();
  expect(calls.enrollment).toHaveLength(0);
  await page.getByRole("button", { name: "Enroll selected (675)", exact: true }).click();
  await expect.poll(() => calls.enrollment.length).toBe(1);
  expect(calls.enrollment[0].adObjectGuids).toHaveLength(675);
  expect(new Set(calls.enrollment[0].adObjectGuids).size).toBe(675);
  expect(calls.measurements).toHaveLength(0); expect(calls.downloads).toBe(0);
});

test("completed installations update to online without reloading or retaining the waiting reason", async ({ page }) => {
  const calls = await portal(page);
  let polls = 0;
  await page.route("**/api/building-diagnostics/devices/bulk-enrollment/*", async route => {
    const status = ++polls === 1 ? "installed" : "online";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      requestId: new URL(route.request().url()).pathname.split("/").at(-1), status: "completed", requested: 1,
      counts: { queued: 0, claimed: 0, installing: 0, installed: status === "installed" ? 1 : 0, online: status === "online" ? 1 : 0, skipped: 0, unreachable: 0, failed: 0 },
      worker: { ready: true, lastSeenAt: now }, items: [{ adObjectGuid: guid(11), computerName: "PC-11", status, reason: "installed-awaiting-check-in", updatedAt: now }],
    }) });
  });
  await page.getByRole("checkbox", { name: "Select PC-11 for enrollment", exact: true }).check();
  await page.getByRole("button", { name: "Enroll selected (1)", exact: true }).click();
  await page.getByText("Enrollment results (1)", { exact: true }).click();
  await expect(page.getByText("PC-11 · installed · installed-awaiting-check-in", { exact: true })).toBeVisible();
  await expect(page.getByText("PC-11 · online", { exact: true })).toBeVisible();
  await expect(page.getByText("installed-awaiting-check-in", { exact: false })).toHaveCount(0);
  expect(polls).toBeGreaterThanOrEqual(2);
  expect(calls.enrollment).toHaveLength(1); expect(calls.measurements).toHaveLength(0); expect(calls.downloads).toBe(0);
});
