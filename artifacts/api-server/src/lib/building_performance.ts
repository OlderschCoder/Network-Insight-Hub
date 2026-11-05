import { pool } from "@workspace/db";
import { DEFAULT_AUTHORITATIVE_BUILDINGS } from "./building_assignment";
import { diagnosticsBuildingName } from "./building_diagnostics_catalog";
import { LIBRESPEED_METHOD, LIBRESPEED_ORIGIN, LIBRESPEED_SERVER_ID } from "./building_diagnostics";

export const BUILDING_PERFORMANCE_FRESH_MS = 12 * 60 * 60_000;

export type BuildingPerformanceStatus = "measured" | "stale" | "failed";

export interface BuildingPerformanceProvenance {
  kind: "external-librespeed" | "external-https" | "local" | "unknown";
  explicitExternal: boolean;
  serverOrigin: string | null;
  serverId: number | null;
  method: string | null;
}

export interface BuildingPerformance {
  status: BuildingPerformanceStatus;
  recordedAt: string;
  computerName: string | null;
  user: string | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
  lossPercent: number | null;
  testType: string | null;
  targetLabel: string | null;
  provenance: BuildingPerformanceProvenance;
  error: string | null;
  sampleCount: number;
  interfaces: Array<{
    adapterKind: "ethernet" | "wifi";
    downloadMbps: number;
    uploadMbps: number;
    pingMs: number;
    jitterMs: number;
    transferClosed: true;
  }>;
}

export interface BuildingServiceEvidence {
  internetUp: boolean;
  reason: string;
  observedAt: string | null;
}

interface PerformanceRow {
  building: string;
  recorded_at: Date | string;
  data: Record<string, unknown> | string | null;
  computer_name?: string | null;
  logged_on_user?: string | null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reportData(value: PerformanceRow["data"]): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function verifiedInterfaces(data: Record<string, unknown>): BuildingPerformance["interfaces"] {
  const libreSpeed = data.libreSpeed;
  if (!libreSpeed || typeof libreSpeed !== "object") return [];
  const measurements = (libreSpeed as { measurements?: unknown }).measurements;
  if (!Array.isArray(measurements)) return [];
  return measurements.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const adapterKind = item.adapterKind;
    const downloadMbps = finiteNumber(item.downloadMbps);
    const uploadMbps = finiteNumber(item.uploadMbps);
    const pingMs = finiteNumber(item.pingMs);
    const jitterMs = finiteNumber(item.jitterMs);
    if ((adapterKind !== "ethernet" && adapterKind !== "wifi") || item.transferClosed !== true ||
        downloadMbps === null || uploadMbps === null || pingMs === null || jitterMs === null) return [];
    return [{ adapterKind, downloadMbps, uploadMbps, pingMs, jitterMs, transferClosed: true as const }];
  });
}

function isPublicHttpsOrigin(value: string | null): value is string {
  if (!value) return false;
  try {
    const uri = new URL(value);
    const host = uri.hostname.toLowerCase();
    return uri.protocol === "https:" && !uri.port && !uri.username && !uri.password &&
      !uri.search && !uri.hash && uri.pathname === "/" && uri.origin === value &&
      !/^\d+\.\d+\.\d+\.\d+$/.test(host) &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) && host.includes(".") &&
      !/(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test)$/.test(host);
  } catch {
    return false;
  }
}

function successfulExternalHttps(data: Record<string, unknown>, external: Record<string, unknown> | null) {
  const status = finiteNumber(external?.status ?? external?.statusCode ?? external?.httpStatus);
  const bytes = finiteNumber(external?.completedBytes ?? external?.bytesReceived ?? external?.downloadBytes ?? data.completedBytes ?? data.downloadBytes);
  const elapsed = finiteNumber(external?.elapsedMs ?? external?.durationMs ?? data.elapsedMs ?? data.durationMs);
  const failed = data.failed === true || external?.failed === true ||
    (typeof data.error === "string" && !!data.error.trim()) ||
    (typeof external?.error === "string" && !!external.error.trim()) ||
    (typeof external?.failure === "string" && !!external.failure.trim());
  return !failed && (status === 200 || status === 206) &&
    bytes !== null && bytes > 0 && elapsed !== null && elapsed > 0;
}

