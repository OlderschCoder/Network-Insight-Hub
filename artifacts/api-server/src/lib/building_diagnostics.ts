import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TARGET_LABEL = "Fred HTTPS path";
export const ONLINE_MS = 3 * 60_000;
export const LOCATION_MS = 10 * 60_000;
export const JOB_MS = 2 * 60_000;
export const TRANSFER_BYTES = 8 * 1024 * 1024;
export const MAX_TRANSFER_BYTES = 32 * 1024 * 1024;
export const PING_COUNT = 5;
export type Interface = { mac: string; ipAddresses: string[]; kind: "ethernet" | "wifi" | "other"; bssid?: string; ssid?: string; gateway?: string; linkMbps?: number };
export type Observation = { mac?: string; bssid?: string; building: string; switchName?: string; port?: string; source: "switch" | "wifi"; observedAt: string; edge: boolean };
export type Assignment = { username: string; building: string; source: "desk-phone" | "assignment"; observedAt: string };
export type Location = { building: string | null; kind: "network-confirmed" | "assigned" | "stale" | "unknown" | "ambiguous"; source: string | null; observedAt: string | null };
export type Heartbeat = { deviceId: string; computerName: string; adDomain: string; adJoined: boolean; uptimeSeconds: number; agentVersion: string; loggedOnUser?: string; interfaces: Interface[] };

export function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function newToken() { return `sccc-diag.${randomBytes(32).toString("base64url")}`; }
export function jobProof(token: string, deviceId: string, job: { id: string; expiresAt: string; downloadBytes: number; uploadBytes: number; pingCount: number }) {
  return createHmac("sha256", token).update(`${job.id}|${deviceId}|${job.expiresAt}|${job.downloadBytes}|${job.uploadBytes}|${job.pingCount}`).digest("base64url");
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
  const matching = observations.filter((o) => o.edge && ((o.source === "switch" && !!o.mac && macs.has(normalizeMac(o.mac))) || (o.source === "wifi" && !!o.bssid && bssids.has(normalizeMac(o.bssid)))));
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

export type Candidate = { deviceId: string; adVerified: boolean; lastCheckIn: string | null; lastTestAt: string | null; location: Location };
/** Fair rotation: least-recently measured eligible computer in each due building. */
export function chooseCandidates(devices: Candidate[], lastBuildingTests: Map<string, number>, now = Date.now(), intervalMs = 6 * 60 * 60_000) {
  const eligible = devices.filter((d) => d.adVerified && fresh(d.lastCheckIn, now, ONLINE_MS) && d.location.kind === "network-confirmed" && d.location.building);
  eligible.sort((a, b) => (Date.parse(a.lastTestAt ?? "") || 0) - (Date.parse(b.lastTestAt ?? "") || 0) || a.deviceId.localeCompare(b.deviceId));
  const selected = new Map<string, Candidate>();
  for (const d of eligible) {
    const building = d.location.building!;
    if (!selected.has(building) && now - (lastBuildingTests.get(building) ?? 0) >= intervalMs) selected.set(building, d);
  }
  return [...selected.values()];
}
