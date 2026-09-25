export type NetworkLiveStatus = "up" | "degraded" | "down" | "unknown";
export type NetworkStatusSource = "observed" | "fallback" | "unknown";
export type NetworkStatusObservation = {
  status: NetworkLiveStatus;
  lastObservedAt: string | null;
};
export type ResolvedNetworkStatus = NetworkStatusObservation & {
  source: NetworkStatusSource;
};
export const NETWORK_STATUS_FALLBACK_MAX_AGE_MS = 36 * 60 * 60 * 1000;

function validObservationTime(
  value: string | Date | null | undefined,
): Date | null {
  const observedAt = value instanceof Date ? value : value ? new Date(value) : null;
  return observedAt && !Number.isNaN(observedAt.getTime()) ? observedAt : null;
}

function latestIso(values: Array<string | null | undefined>): string | null {
  const valid = values
    .map((value) => validObservationTime(value))
    .filter((value): value is Date => !!value)
    .sort((a, b) => b.getTime() - a.getTime());
  return valid[0]?.toISOString() ?? null;
}

/**
 * Merge current positive/negative observations. A positive observation wins
 * because it proves the target answered from at least one configured source.
 */
export function mergeNetworkStatusSignals(
  ...values: Array<NetworkLiveStatus | undefined>
): NetworkLiveStatus {
  const observed = values.filter(
    (value): value is NetworkLiveStatus => !!value && value !== "unknown",
  );
  if (observed.includes("up")) return "up";
  if (observed.includes("degraded")) return "degraded";
  if (observed.includes("down")) return "down";
  return "unknown";
}

/** Merge observations without dropping the collection time for the winner. */
export function mergeNetworkStatusObservations(
  ...observations: Array<NetworkStatusObservation | undefined>
): NetworkStatusObservation {
  const status = mergeNetworkStatusSignals(
    ...observations.map((observation) => observation?.status),
  );
  const matchingTimes = observations
    .filter((observation) => observation?.status === status)
    .map((observation) => observation?.lastObservedAt);
  return { status, lastObservedAt: latestIso(matchingTimes) };
}

/**
 * An unobserved target is not a fault. A recent, timestamped imported
 * observation can be used as fallback; an undated/default or stale inventory
 * label cannot be promoted into live evidence.
 */
export function resolveNetworkStatus(
  observed: NetworkLiveStatus | undefined,
  inventoryStatus: string | null | undefined,
  inventoryObservedAt?: string | Date | null,
  nowMs = Date.now(),
): NetworkLiveStatus {
  return resolveNetworkStatusEvidence(
    observed,
    null,
    inventoryStatus,
    inventoryObservedAt,
    nowMs,
  ).status;
}

/** Resolve status while retaining whether it is current, fallback, or absent. */
export function resolveNetworkStatusEvidence(
  observed: NetworkLiveStatus | undefined,
  observedAt: string | Date | null | undefined,
  inventoryStatus: string | null | undefined,
  inventoryObservedAt?: string | Date | null,
  nowMs = Date.now(),
): ResolvedNetworkStatus {
  if (observed && observed !== "unknown") {
    return {
      status: observed,
      source: "observed",
      lastObservedAt: validObservationTime(observedAt)?.toISOString() ?? null,
    };
  }

  const fallbackObservedAt = validObservationTime(inventoryObservedAt);
  if (
    !fallbackObservedAt ||
    nowMs - fallbackObservedAt.getTime() > NETWORK_STATUS_FALLBACK_MAX_AGE_MS ||
    fallbackObservedAt.getTime() > nowMs + 5 * 60 * 1000
  ) {
    return {
      status: "unknown",
      source: "unknown",
      lastObservedAt:
        fallbackObservedAt && fallbackObservedAt.getTime() <= nowMs + 5 * 60 * 1000
          ? fallbackObservedAt.toISOString()
          : null,
    };
  }
  const stored = String(inventoryStatus ?? "").trim().toLowerCase();
  const status = stored === "online" || stored === "up"
    ? "up"
    : stored === "offline" || stored === "down"
      ? "down"
      : stored === "degraded"
        ? "degraded"
        : "unknown";
  return {
    status,
    source: status === "unknown" ? "unknown" : "fallback",
    lastObservedAt: fallbackObservedAt.toISOString(),
  };
}

export function summarizeNetworkStatusEvidence(
  evidence: ResolvedNetworkStatus[],
): {
  observedCount: number;
  fallbackCount: number;
  unknownCount: number;
  lastObservedAt: string | null;
} {
  return {
    observedCount: evidence.filter((item) => item.source === "observed").length,
    fallbackCount: evidence.filter((item) => item.source === "fallback").length,
    unknownCount: evidence.filter((item) => item.source === "unknown").length,
    lastObservedAt: latestIso(evidence.map((item) => item.lastObservedAt)),
  };
}

/** A one-vantage negative probe is an observation gap, not proof of outage. */
export function statusFromNocProbe(
  reachable: boolean,
  error?: string | null,
): NetworkLiveStatus {
  if (error) return "unknown";
  return reachable ? "up" : "unknown";
}

export function healthColorFromNetworkStatuses(
  statuses: NetworkLiveStatus[],
): "green" | "amber" | "red" | "unknown" {
  // Unknown is evidence coverage, not service degradation. It must be shown
  // in the underlying device evidence and must not turn an otherwise healthy
  // building amber merely because one target was not observed from this vantage.
  const observed = statuses.filter((status) => status !== "unknown");
  if (observed.length === 0) return "unknown";
  if (observed.every((status) => status === "up")) return "green";
  if (observed.every((status) => status === "down")) return "red";
  if (observed.includes("up") || observed.includes("degraded")) return "amber";
  return "red";
}
