export interface NocPingResult {
  operation: "ping";
  target: string;
  reachable: boolean;
  elapsedMs?: number;
  summary?: string;
  error?: string;
  vantage?: string;
}

export interface NocTcpResult {
  operation: "tcp";
  target: string;
  port: number;
  open: boolean;
  elapsedMs?: number;
  error?: string | null;
  vantage?: string;
}

export interface NocPingManyEntry {
  target: string;
  label?: string;
  reachable: boolean;
  elapsedMs?: number;
  error?: string | null;
}

export interface NocPingManyResult {
  operation: "ping_many";
  vantage?: string;
  results: NocPingManyEntry[];
}

export interface NocLldpNeighbor {
  localPortNum: number;
  localPort: string;
  remoteSystemName: string;
  remotePort: string;
  remotePortDescription?: string;
  remoteChassisId?: string;
  remoteSystemDescription?: string;
}

export interface NocInterfaceObservation {
  ifIndex: number;
  interfaceName: string;
  isPhysical: boolean;
  description?: string;
  ifType?: number | null;
  mtu?: number | null;
  macAddress?: string;
  adminStatus?: string | null;
  operStatus?: string | null;
  speedMbps?: number | null;
  nativeVlan?: number | null;
  allowedVlans?: number[];
  portMode?: string;
  portchannel?: string | null;
  inErrors?: number;
  outErrors?: number;
  inDiscards?: number;
  outDiscards?: number;
  inOctets?: string;
  outOctets?: string;
}

export interface NocLldpTargetResult {
  hostname: string;
  ip: string;
  ok: boolean;
  error?: string;
  elapsedMs?: number;
  neighbors: NocLldpNeighbor[];
  interfaces: NocInterfaceObservation[];
}

export interface NocLldpCollectionResult {
  operation: "lldp_collect";
  vantage: string;
  capturedAt: string;
  targets: number;
  successful: number;
  failed: number;
  neighbors: number;
  interfaces: number;
  results: NocLldpTargetResult[];
}

export interface SwitchTelemetryStatus {
  state: "never_run" | "running" | "completed" | "completed_with_warnings" | "failed" | string;
  serviceState?: string;
  vantage?: string;
  runId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  switchesOk?: number;
  switchesFailed?: number;
  importsApplied?: number;
  importsFailed?: number;
  latestAuditAvailable?: boolean;
  message?: string | null;
  accepted?: boolean;
}

const HOST_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,253}[A-Za-z0-9])?$/;

export function isValidNocProbeHost(target: string): boolean {
  return !!target && target.length <= 255 && HOST_RE.test(target);
}

function getNocProbeConfig(): { base: string; token: string } | null {
  const base = process.env.NOC_PROBE_URL?.replace(/\/$/, "");
  const token = process.env.NOC_PROBE_TOKEN?.trim();
  if (!base || !token) return null;
  return { base, token };
}

function getSwitchTelemetryConfig(): { base: string; token: string } | null {
  const noc = getNocProbeConfig();
  if (!noc) return null;
  const configured = process.env.SWITCH_TELEMETRY_URL?.replace(/\/$/, "");
  if (configured) return { base: configured, token: noc.token };
  try {
    const url = new URL(noc.base);
    url.port = "9124";
    url.pathname = "";
    return { base: url.toString().replace(/\/$/, ""), token: noc.token };
  } catch {
    return null;
  }
}

async function requestSwitchTelemetry<T>(path: string, init?: RequestInit): Promise<T> {
  const cfg = getSwitchTelemetryConfig();
  if (!cfg) throw new Error("The switch telemetry service is not configured on App-Server2.");
  const response = await fetch(`${cfg.base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok && response.status !== 409) {
    throw new Error(body?.error ?? `Switch telemetry request failed (${response.status}).`);
  }
  return body as T;
}

export async function startSwitchTelemetryViaNoc(): Promise<SwitchTelemetryStatus> {
  return requestSwitchTelemetry<SwitchTelemetryStatus>("/v1/switch-telemetry/run", {
    method: "POST",
    body: JSON.stringify({ operation: "collect", confirm: true }),
  });
}

export async function getSwitchTelemetryStatusViaNoc(): Promise<SwitchTelemetryStatus> {
  return requestSwitchTelemetry<SwitchTelemetryStatus>("/v1/switch-telemetry/status");
}

export async function getSwitchTelemetryAuditViaNoc(): Promise<Record<string, unknown>> {
  return requestSwitchTelemetry<Record<string, unknown>>("/v1/switch-telemetry/audit");
}

async function postToNoc<T>(
  payload: Record<string, unknown>,
  timeoutMs: number,
  path = "/v1/probe",
): Promise<T> {
  const cfg = getNocProbeConfig();
  if (!cfg) {
    throw new Error("The NOC probe is not configured on App-Server2.");
  }

  const response = await fetch(`${cfg.base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`NOC probe request failed (${response.status}).`);
  }

  return response.json() as Promise<T>;
}