function performanceProvenance(data: Record<string, unknown>): BuildingPerformanceProvenance {
  const type = typeof data.type === "string" ? data.type : null;
  const libreSpeed = data.libreSpeed && typeof data.libreSpeed === "object"
    ? data.libreSpeed as Record<string, unknown>
    : null;
  const serverOrigin = typeof libreSpeed?.serverOrigin === "string" ? libreSpeed.serverOrigin : null;
  const serverId = finiteNumber(libreSpeed?.serverId);
  const method = typeof libreSpeed?.method === "string" ? libreSpeed.method : null;
  const explicitLibreSpeed = type === "librespeed-v2" && serverOrigin === LIBRESPEED_ORIGIN &&
    serverId === LIBRESPEED_SERVER_ID && method === LIBRESPEED_METHOD;
  const external = data.external && typeof data.external === "object"
    ? data.external as Record<string, unknown>
    : null;
  const externalOrigin = typeof external?.targetOrigin === "string" ? external.targetOrigin : null;
  const externalType = typeof external?.type === "string" ? external.type : null;
  const explicitHttps = (type === "external-quick" || type === "external-sustained") &&
    externalType === type && isPublicHttpsOrigin(externalOrigin) && successfulExternalHttps(data, external);
  if (explicitLibreSpeed) {
    return { kind: "external-librespeed", explicitExternal: true, serverOrigin, serverId, method };
  }
  if (explicitHttps) {
    return { kind: "external-https", explicitExternal: true, serverOrigin: externalOrigin, serverId: null, method: "HTTPS" };
  }
  if (type === "fred") {
    return { kind: "local", explicitExternal: false, serverOrigin: null, serverId: null, method: null };
  }
  return { kind: "unknown", explicitExternal: false, serverOrigin, serverId, method };
}

/** Pure decision helper: only fresh, successful, positive, explicitly external evidence asserts Internet up. */
export function getBuildingServiceEvidence(
  performance: BuildingPerformance | null | undefined,
  now = Date.now(),
  freshnessMs = BUILDING_PERFORMANCE_FRESH_MS,
): BuildingServiceEvidence {
  if (!performance) return { internetUp: false, reason: "No external Internet measurement", observedAt: null };
  const observed = Date.parse(performance.recordedAt);
  const observedAt = Number.isFinite(observed) ? new Date(observed).toISOString() : null;
  if (!Number.isFinite(observed) || observed > now || now - observed > freshnessMs) {
    return { internetUp: false, reason: "External Internet measurement is stale or invalid", observedAt };
  }
  if (performance.status !== "measured" || performance.error) {
    return { internetUp: false, reason: "Latest external Internet measurement did not succeed", observedAt };
  }
  if (!performance.provenance.explicitExternal ||
      (performance.provenance.kind !== "external-librespeed" && performance.provenance.kind !== "external-https")) {
    return { internetUp: false, reason: "Latest measurement lacks explicit external provenance", observedAt };
  }
  const positiveInterface = performance.interfaces.some((measurement) =>
    measurement.transferClosed && Number.isFinite(measurement.downloadMbps) && measurement.downloadMbps > 0 &&
    Number.isFinite(measurement.uploadMbps) && measurement.uploadMbps > 0);
  const positiveExternalHttps = performance.provenance.kind === "external-https" &&
    performance.downloadMbps !== null && Number.isFinite(performance.downloadMbps) && performance.downloadMbps > 0;
  if (!positiveInterface && !positiveExternalHttps) {
    return { internetUp: false, reason: "External measurement has no positive completed throughput", observedAt };
  }
  return {
    internetUp: true,
    reason: performance.provenance.kind === "external-librespeed"
      ? "Fresh positive external LibreSpeed throughput"
      : "Fresh positive external HTTPS throughput",
    observedAt,
  };
}

/**
 * Endpoint results are grouped by the reporting catalog. Historical labels such
 * as "Main Campus" and "Technical School" remain excluded because they cannot
 * support a trustworthy per-building baseline.
 */
