import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";

type Role = "helpdesk" | "network_engineer" | "security_engineer" | "cio";

const ROLES: Role[] = ["helpdesk", "network_engineer", "security_engineer", "cio"];

const PASSWORD = "Password123";

// Registration is restricted to @sccc.edu addresses (see auth route).
function uniqueEmail(role: Role): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e_${role}_${ts}_${rand}@sccc.edu`;
}

// New registrations land in a pending/inactive state, always default to the
// "helpdesk" role, and return no token. So we register a fresh account, flip it
// active and stamp the desired role directly in the database, then log in.
async function registerActivateLogin(
  request: APIRequestContext,
  role: Role,
): Promise<{ token: string; email: string }> {
  const email = uniqueEmail(role);
  const regRes = await request.post("/api/auth/register", {
    data: { email, password: PASSWORD, name: `E2E ${role}` },
  });
  expect(
    regRes.ok(),
    `register failed for ${role}: ${regRes.status()} ${await regRes.text()}`,
  ).toBeTruthy();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      "UPDATE users SET is_active = true, role = $1 WHERE email = $2",
      [role, email],
    );
  } finally {
    await pool.end();
  }

  const loginRes = await request.post("/api/auth/login", {
    data: { email, password: PASSWORD },
  });
  expect(
    loginRes.ok(),
    `login failed for ${role}: ${loginRes.status()} ${await loginRes.text()}`,
  ).toBeTruthy();
  const body = await loginRes.json();
  expect(body.token, `no token returned for ${role}`).toBeTruthy();
  expect(body.user?.role).toBe(role);
  return { token: body.token, email };
}

async function loginAndGoHome(page: Page, token: string) {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("auth_token", t);
    } catch {}
  }, token);
  await page.goto("/");
  await expect(
    page.getByAltText("Seward County Community College").first(),
  ).toBeVisible();
}

test.describe("Role-based UI visibility", () => {
  for (const role of ROLES) {
    test(`role "${role}" sees the correct navigation menu, home, and top bar`, async ({
      page,
      request,
    }) => {
      const { token } = await registerActivateLogin(request, role);
      await loginAndGoHome(page, token);

      const isCIO = role === "cio";
      // The global top bar is the <header> that sits above <main>; scope queries
      // there to avoid colliding with similarly named buttons inside the page
      // body (e.g. the CIO dashboard's "Quick Add Item" button).
      const topBar = page.locator("header").first();

      // Top bar buttons must always be present, regardless of role.
      await expect(
        topBar.getByRole("button", { name: "Quick Add", exact: true }),
      ).toBeVisible();
      await expect(
        topBar.getByRole("button", { name: "Ask AI", exact: true }),
      ).toBeVisible();

      // "/" renders the CIO Dashboard for CIO and MyWork for everyone else.
      // These page-level headings live outside the navigation menu, so assert
      // them before opening the launcher.
      const dashboardHeading = page.getByRole("heading", {
        name: /^dashboard$/i,
        level: 1,
      });
      if (isCIO) {
        await expect(dashboardHeading).toBeVisible();
      } else {
        await expect(dashboardHeading).toHaveCount(0);
        // MyWork renders a personal greeting headline of the form
        // "<greeting> — here's your work".
        await expect(
          page.getByRole("heading", { name: /here's your work/i, level: 1 }),
        ).toBeVisible();
      }

      // Navigation lives in the AppLauncher command palette (opened from the
      // top-bar "Menu" button), not a persistent sidebar. Open it and assert the
      // groups and items each role should see. Item labels and group names come
      // from src/config/nav.tsx; tiles render as buttons, so match by their
      // exact label text.
      await topBar
        .getByRole("button", { name: /search or jump to any page/i })
        .click();
      const menu = page.getByRole("dialog");
      await expect(menu).toBeVisible();

      // Always-visible groups.
      await expect(menu.getByText("My Work", { exact: true })).toBeVisible();
      await expect(
        menu.getByText("Systems & Tools", { exact: true }),
      ).toBeVisible();
      await expect(
        menu.getByText("Reports & Records", { exact: true }),
      ).toBeVisible();

      // The home tile is labeled "Dashboard" for the CIO and "Home" otherwise.
      await expect(
        menu.getByText(isCIO ? "Dashboard" : "Home", { exact: true }),
      ).toBeVisible();

      // Always-visible navigation items.
      for (const label of [
        "My Tasks",
        "Weekly Log",
        "Network",
        "Process Library",
        "Risks & Issues",
        "Post-Incident Reviews",
      ]) {
        await expect(menu.getByText(label, { exact: true })).toBeVisible();
      }

      // CIO-only group + items.
      const leadership = menu.getByText("Leadership & Admin", { exact: true });
      const adminItem = menu.getByText("Admin", { exact: true });
      const projectsItem = menu.getByText("Projects", { exact: true });
      const goalsItem = menu.getByText("Department Goals", { exact: true });

      if (isCIO) {
        await expect(leadership).toBeVisible();
        await expect(adminItem).toBeVisible();
        await expect(projectsItem).toBeVisible();
        await expect(goalsItem).toBeVisible();
      } else {
        await expect(leadership).toHaveCount(0);
        await expect(adminItem).toHaveCount(0);
        await expect(projectsItem).toHaveCount(0);
        await expect(goalsItem).toHaveCount(0);
      }

      // Close the launcher so it doesn't intercept later navigation.
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();

      // Top-bar Quick Add and Ask AI must persist across routes, not just "/".
      for (const path of ["/items", "/entries"]) {
        await page.goto(path);
        await expect(
          topBar.getByRole("button", { name: "Quick Add", exact: true }),
        ).toBeVisible();
        await expect(
          topBar.getByRole("button", { name: "Ask AI", exact: true }),
        ).toBeVisible();
      }
    });
  }
});
