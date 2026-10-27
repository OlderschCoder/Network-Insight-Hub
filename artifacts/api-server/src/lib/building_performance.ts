import { pool } from "@workspace/db";
import { DEFAULT_AUTHORITATIVE_BUILDINGS } from "./building_assignment";

export type BuildingPerformanceStatus = "measured" | "stale" | "failed";

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
  error: string | null;
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

/**
 * Only exact authoritative building names are accepted. Historical labels such
 * as "Main Campus" and "Technical School" are intentionally excluded because
 * they cannot support a trustworthy per-building baseline.
 */
export function buildLatestBuildingPerformance(
  rows: PerformanceRow[],
  now = Date.now(),
): Record<string, BuildingPerformance> {
  const authoritative = new Set<string>(DEFAULT_AUTHORITATIVE_BUILDINGS);
  const latest: Record<string, BuildingPerformance> = {};

  for (const row of rows) {
    const building = String(row.building ?? "").trim();
    if (!authoritative.has(building) || latest[building]) continue;

    const recordedAt = new Date(row.recorded_at);
    if (Number.isNaN(recordedAt.getTime())) continue;
    const data = reportData(row.data);
    const error = typeof data.error === "string" && data.error.trim() ? data.error.trim() : null;
    const ageMs = now - recordedAt.getTime();

    latest[building] = {
      status: error ? "failed" : ageMs > 12 * 60 * 60_000 ? "stale" : "measured",
      recordedAt: recordedAt.toISOString(),
      computerName: row.computer_name?.trim() || null,
      user: row.logged_on_user?.trim() || null,
      downloadMbps: finiteNumber(data.downloadMbps),
      uploadMbps: finiteNumber(data.uploadMbps),
      latencyMs: finiteNumber(data.latencyMs),
      lossPercent: finiteNumber(data.requestLossPercent),
      testType: typeof data.type === "string" ? data.type : null,
      targetLabel: typeof data.targetLabel === "string" ? data.targetLabel : null,
      error,
    };
  }

  return latest;
}

export async function getLatestBuildingPerformance(): Promise<Record<string, BuildingPerformance>> {
  try {
    const rows = (await pool.query<PerformanceRow>(`
      SELECT DISTINCT ON (r.building)
        r.building,
        r.recorded_at,
        r.data,
        d.computer_name,
        d.heartbeat->>'loggedOnUser' AS logged_on_user
      FROM building_diagnostics_reports r
      JOIN building_diagnostics_devices d ON d.id = r.device_id
      WHERE r.building IS NOT NULL AND trim(r.building) <> ''
      ORDER BY r.building, r.recorded_at DESC, r.id DESC
    `)).rows;
    return buildLatestBuildingPerformance(rows);
  } catch (error) {
    console.warn("Building performance is temporarily unavailable", error instanceof Error ? error.message : error);
    return {};
  }
}
