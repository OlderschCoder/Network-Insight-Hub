import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.E2E_BASE_URL ||
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:8081");

const chromiumExecutablePath =
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumExecutablePath
          ? { executablePath: chromiumExecutablePath }
          : undefined,
      },
    },
  ],
});
