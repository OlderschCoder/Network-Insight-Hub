export type SwitchPortIssueEvidence = {
  adminStatus?: string | null;
  operStatus?: string | null;
  inErrors?: number | null;
  outErrors?: number | null;
  inDiscards?: number | null;
  outDiscards?: number | null;
  utilizationPct?: number | null;
  opticsStatus?: string | null;
  hasTopologyLink?: boolean;
  lldpNeighborCount?: number | null;
  macCount?: number | null;
  expectedService?: boolean;
};

export type SwitchPortIssueReason =
  | "expected-service-down"
  | "errors"
  | "discards"
  | "high-utilization"
  | "optics-alarm";

const normalized = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

const nonNegative = (value: number | null | undefined) =>
  Number.isFinite(value) ? Math.max(0, Number(value)) : 0;

/**
 * Missing DOM data is coverage information, not an alarm. Only a collector
 * status that explicitly reports an abnormal optical condition is actionable.
 */
export function isExplicitOpticsAlarm(status: unknown): boolean {
  const value = normalized(status);
  if (!value) return false;

  const nonAlarmStates = new Set([
    "ok",
    "normal",
    "up",
    "healthy",
    "good",
    "unknown",
    "uncollected",
    "not-collected",
    "unsupported",
    "not-supported",
    "unavailable",
    "not-available",
    "missing",
    "not-present",
    "absent",
    "no-transceiver",
    "not-applicable",
    "none",
    "null",
    "n/a",
    "na",
    "no-dom",
    "dom-unsupported",
  ]);
  if (nonAlarmStates.has(value)) return false;

  return /(?:^|-)(?:alarm|warning|warn|critical|fault|failed|failure|degraded|threshold-exceeded|low|high|down)(?:-|$)/.test(
    value,
  );
}

/**
 * Classify a collected switch-port snapshot without turning ordinary unused
 * access ports into incidents. An admin-up/oper-down state matters only when
 * another signal says the port is expected to carry service.
 */
export function classifySwitchPortIssue(
  port: SwitchPortIssueEvidence,
): SwitchPortIssueReason[] {
  const reasons: SwitchPortIssueReason[] = [];
  const hasExpectedService =
    port.expectedService === true ||
    port.hasTopologyLink === true ||
    nonNegative(port.lldpNeighborCount) > 0 ||
    nonNegative(port.macCount) > 0;

  if (
    normalized(port.adminStatus) === "up" &&
    ["down", "lower-layer-down", "lowerlayerdown"].includes(
      normalized(port.operStatus),
    ) &&
    hasExpectedService
  ) {
    reasons.push("expected-service-down");
  }

  if (nonNegative(port.inErrors) > 0 || nonNegative(port.outErrors) > 0) {
    reasons.push("errors");
  }
  if (
    nonNegative(port.inDiscards) > 0 ||
    nonNegative(port.outDiscards) > 0
  ) {
    reasons.push("discards");
  }
  if (nonNegative(port.utilizationPct) >= 80) {
    reasons.push("high-utilization");
  }
  if (isExplicitOpticsAlarm(port.opticsStatus)) {
    reasons.push("optics-alarm");
  }

  return reasons;
}

export function hasActionablePortIssue(
  port: SwitchPortIssueEvidence,
): boolean {
  return classifySwitchPortIssue(port).length > 0;
}
