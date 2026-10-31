import { describe, expect, it } from "vitest";
import { projectCapacityMetrics, projectProbeHealth, projectProbeMetrics } from "./building_probe_metrics";

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

describe("logical capacity window projection", () => {
  const window = { capacityJobId: "window", buildingId: "building", originalSampleAt: "2026-10-25T12:01:00Z",
    deadlineAt: "2026-10-25T12:16:00Z", bytesValidated: 3000000000, bytesReserved: 7000000000,
    remainingBytes: 0, state: "running", attempts: [{ deviceId: "primary" }, { deviceId: "alternate" }] };
  it("emits one building-window point with real attempt counts and no invented device identity", () => {
    const metrics = projectCapacityMetrics([window, window]);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({ originalSampleAt: window.originalSampleAt, bytesValidated: 3000000000,
      bytesReserved: 7000000000, remainingBytes: 0, attemptCount: 2, complete: false });
    expect(metrics[0]).not.toHaveProperty("deviceId");
    expect(projectCapacityMetrics([{ ...window, bytesValidated: 10000000000, bytesReserved: 0 }])[0].complete).toBe(true);
  });
  it("refuses impossible aggregate accounting instead of publishing an inflated budget", () => {
    expect(projectCapacityMetrics([{ ...window, bytesReserved: 10000000000 },
      { ...window, bytesValidated: -1 }, { ...window, originalSampleAt: "bad" }])).toEqual([]);
  });
});

describe("NOC health without fabricated performance observations", () => {
  const observedAt = "2026-10-25T12:10:00Z";
  const health = { assignmentId: "assignment", buildingId: "building", deviceId: "real-device", selected: true,
    capable: true, eligible: false, activationAt: "2026-10-25T12:00:00Z", lastSeen: "2026-10-25T12:00:00Z",
    lastThroughputAt: "2026-10-25T12:01:00Z", missedSlot: "2026-10-25T12:05:00Z", consecutiveFailures: 2 };
  it("publishes explicit stale/offline/failure indicators with observation time", () => {
    const [metric] = projectProbeHealth([health, health], observedAt);
    expect(projectProbeHealth([health, health], observedAt)).toHaveLength(1);
    expect(metric).toMatchObject({ observedAt, offline: true, online: false, staleThroughput: true,
      hasThroughputSample: true, heartbeatAgeSeconds: 600, throughputAgeSeconds: 540, missedSlot: true, consecutiveFailures: 2 });
    expect(metric).not.toHaveProperty("mbps");
  });
  it("represents prepared unregistered membership without inventing a physical device or zero-Mbps sample", () => {
    const [metric] = projectProbeHealth([{ ...health, deviceId: null, lastSeen: null, lastThroughputAt: null }], observedAt);
    expect(metric).not.toHaveProperty("deviceId"); expect(metric).not.toHaveProperty("throughputAgeSeconds");
    expect(metric).toMatchObject({ hasThroughputSample: false, offline: true });
  });
  it("clears active missed/stale flags after recovery, and never reports deselected membership as an outage", () => {
    expect(projectProbeHealth([{ ...health, lastSeen: observedAt, lastThroughputAt: observedAt }], observedAt)[0])
      .toMatchObject({ online: true, offline: false, staleThroughput: false, missedSlot: false });
    expect(projectProbeHealth([{ ...health, selected: false }], observedAt)[0])
      .toMatchObject({ offline: false, staleThroughput: false, missedSlot: false });
  });
});
