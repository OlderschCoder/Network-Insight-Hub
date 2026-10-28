import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const TARGET_LABEL = "Fred HTTPS path";
export const ONLINE_MS = 3 * 60_000;
export const LOCATION_MS = 10 * 60_000;
export const JOB_MS = 2 * 60_000;
export const TRANSFER_BYTES = 8 * 1024 * 1024;
export const MAX_TRANSFER_BYTES = 32 * 1024 * 1024;
export const PING_COUNT = 5;
export const DEFAULT_ROTATION_MINUTES = 360;
export const MIN_ROTATION_MINUTES = 60;
export const MAX_ROTATION_MINUTES = 1440;
export type SchedulerInput = { schedulerArmed: boolean; rotationIntervalMinutes: number };
export type SchedulerSettings = SchedulerInput & { revision: number; updatedAt: string | null; updatedBy: string | null; persisted: boolean; deploymentSchedulerEnabled: boolean; effectiveSchedulerEnabled: boolean };
export function schedulerDeploymentEnabled() {
  return process.env.BUILDING_DIAGNOSTICS_ENABLED === "true" && process.env.BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED === "true";
}
export function schedulerSettings(row?: { scheduler_armed: boolean; rotation_interval_minutes: number; revision: number; updated_at?: string | Date | null; updated_by?: string | null }): SchedulerSettings {
  const deploymentSchedulerEnabled = schedulerDeploymentEnabled();
  return { schedulerArmed: row?.scheduler_armed ?? false, rotationIntervalMinutes: row?.rotation_interval_minutes ?? DEFAULT_ROTATION_MINUTES,
    revision: row?.revision ?? 0, updatedAt: row?.updated_at ? (row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)).toISOString() : null, updatedBy: row?.updated_by ?? null,
    persisted: !!row, deploymentSchedulerEnabled, effectiveSchedulerEnabled: deploymentSchedulerEnabled && row?.scheduler_armed === true };
}
export const QUICK_BYTES = 5 * 1024 * 1024;
export const SUSTAINED_OBJECT_BYTES = 1024 * 1024 * 1024;
export const LIBRESPEED_ORIGIN = "https://denspeed.sharktech.net";
export const LIBRESPEED_SERVER_ID = 92;
export const LIBRESPEED_METHOD = "MultiStreamV2";
export const LIBRESPEED_INTERVAL_MINUTES = 180;
export const LIBRESPEED_BUCKET_MINUTES = 10;
export const LIBRESPEED_TIMEOUT_SECONDS = 180;
export type JobType = "fred" | "external-quick" | "external-sustained" | "librespeed-v2";
export type QueueInput = { deviceIds?: string[]; building?: string; type?: JobType; maxBytes?: number; scheduledAt?: string; sustainedConfirmed?: boolean };
export function libreSpeedConfig() {
  const requested = Number(process.env.BUILDING_DIAGNOSTICS_LIBRESPEED_MAX_CONCURRENT ?? 2);
  const maxConcurrent = Number.isInteger(requested) && requested >= 1 && requested <= 4 ? requested : 2;
  const requestedCanary = Number(process.env.BUILDING_DIAGNOSTICS_LIBRESPEED_CANARY_MAX ?? 4);
  const canaryMax = Number.isInteger(requestedCanary) && requestedCanary >= 1 && requestedCanary <= 20 ? requestedCanary : 4;
  return {
    enabled: process.env.BUILDING_DIAGNOSTICS_ENABLED === "true" && process.env.BUILDING_DIAGNOSTICS_LIBRESPEED_ENABLED === "true",
    maxConcurrent, canaryMax, intervalMinutes: LIBRESPEED_INTERVAL_MINUTES, bucketMinutes: LIBRESPEED_BUCKET_MINUTES,
    origin: LIBRESPEED_ORIGIN, serverId: LIBRESPEED_SERVER_ID, method: LIBRESPEED_METHOD,
  };
}
export function libreSpeedBucket(deviceId: string, bucketCount = LIBRESPEED_INTERVAL_MINUTES / LIBRESPEED_BUCKET_MINUTES) {
  if (!Number.isInteger(bucketCount) || bucketCount < 1) throw new Error("Invalid LibreSpeed bucket count");
  const value = createHash("sha256").update(deviceId.toLowerCase()).digest().readUInt32BE(0);
  return value % bucketCount;
}
export function externalProbeConfig() {
  let origin: string | null = null;
  const value = process.env.BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN;
  if (value) {
    try {
      const uri = new URL(value);
      const host = uri.hostname.toLowerCase();
      if (uri.protocol !== "https:" || uri.port || uri.username || uri.password || uri.search || uri.hash || uri.pathname !== "/" || isIP(host) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test)$/.test(host)) throw new Error("Invalid external origin");
      origin = uri.origin;
    } catch { throw new Error("BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN must be one public HTTPS DNS origin"); }
  }
  const configuredBudget = Number(process.env.BUILDING_DIAGNOSTICS_EXTERNAL_DAILY_BUDGET_BYTES ?? SUSTAINED_OBJECT_BYTES);
  if (!Number.isSafeInteger(configuredBudget) || configuredBudget < QUICK_BYTES || configuredBudget > 10 * SUSTAINED_OBJECT_BYTES) throw new Error("Invalid external diagnostics daily byte budget");
  return { configured: !!origin, origin, quickBytes: QUICK_BYTES, sustainedEnabled: !!origin && process.env.BUILDING_DIAGNOSTICS_EXTERNAL_SUSTAINED_ENABLED === "true", dailyBudgetBytes: configuredBudget };
}
export type Interface = { mac: string; ipAddresses: string[]; kind: "ethernet" | "wifi" | "other"; bssid?: string; ssid?: string; gateway?: string; linkMbps?: number };
export type PortTelemetry = { source: "snmp" | "switch-cli"; observedAt: string; ifIndex?: number; operStatus?: "up" | "down" | "unknown"; linkMbps?: number; inBitsPerSecond?: number; outBitsPerSecond?: number; inErrors?: number; outErrors?: number; inDiscards?: number; outDiscards?: number };
export type Observation = { mac?: string; bssid?: string; building: string; switchName?: string; port?: string; source: "switch" | "wifi"; observedAt: string; edge: boolean; portTelemetry?: PortTelemetry };
export type CollectorStatus = { observedAt: string; status: "ok" | "degraded"; switchesObserved: number; portObservations: number; wifiObservations: number };
export type Assignment = { username: string; building: string; source: "desk-phone" | "assignment"; observedAt: string };
export type Location = { building: string | null; kind: "network-confirmed" | "assigned" | "stale" | "unknown" | "ambiguous"; source: string | null; observedAt: string | null };
export type Heartbeat = { deviceId: string; computerName: string; adDomain: string; adJoined: boolean; uptimeSeconds: number; agentVersion: string; loggedOnUser?: string; interfaces: Interface[]; capabilities?: string[] };

