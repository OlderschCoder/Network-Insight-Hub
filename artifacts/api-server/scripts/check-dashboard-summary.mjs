#!/usr/bin/env node
// Smoke test for GET /api/dashboard/summary.
// Registers a fresh CIO with no prior data and asserts the route returns 200
// and a well-formed payload. Guards against regressions like the one tracked
// in task #9 (CIO dashboard 500 on home page).
//
// Usage:
//   API_BASE_URL=http://localhost:8080 node artifacts/api-server/scripts/check-dashboard-summary.mjs

const BASE = process.env.API_BASE_URL ?? "http://localhost:8080";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

async function main() {
  const email = `dashboard-smoke-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "smokepw123", name: "Dashboard Smoke", role: "cio" }),
  });
  const regBodyText = await reg.text();
  assert(reg.status === 201, `register expected 201, got ${reg.status}: ${regBodyText}`);
  const { token } = JSON.parse(regBodyText);
  assert(typeof token === "string" && token.length > 0, "register did not return a token");

  const res = await fetch(`${BASE}/api/dashboard/summary`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const resBodyText = await res.text();
  assert(res.status === 200, `summary expected 200, got ${res.status}: ${resBodyText}`);

  const body = JSON.parse(resBodyText);
  const numericFields = [
    "thisWeekEntries",
    "thisWeekContributors",
    "openRisks",
    "criticalRisks",
    "openAfterActions",
    "totalSwitches",
    "onlineSwitches",
    "offlineSwitches",
    "totalReports",
    "pendingSubmissions",
    "totalTickets",
  ];
  for (const k of numericFields) {
    assert(typeof body[k] === "number" && Number.isFinite(body[k]) && body[k] >= 0,
      `field ${k} should be a non-negative number, got ${JSON.stringify(body[k])}`);
  }

  console.log("OK /api/dashboard/summary returned 200 with valid payload:", body);
}

main().catch((err) => {
  console.error("Smoke check threw:", err);
  process.exit(1);
});
