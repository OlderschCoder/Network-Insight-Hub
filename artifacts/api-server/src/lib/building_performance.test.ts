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
      sampleCount: 1,
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

  it("projects only closed per-interface LibreSpeed V2 measurements", () => {
    const result = buildLatestBuildingPerformance([{
      building: "Hobble",
      recorded_at: "2026-10-27T05:58:00.000Z",
      data: { libreSpeed: { measurements: [
        { adapterKind: "ethernet", downloadMbps: 889.2, uploadMbps: 726.1, pingMs: 22.4, jitterMs: 1.2, transferClosed: true },
        { adapterKind: "wifi", downloadMbps: 399.4, uploadMbps: 420.3, pingMs: 28.1, jitterMs: 2.4, transferClosed: true },
        { adapterKind: "wifi", downloadMbps: 999, uploadMbps: 999, pingMs: 1, jitterMs: 1, transferClosed: false },
      ] } },
    }], now);

    expect(result.Hobble).toMatchObject({ downloadMbps: 889.2, uploadMbps: 726.1, latencyMs: 22.4 });
    expect(result.Hobble.interfaces).toEqual([
      { adapterKind: "ethernet", downloadMbps: 889.2, uploadMbps: 726.1, pingMs: 22.4, jitterMs: 1.2, transferClosed: true },
      { adapterKind: "wifi", downloadMbps: 399.4, uploadMbps: 420.3, pingMs: 28.1, jitterMs: 2.4, transferClosed: true },
    ]);
  });

  it("averages each endpoint's latest validated result for a building", () => {
    const result = buildLatestBuildingPerformance([
      { building: "Hobble", recorded_at: "2026-10-27T05:58:00.000Z", computer_name: "PC-1",
        data: { libreSpeed: { measurements: [{ adapterKind: "ethernet", downloadMbps: 900, uploadMbps: 700, pingMs: 10, jitterMs: 2, transferClosed: true }] } } },
      { building: "Hobble", recorded_at: "2026-10-27T05:57:00.000Z", computer_name: "PC-2",
        data: { libreSpeed: { measurements: [{ adapterKind: "ethernet", downloadMbps: 700, uploadMbps: 500, pingMs: 14, jitterMs: 4, transferClosed: true }] } } },
    ], now);
    expect(result.Hobble).toMatchObject({ sampleCount: 2, computerName: null, user: null,
      downloadMbps: 800, uploadMbps: 600, latencyMs: 12 });
    expect(result.Hobble.interfaces[0]).toMatchObject({ adapterKind: "ethernet", downloadMbps: 800, uploadMbps: 600 });
  });
});
