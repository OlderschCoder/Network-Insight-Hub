import { describe, expect, it } from "vitest";
import { projectProbeMetrics } from "./building_probe_metrics";

const row = () => ({ sampleId: "a".repeat(64), jobId: "job", deviceId: "device", buildingId: "building",
  testType: "hourly", originalSampleAt: "2026-10-25T19:01:02.123Z", receivedAt: "2026-10-25T21:00:00Z",
  credential: "never-export", result: { kind: "throughput", outcome: "completed", details: {
    profile: "hourly", termination: "time_budget", bytes: 12500000, elapsedMs: 10000,
    mbps: 10, rangeCount: 1, linkSpeedBps: 1000000000, localAddress: "10.1.2.3", token: "never-export" } } });

describe("existing NOC metrics projection", () => {
  it("keeps immutable original sample time and measured throughput separate from link rate", () => {
    const [metric] = projectProbeMetrics([row()]);
    expect(metric).toMatchObject({ originalSampleAt: "2026-10-25T19:01:02.123Z", bytes: 12500000,
      elapsedMs: 10000, mbps: 10, linkSpeedBps: 1000000000, successful: true });
    expect(metric).not.toHaveProperty("receivedAt");
    expect(JSON.stringify(metric)).not.toMatch(/never-export|10\.1\.2\.3/);
  });
  it("repeated cursor pages produce the same point and duplicate sample rows are emitted once", () => {
    expect(projectProbeMetrics([row(), row()])).toEqual(projectProbeMetrics([row()]));
    expect(projectProbeMetrics([row()])).toEqual(projectProbeMetrics([{ ...row(), receivedAt: "2026-10-26T00:00:00Z" }]));
  });
  it("keeps unavailable throughput missing instead of inventing a zero-Mbps observation", () => {
    const value = row(); value.result.outcome = "unavailable";
    (value.result.details as any).mbps = null;
    const [metric] = projectProbeMetrics([value]);
    expect(metric.successful).toBe(false); expect(metric).not.toHaveProperty("mbps");
  });
  it("excludes invalid identity/time, non-throughput and unexpected profile rows", () => {
    expect(projectProbeMetrics([{ ...row(), sampleId: "bad" }, { ...row(), originalSampleAt: "bad" },
      { ...row(), result: { ...row().result, kind: "network" } },
      { ...row(), result: { ...row().result, details: { profile: "arbitrary" } } }])).toEqual([]);
  });
});
