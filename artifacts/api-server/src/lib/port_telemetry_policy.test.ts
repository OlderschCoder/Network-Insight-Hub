import { describe, expect, it } from "vitest";
import {
  blankUncollectedPortMeasurements,
  fredPortMeasurementOutput,
  hasObservedPortMeasurementIssue,
  observedPortMeasurements,
  PORT_TELEMETRY_OBSERVATION_POLICY,
  utilizationPercentFromCurrentPoll,
} from "./port_telemetry_policy";

describe("port telemetry observation policy", () => {
  it("keeps missing or untyped measurements blank instead of inventing zero", () => {
    expect(observedPortMeasurements({})).toEqual(
      blankUncollectedPortMeasurements(),
    );
    expect(
      observedPortMeasurements({
        inErrors: "0",
        utilizationPct: "0",
        opticsStatus: " ",
      }),
    ).toEqual(blankUncollectedPortMeasurements());
    expect(fredPortMeasurementOutput({})).toEqual({
      errors: { in: null, out: null },
      discards: { in: null, out: null },
      utilizationPct: null,
      optics: {
        status: null,
        rxPowerDbm: null,
        txPowerDbm: null,
        temperatureC: null,
      },
    });
  });

  it("preserves an observed numeric zero and exact DOM readings", () => {
    const observed = observedPortMeasurements({
      inErrors: 0,
      outErrors: 2,
      inDiscards: 0,
      outDiscards: 1,
      inOctets: "0",
      outOctets: "1234",
      inBps: 0,
      outBps: 8000,
      utilizationPct: 0,
      rxPowerDbm: -4.25,
      txPowerDbm: -2.75,
      temperatureC: 38.5,
      opticsStatus: "normal",
    });

    expect(observed.inErrors).toBe(0);
    expect(observed.utilizationPct).toBe(0);
    expect(observed.rxPowerDbm).toBe(-4.25);
    expect(observed.opticsStatus).toBe("normal");
  });

  it("states that missing measurements cannot be inferred", () => {
    expect(PORT_TELEMETRY_OBSERVATION_POLICY).toContain(
      "must be reported as unavailable",
    );
    expect(PORT_TELEMETRY_OBSERVATION_POLICY).toContain("never as zero");
    expect(PORT_TELEMETRY_OBSERVATION_POLICY).toContain("link state");
  });

  it("does not treat an uncollected metric as a clean or alarmed observation", () => {
    expect(hasObservedPortMeasurementIssue({})).toBe(false);
    expect(
      hasObservedPortMeasurementIssue({
        inErrors: 0,
        outErrors: 0,
        utilizationPct: 0,
        opticsStatus: "normal",
      }),
    ).toBe(false);
    expect(hasObservedPortMeasurementIssue({ inErrors: 1 })).toBe(true);
    expect(hasObservedPortMeasurementIssue({ utilizationPct: 80 })).toBe(true);
    expect(hasObservedPortMeasurementIssue({ opticsStatus: "alarm" })).toBe(true);
  });

  it("clears stale measurement columns for a source that did not collect them", () => {
    const stale = observedPortMeasurements({
      inErrors: 5,
      outErrors: 6,
      inDiscards: 7,
      outDiscards: 8,
      inOctets: "100",
      outOctets: "200",
      inBps: 300,
      outBps: 400,
      utilizationPct: 99,
      rxPowerDbm: -4,
      txPowerDbm: -3,
      temperatureC: 40,
      opticsStatus: "alarm",
    });

    expect({ ...stale, ...blankUncollectedPortMeasurements() }).toEqual(
      blankUncollectedPortMeasurements(),
    );
  });

  it("requires speed from the current poll before calculating utilization", () => {
    expect(
      utilizationPercentFromCurrentPoll({
        observedSpeedMbps: null,
        inBps: 10_000_000,
        outBps: 20_000_000,
      }),
    ).toBeNull();
    expect(
      utilizationPercentFromCurrentPoll({
        observedSpeedMbps: 1_000,
        inBps: 10_000_000,
        outBps: 20_000_000,
      }),
    ).toBe(2);
  });
});
