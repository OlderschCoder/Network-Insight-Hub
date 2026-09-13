import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  breakGlass: vi.fn(),
  fredAlerts: vi.fn(),
}));

vi.mock("../lib/seed_breakglass", () => ({
  getBreakGlassStatus: mocks.breakGlass,
}));

vi.mock("../lib/fred_building_alert_worker", () => ({
  getFredAlertWorkerHealth: mocks.fredAlerts,
}));

import healthRouter from "./health";

function makeApp() {
  const app = express();
  app.use("/api", healthRouter);
  return app;
}

describe("health route Fred readiness", () => {
  beforeEach(() => {
    mocks.breakGlass.mockReturnValue({ state: "disabled" });
    mocks.fredAlerts.mockReturnValue({
      state: "disabled",
      lastSuccessAt: null,
      lastErrorAt: null,
      errorCode: null,
    });
  });

  it.each(["disabled", "ok"] as const)(
    "keeps the API healthy when Fred is %s",
    async (state) => {
      mocks.fredAlerts.mockReturnValue({
        state,
        lastSuccessAt: state === "ok" ? "2026-09-13T12:00:00.000Z" : null,
        lastErrorAt: null,
        errorCode: null,
      });

      const response = await request(makeApp()).get("/api/healthz");

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
      expect(response.body.fredAlerts.state).toBe(state);
    },
  );

  it.each(["starting", "degraded"] as const)(
    "returns 503 while an enabled Fred worker is %s",
    async (state) => {
      mocks.fredAlerts.mockReturnValue({
        state,
        lastSuccessAt: null,
        lastErrorAt: state === "degraded" ? "2026-09-13T12:00:00.000Z" : null,
        errorCode: state === "degraded" ? "tick_failed" : null,
      });

      const response = await request(makeApp()).get("/api/healthz");

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        status: "degraded",
        fredAlerts: { state },
      });
    },
  );

  it("does not expose an underlying error message", async () => {
    mocks.fredAlerts.mockReturnValue({
      state: "degraded",
      lastSuccessAt: null,
      lastErrorAt: "2026-09-13T12:00:00.000Z",
      errorCode: "configuration_invalid",
    });

    const response = await request(makeApp()).get("/api/healthz");

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("api-key");
    expect(response.body.fredAlerts).toEqual({
      state: "degraded",
      lastSuccessAt: null,
      lastErrorAt: "2026-09-13T12:00:00.000Z",
      errorCode: "configuration_invalid",
    });
  });
});
