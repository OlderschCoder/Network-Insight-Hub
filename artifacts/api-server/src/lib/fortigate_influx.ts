export type FortiGateInterfaceTelemetry = {
  name: string;
  description: string | null;
  ifIndex: number | null;
  ifType: number | null;
  mtu: number | null;
  macAddress: string | null;
  adminStatus: string | null;
  operStatus: string | null;
  speedMbps: number | null;
  inErrors: number | null;
  outErrors: number | null;
  inDiscards: number | null;
  outDiscards: number | null;
  inOctets: number | null;
  outOctets: number | null;
  observedAt: string | null;
  measurement: string;
};

export type FortiGateTunnelTelemetry = {
  index: string | null;
  phase1: string;
  phase2: string;
  vdom: string | null;
  status: "up" | "down" | "unknown";
  inOctets: number | null;
  outOctets: number | null;
  observedAt: string | null;
};

export type NetworkDeviceInfluxTelemetry = {
  configured: boolean;
  reachable: boolean;
  host: string;
  system: {
    uptime: number | null;
    cpuUsagePct: number | null;
    memoryUsagePct: number | null;
    sessionCount: number | null;
    observedAt: string | null;
  };
  pingLoss: number | null;
  rtt: number | null;
  pingObservedAt: string | null;
  interfaces: FortiGateInterfaceTelemetry[];
  tunnels: FortiGateTunnelTelemetry[];
  interfaceTelemetryAvailable: boolean;
  tunnelTelemetryAvailable: boolean;
  lastPolled: string | null;
};

export function projectFortiGateInterfacesToPorts(
  nodeId: string,
  interfaces: FortiGateInterfaceTelemetry[],
) {
  return interfaces.map((iface) => ({
    id: `influx:${nodeId}:${iface.name}`,
    nodeId,
    interfaceName: iface.name,
    ifIndex: iface.ifIndex,
    // IF-MIB type 6 is ethernetCsmacd. Missing type evidence is not treated as
    // a physical port; the UI must stay unknown rather than invent a faceplate.
    isPhysical: iface.ifType === 6,
    description: iface.description,
    ifType: iface.ifType,
    mtu: iface.mtu,
    macAddress: iface.macAddress,
    adminStatus: iface.adminStatus,
    operStatus: iface.operStatus,
    statusReason: null,
    speedMbps: iface.speedMbps,
    duplex: null,
    mediaType: null,
    portMode: null,
    nativeVlan: null,
    allowedVlans: null,
    portchannel: null,
    vpcId: null,
    macCount: null,
    lldpNeighborCount: null,
    inErrors: iface.inErrors,
    outErrors: iface.outErrors,
    inDiscards: iface.inDiscards,
    outDiscards: iface.outDiscards,
    inOctets: iface.inOctets,
    outOctets: iface.outOctets,
    inBps: null,
    outBps: null,
    utilizationPct: null,
    rxPowerDbm: null,
    txPowerDbm: null,
    temperatureC: null,
    opticsStatus: null,
    configEvidence: null,
    telemetryEvidence: `influx:${iface.measurement}`,
    configUpdatedAt: null,
    telemetryUpdatedAt: iface.observedAt,
    createdAt: null,
    updatedAt: iface.observedAt,
  }));
}