export async function collectLldpViaNoc(
  targets: Array<{ hostname: string; ip: string }>,
): Promise<NocLldpCollectionResult> {
  const cleanTargets = targets
    .map((entry) => ({
      hostname: String(entry.hostname || "").trim().slice(0, 80),
      ip: String(entry.ip || "").trim(),
    }))
    .filter((entry) => isValidNocProbeHost(entry.hostname) && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(entry.ip))
    .slice(0, 256);

  if (!cleanTargets.length) {
    throw new Error("No configured switch management addresses are available for LLDP collection.");
  }

  return postToNoc<NocLldpCollectionResult>(
    { operation: "lldp_collect", targets: cleanTargets },
    300_000,
    "/v1/lldp/collect",
  );
}

export async function pingViaNoc(target: string): Promise<NocPingResult> {
  const cleanTarget = String(target || "").trim();
  if (!isValidNocProbeHost(cleanTarget)) {
    throw new Error("a valid target is required.");
  }
  return postToNoc<NocPingResult>({ operation: "ping", target: cleanTarget }, 10000);
}

export async function tcpViaNoc(target: string, port: number): Promise<NocTcpResult> {
  const cleanTarget = String(target || "").trim();
  if (!isValidNocProbeHost(cleanTarget)) {
    throw new Error("a valid target is required.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("TCP port must be 1-65535.");
  }
  return postToNoc<NocTcpResult>({ operation: "tcp", target: cleanTarget, port }, 10000);
}

export async function pingManyViaNoc(
  targets: Array<{ target: string; label?: string }>,
  opts: { count?: number; timeoutMs?: number } = {},
): Promise<NocPingManyResult> {
  const cleanTargets = targets
    .map((entry) => ({
      target: String(entry.target || "").trim(),
      label: entry.label ? String(entry.label).trim().slice(0, 120) : undefined,
    }))
    .filter((entry) => isValidNocProbeHost(entry.target))
    .slice(0, 256);

  if (!cleanTargets.length) {
    throw new Error("At least one valid target is required.");
  }

  const count = Math.min(Math.max(Number(opts.count) || 1, 1), 2);
  const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || 30000, 5000), 60000);
  try {
    return await postToNoc<NocPingManyResult>(
      {
        operation: "ping_many",
        count,
        targets: cleanTargets,
      },
      timeoutMs,
    );
  } catch (error) {
    // The original NOC probe agent supports only one typed ping per request.
    // Fall back on HTTP 400 so Monitoring can still reconcile its inventory
    // against the NOC without granting arbitrary command execution.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("(400)")) throw error;

    const results = new Array<NocPingManyEntry>(cleanTargets.length);
    let nextIndex = 0;
    let vantage: string | undefined;
    const worker = async () => {
      while (nextIndex < cleanTargets.length) {
        const index = nextIndex++;
        const entry = cleanTargets[index];
        try {
          const observation = await pingViaNoc(entry.target);
          vantage = vantage ?? observation.vantage;
          results[index] = {
            target: entry.target,
            label: entry.label,
            reachable: observation.reachable,
            elapsedMs: observation.elapsedMs,
            error: observation.error ?? null,
          };
        } catch (probeError) {
          results[index] = {
            target: entry.target,
            label: entry.label,
            reachable: false,
            error: probeError instanceof Error ? probeError.message.slice(0, 160) : "probe failed",
          };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(12, cleanTargets.length) }, worker));
    return { operation: "ping_many", vantage, results };
  }
}
