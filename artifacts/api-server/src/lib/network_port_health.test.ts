import { describe, expect, it } from "vitest";
import {
  classifySwitchPortIssue,
  hasActionablePortIssue,
  isExplicitOpticsAlarm,
} from "./network_port_health";

describe("switch port issue classification", () => {
  it("does not flag an ordinary unused access port", () => {
    expect(
      hasActionablePortIssue({
        adminStatus: "up",
        operStatus: "down",
        macCount: 0,
        lldpNeighborCount: 0,
      }),
    ).toBe(false);
  });

  it.each([
    { hasTopologyLink: true },
    { lldpNeighborCount: 1 },
    { macCount: 1 },
    { expectedService: true },
  ])("flags an expected connection that is down: %o", (evidence) => {
    expect(
      classifySwitchPortIssue({
        adminStatus: "up",
        operStatus: "down",
        ...evidence,
      }),
    ).toContain("expected-service-down");
  });

  it("does not infer an outage from missing or unknown operational state", () => {
    expect(
      hasActionablePortIssue({
        adminStatus: "up",
        operStatus: "unknown",
        expectedService: true,
      }),
    ).toBe(false);
    expect(
      hasActionablePortIssue({ adminStatus: "up", expectedService: true }),
    ).toBe(false);
  });

  it("keeps errors, discards, and high utilization actionable", () => {
    expect(classifySwitchPortIssue({ inErrors: 1 })).toEqual(["errors"]);
    expect(classifySwitchPortIssue({ outDiscards: 1 })).toEqual(["discards"]);
    expect(classifySwitchPortIssue({ utilizationPct: 80 })).toEqual([
      "high-utilization",
    ]);
  });

  it.each([
    undefined,
    null,
    "",
    "unknown",
    "uncollected",
    "not collected",
    "unsupported",
    "DOM unsupported",
    "not present",
    "no transceiver",
    "not applicable",
    "unavailable",
    "N/A",
    "normal",
  ])("does not treat absent DOM state %o as an alarm", (status) => {
    expect(isExplicitOpticsAlarm(status)).toBe(false);
    expect(hasActionablePortIssue({ opticsStatus: status })).toBe(false);
  });

  it.each(["alarm", "rx low alarm", "critical", "fault", "degraded"])(
    "retains explicit optics alarm %s",
    (status) => {
      expect(isExplicitOpticsAlarm(status)).toBe(true);
      expect(classifySwitchPortIssue({ opticsStatus: status })).toContain(
        "optics-alarm",
      );
    },
  );
});