export function formatNetworkDeviceTelemetryForFred(
  telemetry: NetworkDeviceInfluxTelemetry,
  minutes: number,
): string {
  if (!telemetry.configured)
    return "InfluxDB is not configured; set INFLUXDB_URL and a read-only INFLUXDB_TOKEN.";
  if (!telemetry.reachable)
    return `InfluxDB did not return a successful device query for ${telemetry.host}; current telemetry is unknown.`;
  if (!telemetry.lastPolled)
    return `No telemetry found for ${telemetry.host} in the last ${minutes} minutes.`;

  const lines = [
    `Latest measured telemetry for ${telemetry.host} (newest observation ${telemetry.lastPolled}):`,
    `- ping loss: ${telemetry.pingLoss == null ? "not collected" : `${telemetry.pingLoss}%`}`,
    `- RTT: ${telemetry.rtt == null ? "not collected" : `${telemetry.rtt} ms`}`,
    `- SNMP uptime ticks: ${telemetry.system.uptime ?? "not collected"}`,
    `- CPU: ${telemetry.system.cpuUsagePct == null ? "not collected" : `${telemetry.system.cpuUsagePct}%`}`,
    `- memory: ${telemetry.system.memoryUsagePct == null ? "not collected" : `${telemetry.system.memoryUsagePct}%`}`,
    `- sessions: ${telemetry.system.sessionCount ?? "not collected"}`,
    `- system telemetry observed: ${telemetry.system.observedAt ?? "not collected"}`,
    `- ping telemetry observed: ${telemetry.pingObservedAt ?? "not collected"}`,
  ];
  if (!telemetry.interfaceTelemetryAvailable) {
    lines.push("- interfaces: dedicated interface telemetry not collected");
  } else {
    lines.push(`- interfaces: ${telemetry.interfaces.length} measured row(s)`);
    for (const iface of telemetry.interfaces.slice(0, 100)) {
      lines.push(
        `  - ${iface.name}: admin=${iface.adminStatus ?? "unknown"}, oper=${iface.operStatus ?? "unknown"}, ` +
          `inErrors=${iface.inErrors ?? "not collected"}, outErrors=${iface.outErrors ?? "not collected"}, observed=${iface.observedAt ?? "unknown"}`,
      );
    }
  }
  if (!telemetry.tunnelTelemetryAvailable) {
    lines.push(
      "- VPN Phase 2 selectors: tunnel telemetry not collected (do not interpret as zero tunnels)",
    );
  } else {
    const up = telemetry.tunnels.filter(
      (tunnel) => tunnel.status === "up",
    ).length;
    const down = telemetry.tunnels.filter(
      (tunnel) => tunnel.status === "down",
    ).length;
    const unknown = telemetry.tunnels.length - up - down;
    lines.push(
      `- VPN Phase 2 selectors: ${telemetry.tunnels.length} measured; ${up} up, ${down} down, ${unknown} unknown`,
    );
    for (const tunnel of telemetry.tunnels.slice(0, 100)) {
      lines.push(
        `  - ${tunnel.phase1} / ${tunnel.phase2} [index=${tunnel.index ?? "unknown"}, vdom=${tunnel.vdom ?? "unknown"}]: ${tunnel.status}, ` +
          `in=${tunnel.inOctets ?? "not collected"}, out=${tunnel.outOctets ?? "not collected"}, observed=${tunnel.observedAt ?? "unknown"}`,
      );
    }
  }
  return lines.join("\n").slice(0, 12_000);
}

type InfluxConfig = {
  url: string;
  token: string;
  org: string;
  bucket: string;
};

type InfluxQueryResult = {
  ok: boolean;
  csv: string;
};

const INTERFACE_MEASUREMENTS = [
  "fortigate_interface",
  "interface",
  "interface_legacy",
] as const;

function fluxString(value: string): string {
  return JSON.stringify(value);
}

function fluxSet(values: readonly string[]): string {
  return `[${values.map(fluxString).join(", ")}]`;
}

function hostFilter(host: string): string {
  const target = fluxString(host);
  return `(exists r.source and r.source == ${target}) or (exists r.agent_host and r.agent_host == ${target}) or (exists r.host and r.host == ${target}) or (exists r.sysName and r.sysName == ${target})`;
}

export function buildDeviceSummaryFlux(
  bucket: string,
  host: string,
  minutes = 5,
): string {
  const fields = [
    "percent_packet_loss",
    "average_response_ms",
    "rtt",
    "sysUpTime",
    "fgSysCpuUsage",
    "fgSysMemUsage",
    "fgSysSesCount",
  ];
  return `from(bucket: ${fluxString(bucket)}) |> range(start: -${minutes}m) |> filter(fn: (r) => ${hostFilter(host)}) |> filter(fn: (r) => contains(value: r._field, set: ${fluxSet(fields)})) |> group(columns: ["_measurement", "_field"]) |> last() |> group() |> keep(columns: ["_time", "_measurement", "_field", "_value", "source", "agent_host", "host", "sysName"])`;
}

