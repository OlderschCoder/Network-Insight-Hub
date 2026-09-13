export type FredNocPingStatus = "up" | "down" | "unknown";

type NocPingManyEnvelope = {
  operation: "ping_many";
  results: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPingManyEnvelope(value: unknown): value is NocPingManyEnvelope {
  return (
    isRecord(value) &&
    value.operation === "ping_many" &&
    Array.isArray(value.results)
  );
}

/**
 * Runtime-validates the NOC ping-many response before it becomes outage
 * evidence. A malformed, duplicate, or unrequested result invalidates the
 * complete batch so callers can fall through to an independent data source.
 */
export function parseFredNocPingManyResponse(
  value: unknown,
  requestedTargets: readonly string[],
  normalizeTarget: (target: string) => string = (target) =>
    target.trim().toLowerCase(),
): Map<string, FredNocPingStatus> | null {
  if (!isPingManyEnvelope(value)) return null;

  const requested = new Set(requestedTargets.map(normalizeTarget));
  const parsed = new Map<string, FredNocPingStatus>();

  for (const result of value.results) {
    if (!isRecord(result) || typeof result.target !== "string") return null;

    const target = normalizeTarget(result.target);
    if (!target || !requested.has(target) || parsed.has(target)) return null;
    if (typeof result.reachable !== "boolean") return null;
    if (
      result.error !== undefined &&
      result.error !== null &&
      typeof result.error !== "string"
    ) {
      return null;
    }

    parsed.set(
      target,
      typeof result.error === "string" && result.error.length > 0
        ? "unknown"
        : result.reachable
          ? "up"
          : "down",
    );
  }

  for (const target of requested) {
    if (!parsed.has(target)) parsed.set(target, "unknown");
  }

  return parsed;
}
