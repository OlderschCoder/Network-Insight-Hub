import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));

import { buildLatestBuildingPerformance } from "./building_performance";

describe("building performance summaries", () => {
  const now = Date.parse("2026-10-27T06:00:00.000Z");

  it("keeps the newest exact authoritative building measurement", () => {
    const result = buildLatestBuildingPerformance([
      {
        building: "Hobble",
        recorded_at: "2026-10-27T05:50:00.000Z",
        computer_name: "LP-AA152MB-01",
        logged_on_user: "SCCC\\mark.bojeun",
        data: { downloadMbps: 842.4, uploadMbps: 611.2, latencyMs: 4.2, requestLossPercent: 0 },
      },
      {
        building: "Hobble",
        recorded_at: "2026-10-27T04:00:00.000Z",
        data: { downloadMbps: 100 },
      },
    ], now);

    expect(result.Hobble).toMatchObject({
      status: "measured",
      computerName: "LP-AA152MB-01",
      user: "SCCC\\mark.bojeun",
      downloadMbps: 842.4,
      uploadMbps: 611.2,
    });
  });

  it("rejects ambiguous historical building labels", () => {
    const result = buildLatestBuildingPerformance([
      {
        building: "Main Campus",
        recorded_at: "2026-10-27T05:50:00.000Z",
        data: { downloadMbps: 900 },
      },
      {
        building: "Technical School",
        recorded_at: "2026-10-27T05:50:00.000Z",
        data: { downloadMbps: 900 },
      },
    ], now);

    expect(result).toEqual({});
  });

  it("labels old and failed measurements honestly", () => {
    const result = buildLatestBuildingPerformance([
      {
        building: "West Campus",
        recorded_at: "2026-10-26T12:00:00.000Z",
        data: { downloadMbps: 320 },
      },
      {
        building: "Agriculture",
        recorded_at: "2026-10-27T05:55:00.000Z",
        data: { error: "deadline exceeded", downloadMbps: null },
      },
    ], now);

    expect(result["West Campus"].status).toBe("stale");
    expect(result.Agriculture).toMatchObject({ status: "failed", error: "deadline exceeded" });
  });
});
