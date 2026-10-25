import { test, expect } from "@playwright/test";

// Synthetic browser fixtures only. Never enroll endpoints or request live load.
const now = new Date().toISOString();
const device = (id: string, building: string, kind = "network-confirmed") => ({
  deviceId: id, adObjectGuid: `ad-${id}`, enrolled: true, computerName: `PC-${id}`, adVerified: true, online: true,
  lastCheckIn: now, agentVersion: "1.0.0", loggedOnUser: "SCCC\\fixture",
  location: { building, kind, source: kind === "assigned" ? "desk-phone" : "switch", observedAt: now },
  lastResult: null,
});
const snapshot = {
  enabled: true, schedulerEnabled: false, targetLabel: "Fred HTTPS path", inventoryUpdatedAt: now,
  devices: [device("a", "AA"), device("b", "AA"), device("c", "SU"), device("d", "AA", "assigned"),
    { ...device("not-installed", ""), deviceId: null, enrolled: false, online: false, lastCheckIn: null, agentVersion: null, location: { building: null, kind: "unknown", source: null, observedAt: null } }],
  buildings: ["AA", "SU"].map(building => ({ building, onlineDevices: 2, eligibleDevices: 1, lastResult: null, noCurrentMeasurement: true })),
  jobs: [],
};

async function mockPortal(page: import("@playwright/test").Page, role = "network") {
  await page.addInitScript(() => localStorage.setItem("auth_token", "fixture-session"));
  const queued: string[][] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith("/auth/me")) body = { id: 1, name: "Fixture", email: "fixture@example.invalid", role, isActive: true };
    else if (path.endsWith("/building-diagnostics/overview")) body = snapshot;
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

test("does not fetch inventory or offer measurements to a helpdesk user", async ({ page }) => {
  await mockPortal(page, "helpdesk");
  let fetched = false;
  page.on("request", request => { if (request.url().includes("/building-diagnostics/")) fetched = true; });
  await page.goto("/network/diagnostics");
  await expect(page.getByRole("alert").filter({ hasText: "Network administrator access is required" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose one per building" })).toHaveCount(0);
  expect(fetched).toBe(false);
});
