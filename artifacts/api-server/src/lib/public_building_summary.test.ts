import { describe, expect, it } from "vitest";
import { toPublicBuildingSummary } from "./public_building_summary";

describe("public building summary projection", () => {
  it("omits internal phone and main-switch evidence", () => {
    const result = toPublicBuildingSummary({
      name: "West Campus",
      nodeCount: 2,
      deviceCount: 2,
      connectivityObjectCount: 0,
      vlanCount: 5,
      healthColor: "amber" as const,
      influxConfigured: true,
      category: "remote-campus",
      monitoringStrategy: "switch-probe",
      phoneEvidence: {
        totalAssigned: 12,
        online: 11,
        offline: 1,
        unknown: 0,
        complete: true,
        observedAt: "2026-09-14T20:48:10Z",
      },
      mainSwitchConfigured: true,
      mainSwitchStatus: "up",
    });

    expect(result).toEqual({
      name: "West Campus",
      nodeCount: 2,
      vlanCount: 5,
      healthColor: "amber",
      influxConfigured: true,
    });
    expect(result).not.toHaveProperty("phoneEvidence");
    expect(result).not.toHaveProperty("mainSwitchConfigured");
    expect(result).not.toHaveProperty("mainSwitchStatus");
  });
});
