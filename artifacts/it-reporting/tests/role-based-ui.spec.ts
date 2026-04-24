import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

type Role = "helpdesk" | "network_engineer" | "security_engineer" | "cio";

const ROLES: Role[] = ["helpdesk", "network_engineer", "security_engineer", "cio"];

function uniqueEmail(role: Role): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e_${role}_${ts}_${rand}@test.example`;
}

async function registerViaApi(
  request: APIRequestContext,
  role: Role,
): Promise<{ token: string; email: string }> {
  const email = uniqueEmail(role);
  const res = await request.post("/api/auth/register", {
    data: {
      email,
      password: "Password123",
      name: `E2E ${role}`,
      role,
    },
  });
  expect(
    res.ok(),
    `register failed for ${role}: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const body = await res.json();
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
  await expect(page.getByText("SCCC IT HUB")).toBeVisible();
}

test.describe("Role-based UI visibility", () => {
  for (const role of ROLES) {
    test(`role "${role}" sees the correct sidebar, home, and top bar`, async ({
      page,
      request,
    }) => {
      const { token } = await registerViaApi(request, role);
      await loginAndGoHome(page, token);

      const isCIO = role === "cio";
      const sidebar = page.locator('[data-slot="sidebar"], aside').first();
      // Top bar lives in <main> > first <div>; scope queries there to avoid
      // colliding with similarly named buttons elsewhere on the page (e.g. the
      // CIO dashboard's "Quick Add Item" button or extra "Ask AI" CTAs).
      const topBar = page.locator("main > div").first();

      // Top bar buttons must always be present, regardless of role.
      await expect(
        topBar.getByRole("button", { name: "Quick Add", exact: true }),
      ).toBeVisible();
      await expect(
        topBar.getByRole("button", { name: "Ask AI", exact: true }),
      ).toBeVisible();

      // Always-visible sidebar groups.
      await expect(sidebar.getByText("My Work", { exact: true })).toBeVisible();
      await expect(
        sidebar.getByText("Knowledge", { exact: true }),
      ).toBeVisible();
      await expect(sidebar.getByText("Team", { exact: true })).toBeVisible();

      // Always-visible items.
      await expect(
        sidebar.getByRole("link", { name: /my tasks/i }),
      ).toBeVisible();
      await expect(
        sidebar.getByRole("link", { name: /weekly log/i }),
      ).toBeVisible();
      await expect(
        sidebar.getByRole("link", { name: /^network$/i }),
      ).toBeVisible();
      await expect(
        sidebar.getByRole("link", { name: /process library/i }),
      ).toBeVisible();
      await expect(
        sidebar.getByRole("link", { name: /risks & issues/i }),
      ).toBeVisible();
      await expect(
        sidebar.getByRole("link", { name: /post-incident reviews/i }),
      ).toBeVisible();

      // CIO-only group + items.
      const leadership = sidebar.getByText("Leadership & Admin", {
        exact: true,
      });
      const adminLink = sidebar.getByRole("link", { name: /^admin$/i });
      const projectsLink = sidebar.getByRole("link", { name: /^projects$/i });
      const goalsLink = sidebar.getByRole("link", {
        name: /department goals/i,
      });

      if (isCIO) {
        await expect(leadership).toBeVisible();
        await expect(adminLink).toBeVisible();
        await expect(projectsLink).toBeVisible();
        await expect(goalsLink).toBeVisible();
      } else {
        await expect(leadership).toHaveCount(0);
        await expect(adminLink).toHaveCount(0);
        await expect(projectsLink).toHaveCount(0);
        await expect(goalsLink).toHaveCount(0);
      }

      // "/" renders the CIO Dashboard for CIO and MyWork for everyone else.
      const dashboardHeading = page.getByRole("heading", {
        name: /^dashboard$/i,
        level: 1,
      });
      const homeLink = sidebar
        .getByRole("link", { name: isCIO ? /^dashboard$/i : /^home$/i })
        .first();

      if (isCIO) {
        await expect(dashboardHeading).toBeVisible();
        await expect(homeLink).toBeVisible();
      } else {
        await expect(dashboardHeading).toHaveCount(0);
        await expect(homeLink).toBeVisible();
        // MyWork renders a personal greeting headline of the form
        // "<greeting> — here's your work".
        await expect(
          page.getByRole("heading", { name: /here's your work/i, level: 1 }),
        ).toBeVisible();
      }

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