export function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function newToken() { return `sccc-diag.${randomBytes(32).toString("base64url")}`; }
export function jobProof(token: string, deviceId: string, job: { id: string; expiresAt: string; downloadBytes: number; uploadBytes: number; pingCount: number; proofVersion?: number; type?: JobType; targetOrigin?: string; timeoutSeconds?: number }) {
  const canonical = job.proofVersion === 2 ? `v2|${job.id}|${deviceId}|${job.expiresAt}|${job.type}|${job.targetOrigin}|${job.downloadBytes}|${job.uploadBytes}|${job.pingCount}|${job.timeoutSeconds}` : `${job.id}|${deviceId}|${job.expiresAt}|${job.downloadBytes}|${job.uploadBytes}|${job.pingCount}`;
  return createHmac("sha256", token).update(canonical).digest("base64url");
}
export function secretsEqual(a: string, b: string) {
  return a.length > 0 && b.length > 0 && timingSafeEqual(Buffer.from(tokenHash(a)), Buffer.from(tokenHash(b)));
}
export function normalizeMac(value: string) { return value.replace(/[^a-f0-9]/gi, "").toLowerCase(); }
export function normalizeUser(value: string) { return value.trim().toLowerCase(); }
export function fresh(value: string | null | undefined, now: number, age: number) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time <= now + 30_000 && now - time <= age;
}

/** Only fresh, unambiguous access-edge observations establish current location. */
export function resolveLocation(heartbeat: Pick<Heartbeat, "interfaces" | "loggedOnUser">, observations: Observation[], assignments: Assignment[], now = Date.now()): Location {
  const macs = new Set(heartbeat.interfaces.map((i) => normalizeMac(i.mac)));
  const bssids = new Set(heartbeat.interfaces.filter((i) => i.kind === "wifi" && i.bssid).map((i) => normalizeMac(i.bssid!)));
  const matching = observations.filter((o) => o.edge && ((o.source === "switch" && !!o.mac && macs.has(normalizeMac(o.mac))) || (o.source === "wifi" && ((!!o.bssid && bssids.has(normalizeMac(o.bssid))) || (!!o.mac && macs.has(normalizeMac(o.mac)))))));
  const current = matching.filter((o) => fresh(o.observedAt, now, LOCATION_MS));
  const buildings = new Set(current.map((o) => o.building));
  if (buildings.size > 1) return { building: null, kind: "ambiguous", source: "conflicting network evidence", observedAt: null };
  if (buildings.size === 1) {
    const newest = current.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0]!;
    return { building: newest.building, kind: "network-confirmed", source: newest.source === "switch" ? [newest.switchName, newest.port].filter(Boolean).join(" / ") || "access switch" : "Wi-Fi AP", observedAt: newest.observedAt };
  }
  // An explicitly maintained identity join is required; display-name matching is forbidden.
  const assigned = heartbeat.loggedOnUser ? assignments.filter((a) => normalizeUser(a.username) === normalizeUser(heartbeat.loggedOnUser!) && fresh(a.observedAt, now, 30 * 24 * 60 * 60_000)) : [];
  if (new Set(assigned.map((a) => a.building)).size === 1 && assigned.length) {
    const item = assigned.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0]!;
    return { building: item.building, kind: "assigned", source: item.source, observedAt: item.observedAt };
  }
  if (assigned.length) return { building: null, kind: "ambiguous", source: "conflicting assigned offices", observedAt: null };
  if (matching.length) return { building: null, kind: "stale", source: "expired network evidence", observedAt: matching.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0]!.observedAt };
  return { building: null, kind: "unknown", source: null, observedAt: null };
}

