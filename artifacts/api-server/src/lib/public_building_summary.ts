export type PublicBuildingSummary = {
  name: string;
  nodeCount: number;
  vlanCount: number;
  healthColor: "green" | "amber" | "red" | "unknown";
  influxConfigured: boolean;
};

/**
 * Keep the unauthenticated campus map useful without publishing the internal
 * evidence used to decide a building's operational state.
 */
export function toPublicBuildingSummary<T extends PublicBuildingSummary>(
  summary: T,
): PublicBuildingSummary {
  return {
    name: summary.name,
    nodeCount: summary.nodeCount,
    vlanCount: summary.vlanCount,
    healthColor: summary.healthColor,
    influxConfigured: summary.influxConfigured,
  };
}