export function buildDeviceInterfacesFlux(
  bucket: string,
  host: string,
  minutes = 5,
): string {
  const fields = [
    "ifIndex",
    "ifName",
    "ifAlias",
    "ifDescr",
    "ifType",
    "ifMtu",
    "ifPhysAddress",
    "ifAdminStatus",
    "ifOperStatus",
    "ifHighSpeed",
    "ifSpeed",
    "ifInErrors",
    "ifOutErrors",
    "ifInDiscards",
    "ifOutDiscards",
    "ifHCInOctets",
    "ifHCOutOctets",
    "ifInOctets",
    "ifOutOctets",
  ];
  return `from(bucket: ${fluxString(bucket)}) |> range(start: -${minutes}m) |> filter(fn: (r) => ${hostFilter(host)}) |> filter(fn: (r) => contains(value: r._measurement, set: ${fluxSet(INTERFACE_MEASUREMENTS)})) |> filter(fn: (r) => contains(value: r._field, set: ${fluxSet(fields)})) |> group(columns: ["_measurement", "ifName", "_field"]) |> last() |> group() |> keep(columns: ["_time", "_measurement", "_field", "_value", "source", "sysName", "ifName", "ifIndex"])`;
}

export function buildDeviceTunnelsFlux(
  bucket: string,
  host: string,
  minutes = 5,
): string {
  const fields = ["status", "inOctets", "outOctets"];
  return `from(bucket: ${fluxString(bucket)}) |> range(start: -${minutes}m) |> filter(fn: (r) => ${hostFilter(host)}) |> filter(fn: (r) => r._measurement == "fortigate_vpn_tunnel") |> filter(fn: (r) => contains(value: r._field, set: ${fluxSet(fields)})) |> group(columns: ["index", "phase1", "phase2", "vdom", "_field"]) |> last() |> group() |> keep(columns: ["_time", "_measurement", "_field", "_value", "source", "sysName", "index", "phase1", "phase2", "vdom"])`;
}

function parseCsvRecord(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      values.push(value);
      value = "";
      continue;
    }
    value += char;
  }
  values.push(value);
  return values;
}

/** Parse annotated Influx CSV, including repeated table headers. */
export function parseInfluxCsv(csv: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  let headers: string[] | null = null;
  for (const rawLine of csv.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.startsWith("#")) continue;
    const values = parseCsvRecord(rawLine);
    if (values.includes("_field") && values.includes("_value")) {
      headers = values;
      continue;
    }
    if (!headers) continue;
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) row[header] = values[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function finiteNumber(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestIso(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}

function snmpAdminStatus(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized === "1" || normalized.startsWith("up")) return "up";
  if (normalized === "2" || normalized.startsWith("down")) return "down";
  if (normalized === "3" || normalized.startsWith("testing")) return "testing";
  return "unknown";
}

function snmpOperStatus(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized === "1" || normalized.startsWith("up")) return "up";
  if (normalized === "2" || normalized.startsWith("down")) return "down";
  if (normalized === "3" || normalized.startsWith("testing")) return "testing";
  if (normalized === "5" || normalized.startsWith("dormant")) return "dormant";
  if (normalized === "6" || normalized.startsWith("notpresent"))
    return "notPresent";
  if (normalized === "7" || normalized.startsWith("lowerlayerdown"))
    return "lowerLayerDown";
  return "unknown";
}

function tunnelStatus(
  value: string | null | undefined,
): "up" | "down" | "unknown" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "2" || normalized.startsWith("up")) return "up";
  if (normalized === "1" || normalized.startsWith("down")) return "down";
  return "unknown";
}

export function parseDeviceSummary(rows: Array<Record<string, string>>) {
  const fields = new Map<string, { value: string; at: string | null }>();
  for (const row of rows) {
    if (!row._field) continue;
    const at = row._time || null;
    const existing = fields.get(row._field);
    if (!existing || latestIso(existing.at, at) === at) {
      fields.set(row._field, { value: row._value, at });
    }
  }
  const latestFieldTime = (names: string[]) =>
    names.reduce<string | null>(
      (latest, name) => latestIso(latest, fields.get(name)?.at ?? null),
      null,
    );
  const systemFields = [
    "sysUpTime",
    "fgSysCpuUsage",
    "fgSysMemUsage",
    "fgSysSesCount",
  ];
  const pingFields = ["percent_packet_loss", "average_response_ms", "rtt"];
  return {
    system: {
      uptime: finiteNumber(fields.get("sysUpTime")?.value),
      cpuUsagePct: finiteNumber(fields.get("fgSysCpuUsage")?.value),
      memoryUsagePct: finiteNumber(fields.get("fgSysMemUsage")?.value),
      sessionCount: finiteNumber(fields.get("fgSysSesCount")?.value),
      observedAt: latestFieldTime(systemFields),
    },
    pingLoss: finiteNumber(fields.get("percent_packet_loss")?.value),
    rtt: finiteNumber(
      fields.get("average_response_ms")?.value ?? fields.get("rtt")?.value,
    ),
    pingObservedAt: latestFieldTime(pingFields),
  };
}

