import { test, expect } from "@playwright/test";
import { uniqueEmail, TEST_PASSWORD } from "./helpers/auth";

// Coverage for the public registration guardrails in artifacts/api-server's
// auth route:
//   - Registration is restricted to @sccc.edu addresses (403 otherwise).
//   - A second registration with an already-registered email is rejected (400).
//
// These checks gate who can create accounts. A regression (e.g. the domain
// check being dropped) would silently let outside emails register, so we pin
// both behaviors here.

test.describe("Registration guardrails", () => {
  test("rejects a non-@sccc.edu email with 403", async ({ request }) => {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const outsideEmail = `e2e_outsider_${ts}_${rand}@gmail.com`;

    const res = await request.post("/api/auth/register", {
      data: {
        email: outsideEmail,
        password: TEST_PASSWORD,
        name: "E2E Outsider",
      },
    });

    expect(
      res.status(),
      `expected 403 for non-@sccc.edu email, got ${res.status()} ${await res.text()}`,
    ).toBe(403);
  });

  test("rejects an already-registered email with 400", async ({ request }) => {
    const email = uniqueEmail("e2e_dupe");

    const firstRes = await request.post("/api/auth/register", {
      data: { email, password: TEST_PASSWORD, name: "E2E Dupe First" },
    });
    expect(
      firstRes.ok(),
      `first register failed: ${firstRes.status()} ${await firstRes.text()}`,
    ).toBeTruthy();

    const secondRes = await request.post("/api/auth/register", {
      data: { email, password: TEST_PASSWORD, name: "E2E Dupe Second" },
    });

    expect(
      secondRes.status(),
      `expected 400 for duplicate email, got ${secondRes.status()} ${await secondRes.text()}`,
    ).toBe(400);
  });
});
