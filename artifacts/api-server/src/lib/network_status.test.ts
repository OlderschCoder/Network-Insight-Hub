import { describe, expect, it } from "vitest";
import {
  healthColorFromNetworkStatuses,
  mergeNetworkStatusObservations,
  mergeNetworkStatusSignals,
  resolveNetworkStatus,
  resolveNetworkStatusEvidence,
  statusFromNocProbe,
  summarizeNetworkStatusEvidence,
} from "./network_status";

describe("network status evidence", () => {
  it("uses maintained inventory when a current source has no observation", () => {
    const now = Date.parse("2026-09-02T12:00:00Z");
    expect(resolveNetworkStatus("unknown", "online", "2026-09-02T08:00:00Z", now)).toBe("up");
    expect(resolveNetworkStatus(undefined, "offline", "2026-09-02T08:00:00Z", now)).toBe("down");
    expect(resolveNetworkStatus("unknown", "online", null, now)).toBe("unknown");
    expect(resolveNetworkStatus("unknown", "online", "2026-08-30T08:00:00Z", now)).toBe("unknown");
  });

  it("does not replace an observed result with stored state", () => {
    expect(resolveNetworkStatus("down", "online", null)).toBe("down");
    expect(resolveNetworkStatus("up", "offline", null)).toBe("up");
  });

  it("labels recent stored telemetry as fallback and retains its timestamp", () => {
    const now = Date.parse("2026-09-02T12:00:00Z");
    expect(
      resolveNetworkStatusEvidence(
        "unknown",
        null,
        "online",
        "2026-09-02T08:00:00Z",
        now,
      ),
    ).toEqual({
      status: "up",
      source: "fallback",
      lastObservedAt: "2026-09-02T08:00:00.000Z",
    });
  });

  it("keeps a stale last-observed timestamp without presenting it as current", () => {
    const now = Date.parse("2026-09-02T12:00:00Z");
    expect(
      resolveNetworkStatusEvidence(
        undefined,
        null,
        "online",
        "2026-08-30T08:00:00Z",
        now,
      ),
    ).toEqual({
      status: "unknown",
      source: "unknown",
      lastObservedAt: "2026-08-30T08:00:00.000Z",
    });
  });

  it("merges and summarizes provenance without losing observation times", () => {
    const current = mergeNetworkStatusObservations(
      { status: "down", lastObservedAt: "2026-09-02T11:55:00Z" },
      { status: "up", lastObservedAt: "2026-09-02T11:56:00Z" },
    );
    expect(current).toEqual({
      status: "up",
      lastObservedAt: "2026-09-02T11:56:00.000Z",
    });

    expect(
      summarizeNetworkStatusEvidence([
        { ...current, source: "observed" },
        {
          status: "up",
          source: "fallback",
          lastObservedAt: "2026-09-02T08:00:00Z",
        },
        {
          status: "unknown",
          source: "unknown",
          lastObservedAt: "2026-08-30T08:00:00Z",
        },
      ]),
    ).toEqual({
      observedCount: 1,
      fallbackCount: 1,
      unknownCount: 1,
      lastObservedAt: "2026-09-02T11:56:00.000Z",
    });
  });

  it("does not call a one-vantage negative probe a device outage", () => {
    expect(statusFromNocProbe(false)).toBe("unknown");
    expect(statusFromNocProbe(true)).toBe("up");
    expect(statusFromNocProbe(false, "probe unavailable")).toBe("unknown");
  });

  it("keeps unknown coverage separate from service health", () => {
    expect(mergeNetworkStatusSignals("unknown", "up")).toBe("up");
    expect(healthColorFromNetworkStatuses(["up", "up", "up"])).toBe("green");
    expect(healthColorFromNetworkStatuses(["up", "unknown", "unknown"])).toBe("green");
    expect(healthColorFromNetworkStatuses(["down", "unknown"])).toBe("red");
    expect(healthColorFromNetworkStatuses(["unknown", "unknown"])).toBe("unknown");
    expect(healthColorFromNetworkStatuses(["up", "down"])).toBe("amber");
  });
});