export function parseDeviceInterfaces(
  rows: Array<Record<string, string>>,
): FortiGateInterfaceTelemetry[] {
  const interfaces = new Map<
    string,
    {
      measurement: string;
      observedAt: string | null;
      fields: Map<string, string>;
    }
  >();
  const rank = (measurement: string) =>
    measurement === "fortigate_interface"
      ? 3
      : measurement === "interface"
        ? 2
        : 1;

  for (const row of rows) {
    const name = String(
      row.ifName || (row._field === "ifName" ? row._value : ""),
    ).trim();
    if (!name || !row._field) continue;
    const measurement = row._measurement || "interface";
    const existing = interfaces.get(name);
    if (!existing || rank(measurement) > rank(existing.measurement)) {
      interfaces.set(name, {
        measurement,
        observedAt: row._time || null,
        fields: new Map([[row._field, row._value]]),
      });
      continue;
    }
    if (rank(measurement) < rank(existing.measurement)) continue;
    existing.fields.set(row._field, row._value);
    existing.observedAt = latestIso(existing.observedAt, row._time || null);
  }

  return Array.from(interfaces, ([name, entry]) => {
    const field = (key: string) => entry.fields.get(key);
    const highSpeed = finiteNumber(field("ifHighSpeed"));
    const legacySpeed = finiteNumber(field("ifSpeed"));
    return {
      name,
      description: field("ifAlias") || field("ifDescr") || null,
      ifIndex: finiteNumber(
        field("ifIndex") ??
          rows.find(
            (row) =>
              row.ifName === name && row._measurement === entry.measurement,
          )?.ifIndex,
      ),
      ifType: finiteNumber(field("ifType")),
      mtu: finiteNumber(field("ifMtu")),
      macAddress: field("ifPhysAddress") || null,
      adminStatus: snmpAdminStatus(field("ifAdminStatus")),
      operStatus: snmpOperStatus(field("ifOperStatus")),
      speedMbps:
        highSpeed ?? (legacySpeed == null ? null : legacySpeed / 1_000_000),
      inErrors: finiteNumber(field("ifInErrors")),
      outErrors: finiteNumber(field("ifOutErrors")),
      inDiscards: finiteNumber(field("ifInDiscards")),
      outDiscards: finiteNumber(field("ifOutDiscards")),
      inOctets: finiteNumber(field("ifHCInOctets") ?? field("ifInOctets")),
      outOctets: finiteNumber(field("ifHCOutOctets") ?? field("ifOutOctets")),
      observedAt: entry.observedAt,
      measurement: entry.measurement,
    };
  }).sort((left, right) => {
    if (
      left.ifIndex != null &&
      right.ifIndex != null &&
      left.ifIndex !== right.ifIndex
    ) {
      return left.ifIndex - right.ifIndex;
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true });
  });
}

