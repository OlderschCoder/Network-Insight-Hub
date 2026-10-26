import { createHash } from "node:crypto";
import { THROUGHPUT_PROFILES, type ThroughputProfile } from "./building_probe_protocol";

export const PROBE_TIME_ZONE = "America/Chicago";
export const SLOT_TOLERANCE_MS = 90_000;
export const QUICK_QUEUE_WINDOW_MS = 240_000;
export const PENDING_POLL_SECONDS = 12;
export const CAMPUS_LEASE_MS = 30_000;
export const STAGGER_SECONDS = 2700;
export interface ScheduleSlot { key: string; profile: ThroughputProfile; slotAt: string; windowEndsAt: string; scheduledWindow?: string; late: boolean; }
export interface TransferLane { id:number; job_id:string|null; building_id:string|null; lease_until:string|Date|null; }
export interface LaneLimits { quickConcurrency?:number;hourlyConcurrency?:number;capacityConcurrency?:number; }
/** Called under the store's global advisory lock; groups never borrow each other's lanes. */
export function chooseTransferLane(profile:ThroughputProfile,lanes:TransferLane[],buildingId:string,limits:LaneLimits,now=Date.now()) {
  const first=profile==='quick'?1:profile==='hourly'?5:7;
  const maximum=profile==='quick'?Math.max(1,Math.min(4,Math.floor(limits.quickConcurrency??4))):Math.max(1,Math.min(2,Math.floor((profile==='hourly'?limits.hourlyConcurrency:limits.capacityConcurrency)??1)));
  const group=lanes.filter(l=>l.id>=first&&l.id<first+maximum);
  const occupied=(l:TransferLane)=>!!l.job_id&&(!l.lease_until||new Date(l.lease_until).getTime()>now);
  if(profile!=='hourly'&&lanes.some(l=>l.id>=first&&l.id<first+(profile==='quick'?4:2)&&l.building_id===buildingId&&occupied(l)))return null;
  return group.filter(l=>!occupied(l)).sort((a,b)=>a.id-b.id)[0]?.id??null;
}
export function throughputOptions(profile: ThroughputProfile) { return { profile, targetId: "sccc-external-v1" as const, ...THROUGHPUT_PROFILES[profile] }; }
export function capable(snapshot: any) { return Array.isArray(snapshot?.capabilities) && snapshot.capabilities.includes("throughput-v1"); }
export function reporting(lastSeen: string | Date | null, now = Date.now()) { const value = lastSeen ? new Date(lastSeen).getTime() : NaN; return Number.isFinite(value) && value <= now + 30_000 && now - value <= SLOT_TOLERANCE_MS; }
export function staggerSeconds(buildingId: string) { return createHash("sha256").update(buildingId).digest().readUInt32BE(0) % STAGGER_SECONDS; }
function localParts(time: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PROBE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(time);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
}
/** 07:00 and 19:00 are outside Chicago's DST fold/gap. Preserve wall clock, not a 12h UTC timer. */
export function chicagoWindow(date: string, hour: 7 | 19) {
  const [year, month, day] = date.split("-").map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, hour);
  let value = wall;
  for (let i = 0; i < 3; i++) {
    const parts = localParts(value);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    value += wall - represented;
  }
  return value;
}
export function capacitySlots(buildingId: string, now: number): ScheduleSlot[] {
  const p = localParts(now), date = `${p.year}-${p.month}-${p.day}`;
  return ([7, 19] as const).flatMap((hour) => {
    const starts = chicagoWindow(date, hour), due = starts + staggerSeconds(buildingId) * 1000;
    if (now < due) return [];
    return [{ key: `${buildingId}:capacity:${date}:${hour}`, profile: "capacity" as const, slotAt: new Date(due).toISOString(), windowEndsAt: new Date(starts + STAGGER_SECONDS * 1000).toISOString(), scheduledWindow: `${date} ${hour === 7 ? "07:00" : "19:00"} ${PROBE_TIME_ZONE}`, late: now - due > SLOT_TOLERANCE_MS }];
  });
}
export function deviceSlot(id: string, revision: number, activationAt: string | Date | null, now: number): ScheduleSlot | null {
  if (!activationAt) return null;
  const activation = new Date(activationAt).getTime(), elapsed = now - activation;
  if (!Number.isFinite(activation) || elapsed < 300_000) return null;
  const hourly = Math.floor(elapsed / 3_600_000), quick = Math.floor(elapsed / 300_000);
  const profile: ThroughputProfile = hourly >= 1 && quick % 12 === 0 ? "hourly" : "quick";
  const slot = activation + (profile === "hourly" ? hourly * 3_600_000 : quick * 300_000);
  const tolerance=profile==='quick'?QUICK_QUEUE_WINDOW_MS:SLOT_TOLERANCE_MS;
  return { key: `${id}:${revision}:${profile}:${new Date(slot).toISOString()}`, profile, slotAt: new Date(slot).toISOString(), windowEndsAt: new Date(slot + tolerance).toISOString(), late: now - slot > tolerance };
}
export function selectCapacityProbe(probes: any[], previousAssignment: string | null, now: number, excluded?: string) {
  const candidates = probes.filter((p) => p.id !== excluded && p.enabled && p.selected && p.device_id && capable(p.snapshot) && reporting(p.last_seen, now)).sort((a, b) => a.id.localeCompare(b.id));
  return candidates.find((p) => p.id !== previousAssignment) ?? candidates[0] ?? null;
}
