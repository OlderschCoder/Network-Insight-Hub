export type DeviceLiveStatus = "up" | "degraded" | "down" | "unknown";

export const DEFAULT_LIVE_EVIDENCE_MAX_AGE_MS = 90_000;

/**
 * Select the dashboard status using the same evidence priority as Fred.
 * A completed NOC probe is authoritative. Influx is a fallback only while its
 * timestamp is fresh; an old heartbeat must never hide a current NOC failure.
 */
export function selectFreshDeviceStatus(input: {
  nocStatus?: DeviceLiveStatus;
  influx?: { status: DeviceLiveStatus; lastSeen: string | null };
  now?: string | number | Date;
  maxAgeMs?: number;
}): DeviceLiveStatus {
  if (input.nocStatus && input.nocStatus !== "unknown") {
    return input.nocStatus;
  }

  const lastSeenMs = input.influx?.lastSeen
    ? new Date(input.influx.lastSeen).getTime()
    : Number.NaN;
  const nowMs =
    input.now === undefined ? Date.now() : new Date(input.now).getTime();
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_LIVE_EVIDENCE_MAX_AGE_MS;
  if (
    !input.influx ||
    input.influx.status === "unknown" ||
    !Number.isFinite(lastSeenMs) ||
    !Number.isFinite(nowMs) ||
    lastSeenMs > nowMs + 5_000 ||
    nowMs - lastSeenMs > maxAgeMs
  ) {
    return "unknown";
  }
  return input.influx.status;
}