/** Only one current access port may supply central counters. Never derive rates from link speed. */
export function resolvePortTelemetry(heartbeat: Pick<Heartbeat, "interfaces" | "loggedOnUser">, observations: Observation[], now = Date.now()) {
  const location = resolveLocation(heartbeat, observations, [], now);
  if (location.kind !== "network-confirmed") return null;
  const macs = new Set(heartbeat.interfaces.map((i) => normalizeMac(i.mac)));
  const matches = observations.filter((o) => o.source === "switch" && o.edge && o.mac && macs.has(normalizeMac(o.mac)) && o.building === location.building && o.switchName && o.port && fresh(o.observedAt, now, LOCATION_MS));
  const ports = new Set(matches.map((o) => `${o.switchName!.toLowerCase()}|${o.port!.toLowerCase()}`));
  if (ports.size !== 1) return null;
  const latest = matches.filter((o) => o.portTelemetry && fresh(o.portTelemetry.observedAt, now, LOCATION_MS)).sort((a, b) => Date.parse(b.portTelemetry!.observedAt) - Date.parse(a.portTelemetry!.observedAt))[0];
  return latest ? { ...latest.portTelemetry!, switchName: latest.switchName!, port: latest.port! } : null;
}

export function diagnosticsReadiness(input: {
  inventory?: { updatedAt: string | null; adObservedAt: string; observations: Observation[]; adComputers: unknown[]; collectorStatus?: CollectorStatus };
  devices?: { enrolled: boolean; revoked: boolean; online: boolean; adVerified: boolean; location: Location }[];
  workerLastSeenAt?: string | null;
} = {}, now = Date.now()) {
  const featureEnabled = process.env.BUILDING_DIAGNOSTICS_ENABLED === "true";
  const inv = input.inventory, devices = input.devices ?? [], collector = inv?.collectorStatus;
  const networkObservedAt = inv?.observations.map((o) => o.observedAt).filter((t) => fresh(t, now, Number.MAX_SAFE_INTEGER)).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const seen = input.workerLastSeenAt ?? null;
  return {
    featureEnabled, workerConfigured: (process.env.BUILDING_DIAGNOSTICS_WORKER_TOKEN?.length ?? 0) >= 32,
    worker: { state: !featureEnabled ? "disabled" : !seen ? "never-seen" : fresh(seen, now, ONLINE_MS) ? "current" : "stale", lastSeenAt: seen },
    inventory: { state: !featureEnabled ? "disabled" : !inv?.updatedAt ? "never-imported" : fresh(inv.adObservedAt, now, 24 * 60 * 60_000) ? "current" : "stale", importedAt: inv?.updatedAt ?? null, adObservedAt: inv?.adObservedAt || null, networkObservedAt },
    collector: { state: !featureEnabled ? "disabled" : !collector ? "unknown" : !fresh(collector.observedAt, now, LOCATION_MS) ? "stale" : collector.status === "degraded" ? "degraded" : "current",
      lastSeenAt: collector?.observedAt ?? null, status: collector?.status ?? null, switchesObserved: collector?.switchesObserved ?? null, portObservations: collector?.portObservations ?? null, wifiObservations: collector?.wifiObservations ?? null },
    counts: { inventory: inv?.adComputers.length ?? 0, enrolled: devices.filter((d) => d.enrolled && !d.revoked).length, revoked: devices.filter((d) => d.revoked).length,
      online: devices.filter((d) => d.online).length, adTrusted: devices.filter((d) => d.adVerified).length,
      eligible: devices.filter((d) => d.online && d.adVerified && d.location.kind === "network-confirmed").length,
      unlocated: devices.filter((d) => d.online && d.location.kind !== "network-confirmed").length },
  };
}

export type Candidate = { deviceId: string; adVerified: boolean; lastCheckIn: string | null; lastTestAt: string | null; location: Location };
/** Fair rotation: least-recently measured eligible computer in each due building. */
export function chooseCandidates<T extends Candidate>(devices: T[], lastBuildingTests: Map<string, number>, now = Date.now(), intervalMs = 6 * 60 * 60_000) {
  const eligible = devices.filter((d) => d.adVerified && fresh(d.lastCheckIn, now, ONLINE_MS) && d.location.kind === "network-confirmed" && d.location.building);
  eligible.sort((a, b) => (Date.parse(a.lastTestAt ?? "") || 0) - (Date.parse(b.lastTestAt ?? "") || 0) || a.deviceId.localeCompare(b.deviceId));
  const selected = new Map<string, T>();
  for (const d of eligible) {
    const building = d.location.building!;
    if (!selected.has(building) && now - (lastBuildingTests.get(building) ?? 0) >= intervalMs) selected.set(building, d);
  }
  return [...selected.values()];
}
