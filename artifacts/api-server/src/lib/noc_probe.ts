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

function getNocProbeConfig(): { base: string; token: string } {
  const base = process.env.NOC_PROBE_URL?.replace(/\/$/, "");
  const token = process.env.NOC_PROBE_TOKEN?.trim();
  if (!base || !token) {
    throw new Error("The NOC probe is not configured on App-Server2.");
  }
  return { base, token };
}

export async function collectLldpViaNoc(
  targets: Array<{ hostname: string; ip: string }>,
): Promise<NocLldpCollectionResult> {
  const cleanTargets = targets
    .map((entry) => ({
      hostname: String(entry.hostname || "").trim().slice(0, 80),
      ip: String(entry.ip || "").trim(),
    }))
    .filter((entry) =>
      /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,253}[A-Za-z0-9])?$/.test(entry.hostname) &&
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(entry.ip),
    )
    .slice(0, 256);

  if (!cleanTargets.length) {
    throw new Error("No configured switch management addresses are available for LLDP collection.");
  }

  const { base, token } = getNocProbeConfig();
  const response = await fetch(`${base}/v1/lldp/collect`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ operation: "lldp_collect", targets: cleanTargets }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`NOC probe request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}.`);
  }
  return response.json() as Promise<NocLldpCollectionResult>;
}
