export const INFLUX_LAST_SEEN_FIELDS = [
  "percent_packet_loss",
  "average_response_ms",
  "rtt",
  "uptime",
  "sysUpTime",
  "fgSysCpuUsage",
  "fgSysMemUsage",
  "fgSysSesCount",
] as const;

function fluxString(value: string): string {
  return JSON.stringify(value);
}

/** Build the bounded read-only query used by Fred's last-seen tool. */
export function buildInfluxLastSeenFlux(
  bucket: string,
  host: string,
  minutes: number,
): string {
  const fields = `[${INFLUX_LAST_SEEN_FIELDS.map(fluxString).join(", ")}]`;
  const target = fluxString(host);
  return `from(bucket: ${fluxString(bucket)}) |> range(start: -${minutes}m) |> filter(fn: (r) => r.source == ${target} or r.agent_host == ${target} or r.host == ${target} or r.sysName == ${target}) |> filter(fn: (r) => contains(value: r._field, set: ${fields})) |> last() |> keep(columns: ["_time", "_measurement", "_field", "_value", "source", "agent_host", "host", "sysName"])`;
}