export function parseDeviceTunnels(
  rows: Array<Record<string, string>>,
): FortiGateTunnelTelemetry[] {
  const tunnels = new Map<
    string,
    {
      index: string | null;
      phase1: string;
      phase2: string;
      vdom: string | null;
      observedAt: string | null;
      fields: Map<string, string>;
    }
  >();
  for (const row of rows) {
    const phase1 = String(row.phase1 || "").trim();
    const phase2 = String(row.phase2 || "").trim();
    if (!phase1 || !phase2 || !row._field) continue;
    const vdom = String(row.vdom || "").trim() || null;
    const index = String(row.index || "").trim() || null;
    const key = [vdom ?? "", phase1, phase2, index ?? ""].join("\u0000");
    const entry = tunnels.get(key) ?? {
      index,
      phase1,
      phase2,
      vdom,
      observedAt: null,
      fields: new Map<string, string>(),
    };
    entry.fields.set(row._field, row._value);
    entry.observedAt = latestIso(entry.observedAt, row._time || null);
    tunnels.set(key, entry);
  }
  return Array.from(tunnels.values(), (entry) => ({
    index: entry.index,
    phase1: entry.phase1,
    phase2: entry.phase2,
    vdom: entry.vdom,
    status: tunnelStatus(entry.fields.get("status")),
    inOctets: finiteNumber(entry.fields.get("inOctets")),
    outOctets: finiteNumber(entry.fields.get("outOctets")),
    observedAt: entry.observedAt,
  })).sort(
    (left, right) =>
      left.phase1.localeCompare(right.phase1, undefined, { numeric: true }) ||
      left.phase2.localeCompare(right.phase2, undefined, { numeric: true }),
  );
}

function readInfluxConfig(): InfluxConfig | null {
  const url = process.env.INFLUXDB_URL?.replace(/\/$/, "");
  const token = process.env.INFLUXDB_TOKEN;
  if (!url || !token) return null;
  return {
    url,
    token,
    org: process.env.INFLUXDB_ORG || "SCCC",
    bucket: process.env.INFLUXDB_BUCKET || "telegraf",
  };
}

async function queryInflux(
  config: InfluxConfig,
  flux: string,
): Promise<InfluxQueryResult> {
  try {
    const response = await fetch(
      `${config.url}/api/v2/query?org=${encodeURIComponent(config.org)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${config.token}`,
          "Content-Type": "application/vnd.flux",
          Accept: "application/csv",
        },
        body: flux,
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) return { ok: false, csv: "" };
    return { ok: true, csv: await response.text() };
  } catch {
    return { ok: false, csv: "" };
  }
}

export async function getNetworkDeviceInfluxTelemetry(
  host: string,
  minutes = 5,
): Promise<NetworkDeviceInfluxTelemetry> {
  const config = readInfluxConfig();
  const empty: NetworkDeviceInfluxTelemetry = {
    configured: !!config,
    reachable: false,
    host,
    system: {
      uptime: null,
      cpuUsagePct: null,
      memoryUsagePct: null,
      sessionCount: null,
      observedAt: null,
    },
    pingLoss: null,
    rtt: null,
    pingObservedAt: null,
    interfaces: [],
    tunnels: [],
    interfaceTelemetryAvailable: false,
    tunnelTelemetryAvailable: false,
    lastPolled: null,
  };
  if (!config) return empty;
  const boundedMinutes = Math.max(5, Math.min(10_080, Math.floor(minutes)));

  const [summaryResult, interfaceResult, tunnelResult] = await Promise.all([
    queryInflux(
      config,
      buildDeviceSummaryFlux(config.bucket, host, boundedMinutes),
    ),
    queryInflux(
      config,
      buildDeviceInterfacesFlux(config.bucket, host, boundedMinutes),
    ),
    queryInflux(
      config,
      buildDeviceTunnelsFlux(config.bucket, host, boundedMinutes),
    ),
  ]);
  const summaryRows = summaryResult.ok ? parseInfluxCsv(summaryResult.csv) : [];
  const interfaceRows = interfaceResult.ok
    ? parseInfluxCsv(interfaceResult.csv)
    : [];
  const tunnelRows = tunnelResult.ok ? parseInfluxCsv(tunnelResult.csv) : [];
  const summary = parseDeviceSummary(summaryRows);
  const interfaces = parseDeviceInterfaces(interfaceRows);
  const tunnels = parseDeviceTunnels(tunnelRows);
  const lastPolled = [
    summary.system.observedAt,
    summary.pingObservedAt,
    ...interfaces.map((item) => item.observedAt),
    ...tunnels.map((item) => item.observedAt),
  ].reduce<string | null>((latest, value) => latestIso(latest, value), null);

  return {
    configured: true,
    reachable: summaryResult.ok || interfaceResult.ok || tunnelResult.ok,
    host,
    ...summary,
    interfaces,
    tunnels,
    interfaceTelemetryAvailable: interfaceResult.ok && interfaces.length > 0,
    tunnelTelemetryAvailable: tunnelResult.ok && tunnels.length > 0,
    lastPolled,
  };
}