export function buildLatestBuildingPerformance(
  rows: PerformanceRow[],
  now = Date.now(),
): Record<string, BuildingPerformance> {
  const authoritativeSourceNames = new Set<string>(DEFAULT_AUTHORITATIVE_BUILDINGS);
  const latest: Record<string, BuildingPerformance> = {};
  const grouped = new Map<string, PerformanceRow[]>();

  for (const row of rows) {
    const sourceBuilding = String(row.building ?? "").trim();
    const building = authoritativeSourceNames.has(sourceBuilding)
      ? diagnosticsBuildingName(sourceBuilding)
      : null;
    if (!building) continue;
    const current = grouped.get(building) ?? [];
    current.push(row);
    grouped.set(building, current);
  }

  for (const [building, buildingRows] of grouped) {
    const newestByComputer = new Map<string, PerformanceRow>();
    for (const row of buildingRows) {
      const computer = row.computer_name?.trim().toLowerCase() || `unknown-${newestByComputer.size}`;
      const existing = newestByComputer.get(computer);
      if (!existing || new Date(row.recorded_at).getTime() > new Date(existing.recorded_at).getTime()) {
        newestByComputer.set(computer, row);
      }
    }
    const recent = [...newestByComputer.values()].filter((row) => {
      const at = new Date(row.recorded_at).getTime();
      return Number.isFinite(at) && at <= now && now - at <= BUILDING_PERFORMANCE_FRESH_MS;
    });
    const validated = recent.map((row) => ({ row, data: reportData(row.data) }))
      .map((entry) => ({ ...entry, interfaces: verifiedInterfaces(entry.data), provenance: performanceProvenance(entry.data) }))
      .filter((entry) => entry.interfaces.some((measurement) => measurement.transferClosed &&
          measurement.downloadMbps > 0 && measurement.uploadMbps > 0) &&
        entry.provenance.explicitExternal &&
        !(typeof entry.data.error === "string" && entry.data.error.trim()));

    if (validated.length) {
      const averagedInterfaces = (["ethernet", "wifi"] as const).flatMap((adapterKind) => {
        const samples = validated.flatMap((entry) => entry.interfaces.filter((item) => item.adapterKind === adapterKind));
        if (!samples.length) return [];
        const mean = (key: "downloadMbps" | "uploadMbps" | "pingMs" | "jitterMs") =>
          samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
        return [{ adapterKind, downloadMbps: mean("downloadMbps"), uploadMbps: mean("uploadMbps"),
          pingMs: mean("pingMs"), jitterMs: mean("jitterMs"), transferClosed: true as const }];
      });
      const representatives = validated.map((entry) =>
        entry.interfaces.find((item) => item.adapterKind === "ethernet") ?? entry.interfaces[0]);
      const mean = (key: "downloadMbps" | "uploadMbps" | "pingMs") =>
        representatives.reduce((sum, sample) => sum + sample[key], 0) / representatives.length;
      const newestAt = Math.max(...validated.map((entry) => new Date(entry.row.recorded_at).getTime()));
      const newest = validated.sort((a, b) => new Date(b.row.recorded_at).getTime() - new Date(a.row.recorded_at).getTime())[0];
      latest[building] = {
        status: now - newestAt > BUILDING_PERFORMANCE_FRESH_MS ? "stale" : "measured",
        recordedAt: new Date(newestAt).toISOString(), computerName: null, user: null,
        downloadMbps: mean("downloadMbps"), uploadMbps: mean("uploadMbps"), latencyMs: mean("pingMs"),
        lossPercent: null, testType: "librespeed-v2", targetLabel: "Building average from latest validated external endpoint results",
        provenance: newest.provenance,
        error: null, sampleCount: validated.length, interfaces: averagedInterfaces,
      };
      continue;
    }

    const row = buildingRows.reduce((newest, candidate) =>
      new Date(candidate.recorded_at).getTime() > new Date(newest.recorded_at).getTime() ? candidate : newest);

    const recordedAt = new Date(row.recorded_at);
    if (Number.isNaN(recordedAt.getTime())) continue;
    const data = reportData(row.data);
    const error = typeof data.error === "string" && data.error.trim() ? data.error.trim() : null;
    const ageMs = now - recordedAt.getTime();
    const interfaces = verifiedInterfaces(data);
    const representative = interfaces.find((item) => item.adapterKind === "ethernet") ?? interfaces[0];

    latest[building] = {
      status: error ? "failed" : ageMs < 0 || ageMs > BUILDING_PERFORMANCE_FRESH_MS ? "stale" : "measured",
      recordedAt: recordedAt.toISOString(),
      computerName: row.computer_name?.trim() || null,
      user: row.logged_on_user?.trim() || null,
      downloadMbps: representative?.downloadMbps ?? finiteNumber(data.downloadMbps),
      uploadMbps: representative?.uploadMbps ?? finiteNumber(data.uploadMbps),
      latencyMs: representative?.pingMs ?? finiteNumber(data.latencyMs),
      lossPercent: finiteNumber(data.requestLossPercent),
      testType: typeof data.type === "string" ? data.type : null,
      targetLabel: typeof data.targetLabel === "string" ? data.targetLabel : null,
      provenance: performanceProvenance(data),
      error,
      sampleCount: 1,
      interfaces,
    };
  }

  return latest;
}

export async function getLatestBuildingPerformance(): Promise<Record<string, BuildingPerformance>> {
  try {
    const rows = (await pool.query<PerformanceRow>(`
      SELECT DISTINCT ON (r.building, r.device_id)
        r.building,
        r.recorded_at,
        r.data,
        d.computer_name,
        d.heartbeat->>'loggedOnUser' AS logged_on_user
      FROM building_diagnostics_reports r
      JOIN building_diagnostics_devices d ON d.id = r.device_id
      WHERE r.building IS NOT NULL AND trim(r.building) <> ''
        AND r.recorded_at > now() - interval '24 hours'
      ORDER BY r.building, r.device_id, r.recorded_at DESC, r.id DESC
    `)).rows;
    return buildLatestBuildingPerformance(rows);
  } catch (error) {
    console.warn("Building performance is temporarily unavailable", error instanceof Error ? error.message : error);
    return {};
  }
}
