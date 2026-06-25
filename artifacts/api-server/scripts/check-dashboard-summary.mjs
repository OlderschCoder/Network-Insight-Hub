#!/usr/bin/env node
// Smoke test for GET /api/dashboard/summary.
// Seeds a throwaway active CIO directly in the DB (registration intentionally
// creates inactive, approval-pending users and returns no token), logs in over
// HTTP to obtain a session token, and asserts the route returns 200 with a
// well-formed payload. Guards against the CIO-dashboard 500-on-home regression.
//
// Uses the raw `pg` driver (not @workspace/db, whose TS source isn't runnable
// under plain node) so it can run with: node scripts/check-dashboard-summary.mjs
//
// Usage:
//   API_BASE_URL=http://localhost:8080 node artifacts/api-server/scripts/check-dashboard-summary.mjs

import pg from "pg";
import bcrypt from "bcrypt";

const BASE = process.env.API_BASE_URL ?? "http://localhost:8080";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  assert(databaseUrl, "DATABASE_URL is not set");

  const email = `dashboard-smoke-${Date.now()}-${Math.floor(Math.random() * 1e6)}@sccc.edu`;
  const password = "smokepw123";
  const passwordHash = await bcrypt.hash(password, 10);

  const pool = new pg.Pool({ connectionString: databaseUrl });
  let userId;
  try {
    // Seed a throwaway active CIO (is_active defaults to true).
    const insert = await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, 'cio') RETURNING id`,
      [email, passwordHash, "Dashboard Smoke"],
    );
    userId = insert.rows[0]?.id;
    assert(userId, "failed to seed smoke-test CIO");

    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const loginText = await login.text();
    assert(login.status === 200, `login expected 200, got ${login.status}: ${loginText}`);
    const { token } = JSON.parse(loginText);
    assert(typeof token === "string" && token.length > 0, "login did not return a token");

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
  } finally {
    if (userId) {
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    }
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Smoke check threw:", err);
    process.exit(1);
  });
