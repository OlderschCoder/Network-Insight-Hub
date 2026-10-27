import { test, expect, type Page } from "@playwright/test";

// All API traffic is synthetic: no enrollment, credentials, or campus load.
const now = new Date().toISOString();
const guid = (n: number) => `30000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const computer = (n: number, extra = {}) => ({ deviceId: guid(n + 100), adObjectGuid: guid(n), adDomain: "sccc.edu", computerName: `PC-${n}`,
  enrolled: true, adVerified: true, adEnabled: true, online: true, lastCheckIn: now, agentVersion: "1.1.0", loggedOnUser: null,
  capabilities: ["external-probe-v2"], location: { building: "Tech Building T", kind: "network-confirmed", source: "switch", observedAt: now }, lastResult: null, ...extra });

async function portal(page: Page, reject = false, legacyBuilding = false) {
  const calls: { assignments: any[]; groupMappings: any[]; otherWrites: string[] } = { assignments: [], groupMappings: [], otherWrites: [] };
  let assignments: any[] = [];
  let mappings: any[] = [];
  const rows = [computer(1), computer(1, { adObjectGuid: guid(1).toUpperCase() }),
    computer(2, { deviceId: null, enrolled: false, online: false }), computer(3, { adVerified: false })];
  await page.addInitScript(() => localStorage.setItem("auth_token", "synthetic-session"));
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body: unknown = {}, status = 200;
    if (path.endsWith("/auth/me")) body = { id: 1, name: "Fixture", role: "network", email: "fixture@example.invalid", isActive: true };
    else if (path.endsWith("/building-diagnostics/overview")) body = { enabled: true, schedulerEnabled: false, targetLabel: "Fred HTTPS path", adObservedAt: now, inventoryUpdatedAt: now,
      devices: rows, buildings: [{ building: "Tech Building T", onlineDevices: 1, eligibleDevices: 1, lastResult: null, noCurrentMeasurement: true }, ...(legacyBuilding ? [{ building: "Academic Arts 144", onlineDevices: 0, eligibleDevices: 0, lastResult: null, noCurrentMeasurement: true }] : [])], jobs: [] };
    else if (path.endsWith("/building-group-mappings") && request.method() === "POST") {
      const value = request.postDataJSON(); calls.groupMappings.push(value);
      mappings = value.building ? [{ ...value, updatedAt: now, updatedBy: "Fixture" }] : [];
      assignments = value.building ? [1, 2].map(n => ({ adObjectGuid: guid(n), building: value.building, source: "active-directory-ou", updatedAt: now, updatedBy: "Fixture", reason: value.reason, directoryObservedAt: now, groups: [{ groupObjectGuid: guid(2000), name: "Fixture-Building-Folder", kind: "organizational-unit", distinguishedName: "OU=Fixture,DC=example,DC=invalid" }] })) : [];
      body = { ok: true };
    } else if (path.endsWith("/building-assignments")) {
      if (request.method() === "POST") {
        const value = request.postDataJSON(); calls.assignments.push(value);
        if (reject) { status = 409; body = { error: "AD inventory changed; review the selection" }; }
        else { assignments = value.building ? value.adObjectGuids.map((id: string) => ({ adObjectGuid: id, building: value.building, source: "manual", updatedAt: now, updatedBy: "Fixture", reason: value.reason })) : [];
          body = { ok: true, updated: value.adObjectGuids.length, assignments }; }
      } else body = { buildings: ["Agriculture", "Hobble", "Tech Building T"], assignments, groupMappings: mappings,
        directory: { observedAt: now, current: true }, groups: [{ groupObjectGuid: guid(2000), name: "Fixture-Building-Folder", kind: "organizational-unit", distinguishedName: "OU=Fixture,DC=example,DC=invalid", computerCount: 2 }], groupConflicts: [] };
    } else if (request.method() !== "GET") calls.otherWrites.push(path);
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/network/diagnostics");
  await expect(page.getByRole("heading", { name: "Assign buildings", exact: true })).toBeVisible();
  return calls;
}

test("canonical assignment filters exclude legacy room labels while recorded labels remain visible", async ({ page }) => {
  const calls = await portal(page, false, true);
  await expect(page.getByLabel("Assign building", { exact: true })).toBeEnabled();
  expect(await page.getByLabel("Filter building", { exact: true }).locator("option").allTextContents()).toEqual(["All buildings", "Building not assigned", "Agriculture", "Hobble", "Tech Building T"]);
  await expect(page.getByText("Academic Arts 144", { exact: true })).toBeVisible();
  await expect(page.getByText("Measurements retain the building label and time recorded when they ran. Current assignments do not relabel earlier results.", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select PC-2 for building assignment", exact: true }).check();
  await page.getByLabel("Assign building", { exact: true }).selectOption("Hobble");
  await page.getByRole("button", { name: "Assign building (1)", exact: true }).click();
  await expect(page.getByText("Building assignment saved for 1 unique computer.", { exact: true })).toBeVisible();
  expect(calls.assignments).toHaveLength(1); expect(calls.otherWrites).toHaveLength(0);
});

test("building assignment uses unique AD checkboxes, includes offline unenrolled computers, and waits for Apply", async ({ page }) => {
  const calls = await portal(page);
  await expect(page.getByText("Showing 3 unique computers.", { exact: false })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select PC-1 for building assignment", exact: true })).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Select all shown AD computers for building assignment", exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "Select PC-2 for building assignment", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Select PC-3 for building assignment", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Select PC-1", exact: true })).not.toBeChecked();
  await page.getByLabel("Assign building", { exact: true }).selectOption("Hobble");
  expect(calls.assignments).toHaveLength(0); expect(calls.otherWrites).toHaveLength(0);
  await page.getByRole("button", { name: "Assign building (2)", exact: true }).click();
  await expect.poll(() => calls.assignments.length).toBe(1);
  expect(calls.assignments[0]).toMatchObject({ apply: true, building: "Hobble", adObjectGuids: [guid(1), guid(2)] });
  await expect(page.getByRole("button", { name: "Assign building (0)", exact: true })).toBeDisabled();
  await page.getByLabel("Filter building", { exact: true }).selectOption("Hobble");
  await expect(page.getByText("Showing 2 unique computers.", { exact: false })).toBeVisible();
  await expect(page.getByText("Connection: Tech Building T", { exact: false })).toHaveCount(2);
  expect(calls.otherWrites).toHaveLength(0);
});

test("AD building folder mappings can be saved and edited without starting a measurement", async ({ page }) => {
  const calls = await portal(page);
  await page.getByLabel("AD building folder", { exact: true }).selectOption(guid(2000));
  await page.getByLabel("AD folder building", { exact: true }).selectOption("Hobble");
  expect(calls.groupMappings).toHaveLength(0);
  await page.getByRole("button", { name: "Save AD folder mapping", exact: true }).click();
  await expect.poll(() => calls.groupMappings.length).toBe(1);
  expect(calls.groupMappings[0]).toMatchObject({ apply: true, groupObjectGuid: guid(2000), building: "Hobble" });
  await expect(page.getByText("AD folder: Fixture-Building-Folder", { exact: false })).toHaveCount(2);
  await page.getByLabel("AD folder building", { exact: true }).selectOption("Agriculture");
  await page.getByRole("button", { name: "Save AD folder mapping", exact: true }).click();
  await expect.poll(() => calls.groupMappings.length).toBe(2);
  expect(calls.groupMappings[1].building).toBe("Agriculture");
  expect(calls.otherWrites).toHaveLength(0); expect(calls.assignments).toHaveLength(0);
});

test("a rejected assignment retains checked computers and starts no other operations", async ({ page }) => {
  const calls = await portal(page, true);
  await page.getByRole("checkbox", { name: "Select PC-1 for building assignment", exact: true }).check();
  await page.getByLabel("Assign building", { exact: true }).selectOption("Agriculture");
  await page.getByRole("button", { name: "Assign building (1)", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "AD inventory changed" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select PC-1 for building assignment", exact: true })).toBeChecked();
  expect(calls.assignments).toHaveLength(1); expect(calls.otherWrites).toHaveLength(0);
});

test("network connection evidence alone never assigns the AD building folder", async ({ page }) => {
  const calls = await portal(page);
  await page.getByRole("button", { name: "Choose one per building", exact: true }).click();
  await expect(page.getByRole("button", { name: "Measure selected (0)", exact: true })).toBeDisabled();
  await page.getByLabel("Filter building", { exact: true }).selectOption("Tech Building T");
  await expect(page.getByText("Showing 0 unique computers.", { exact: false })).toBeVisible();
  await page.getByLabel("Filter building", { exact: true }).selectOption("__unassigned__");
  await expect(page.getByText("Showing 3 unique computers.", { exact: false })).toBeVisible();
  expect(calls.otherWrites).toHaveLength(0); expect(calls.assignments).toHaveLength(0);
});

test("clear is a deliberate reversible metadata action and enrollment/measurement masters remain independent", async ({ page }) => {
  const calls = await portal(page);
  await page.getByRole("checkbox", { name: "Check all shown eligible computers for enrollment", exact: true }).check();
  await expect(page.getByRole("button", { name: "Enroll selected (1)", exact: true })).toBeEnabled();
  await page.getByRole("checkbox", { name: "Check all shown eligible computers for measurement", exact: true }).check();
  await expect(page.getByRole("button", { name: "Measure selected (1)", exact: true })).toBeEnabled();
  await page.getByRole("checkbox", { name: "Select PC-2 for building assignment", exact: true }).check();
  await page.getByLabel("Assign building", { exact: true }).selectOption("__clear__");
  await page.getByRole("button", { name: "Assign building (1)", exact: true }).click();
  await expect.poll(() => calls.assignments.length).toBe(1);
  expect(calls.assignments[0]).toMatchObject({ apply: true, building: null, adObjectGuids: [guid(2)] });
  await expect(page.getByRole("button", { name: "Enroll selected (1)", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Measure selected (1)", exact: true })).toBeEnabled();
  expect(calls.otherWrites).toHaveLength(0);
});
