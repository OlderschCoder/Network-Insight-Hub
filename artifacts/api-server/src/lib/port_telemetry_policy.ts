export const PORT_TELEMETRY_OBSERVATION_POLICY =
  "Error and discard counters, utilization, and optics/DOM are observation-only. " +
  "A null value means that metric was not collected in the current evidence and must be reported as unavailable, never as zero, healthy, normal, or inferred from link state, speed, media type, or the port telemetry timestamp.";

export type PortMeasurementColumns = {
  inErrors: number | null;
  outErrors: number | null;
  inDiscards: number | null;
  outDiscards: number | null;
  inOctets: string | null;
  outOctets: string | null;
  inBps: number | null;
  outBps: number | null;
  utilizationPct: number | null;
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
  temperatureC: number | null;
  opticsStatus: string | null;
};

type PortMeasurementSource = {
  [K in keyof PortMeasurementColumns]?: unknown;
};

function observedNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function observedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

export function observedPortMeasurements(
  source: PortMeasurementSource,
): PortMeasurementColumns {
  return {
    inErrors: observedNumber(source.inErrors),
    outErrors: observedNumber(source.outErrors),
    inDiscards: observedNumber(source.inDiscards),
    outDiscards: observedNumber(source.outDiscards),
    inOctets: observedText(source.inOctets),
    outOctets: observedText(source.outOctets),
    inBps: observedNumber(source.inBps),
    outBps: observedNumber(source.outBps),
    utilizationPct: observedNumber(source.utilizationPct),
    rxPowerDbm: observedNumber(source.rxPowerDbm),
    txPowerDbm: observedNumber(source.txPowerDbm),
    temperatureC: observedNumber(source.temperatureC),
    opticsStatus: observedText(source.opticsStatus),
  };
}

export function fredPortMeasurementOutput(source: PortMeasurementSource) {
  const measurements = observedPortMeasurements(source);
  return {
    errors: {
      in: measurements.inErrors,
      out: measurements.outErrors,
    },
    discards: {
      in: measurements.inDiscards,
      out: measurements.outDiscards,
    },
    utilizationPct: measurements.utilizationPct,
    optics: {
      status: measurements.opticsStatus,
      rxPowerDbm: measurements.rxPowerDbm,
      txPowerDbm: measurements.txPowerDbm,
      temperatureC: measurements.temperatureC,
    },
  };
}

export function hasObservedPortMeasurementIssue(
  source: PortMeasurementSource,
): boolean {
  const measurements = observedPortMeasurements(source);
  const hasCounterIssue = [
    measurements.inErrors,
    measurements.outErrors,
    measurements.inDiscards,
    measurements.outDiscards,
  ].some((value) => value !== null && value > 0);
  const hasHighUtilization =
    measurements.utilizationPct !== null &&
    measurements.utilizationPct >= 80;
  const hasOpticsAlarm =
    measurements.opticsStatus !== null &&
    !["ok", "normal", "up"].includes(measurements.opticsStatus.toLowerCase());
  return hasCounterIssue || hasHighUtilization || hasOpticsAlarm;
}

export function blankUncollectedPortMeasurements(): PortMeasurementColumns {
  return {
    inErrors: null,
    outErrors: null,
    inDiscards: null,
    outDiscards: null,
    inOctets: null,
    outOctets: null,
    inBps: null,
    outBps: null,
    utilizationPct: null,
    rxPowerDbm: null,
    txPowerDbm: null,
    temperatureC: null,
    opticsStatus: null,
  };
}

export function blankUncollectedOptics(): Pick<
  PortMeasurementColumns,
  "rxPowerDbm" | "txPowerDbm" | "temperatureC" | "opticsStatus"
> {
  return {
    rxPowerDbm: null,
    txPowerDbm: null,
    temperatureC: null,
    opticsStatus: null,
  };
}

export function utilizationPercentFromCurrentPoll(input: {
  observedSpeedMbps: number | null;
  inBps: number | null;
  outBps: number | null;
}): number | null {
  const { observedSpeedMbps, inBps, outBps } = input;
  if (
    observedSpeedMbps === null ||
    !Number.isFinite(observedSpeedMbps) ||
    observedSpeedMbps <= 0 ||
    inBps === null ||
    outBps === null ||
    !Number.isFinite(inBps) ||
    !Number.isFinite(outBps)
  ) {
    return null;
  }

  return Math.min(
    100,
    Math.round((Math.max(inBps, outBps) / (observedSpeedMbps * 1_000_000)) * 10_000) / 100,
  );
}
