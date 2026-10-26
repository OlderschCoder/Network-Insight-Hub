import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, timingSafeEqual, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

export const PROBE_SCHEMA = "sccc.building-probe.v1";
export const PAGING = { group: "239.0.1.216", source: "10.40.4.20", port: 24016, windowSeconds: 60 } as const;
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function matches(value: string, hash: string | null): boolean {
  return !!hash && /^[a-f0-9]{64}$/.test(hash) && timingSafeEqual(Buffer.from(digest(value), "hex"), Buffer.from(hash, "hex"));
}
export function computerName(value: string): string {
  const name = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,14}$/.test(name)) throw new Error("Use the selected computer's Windows name (up to 15 characters).");
  return name;
}
export function buildingKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!key || key.length > 160) throw new Error("A building name is required.");
  return key;
}
const short = z.string().max(160);
const address = z.string().max(64);
const iso = z.string().datetime({ offset: true });
export const assignmentInput = z.object({
  buildingId: z.string().uuid(), computerName: z.string().min(1).max(15),
  adapterId: z.string().max(100).nullable().optional(),
  expectedVoiceSubnet: z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}\/(?:[1-9]|[12]\d|3[0-2])$/).nullable().optional(),
}).strict();
export const enrollmentInput = z.object({ assignmentId: z.string().uuid(), deviceId: z.string().uuid(),
  computerName: z.string().min(1).max(15), agentVersion: z.string().max(30),
  proposedToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const snapshotSchema = z.object({
  schema: z.literal(PROBE_SCHEMA), computerName: z.string().max(15), agentVersion: z.string().max(30),
  capturedAt: iso, uptimeSeconds: z.number().int().min(0).max(100 * 365 * 86400),
  diagnosticsMode: z.literal("on-demand"),
  capabilities: z.array(z.literal("throughput-v1")).max(1).optional(), installedAt: iso.optional(),
  adapters: z.array(z.object({ id: z.string().max(100), name: short, kind: short, state: short,
    mac: z.string().max(40), ipv4: z.array(address).max(8), gateways: z.array(address).max(4),
    dnsServers: z.array(address).max(4), dhcpServers: z.array(address).max(4),
    speedBps: z.number().min(0).max(1e14),
  }).strict()).max(16),
  keyAlert: z.object({ installed: z.boolean(), serviceState: z.string().max(40),
    version: z.string().max(40).nullable().optional(), uiProcessCount: z.number().int().min(0).max(1000),
  }).strict(),
}).strict();
const outcome = z.enum(["completed", "received", "no_packets_observed", "wrong_network", "unavailable", "cancelled"]);
// Details have an explicit allowlist; reject payload/audio/command/credential fields.
export const detailsSchema = z.object({
  id: z.string().max(100).optional(), name: short.optional(), ipv4: z.array(address).max(8).optional(),
  gateway: address.nullable().optional(), gatewayTransmitted: z.number().int().min(0).max(3).optional(),
  gatewayReceived: z.number().int().min(0).max(3).optional(), gatewayAverageMs: z.number().min(0).max(10000).nullable().optional(),
  dns: z.enum(["unavailable", "resolved", "no_addresses", "failed", "timeout"]).optional(),
  httpsStatus: z.number().int().min(100).max(599).optional(), httpsElapsedMs: z.number().min(0).max(120000).optional(),
  localAddress: address.nullable().optional(), group: z.literal(PAGING.group).optional(), port: z.literal(PAGING.port).optional(),
  expectedSource: z.literal(PAGING.source).optional(), packets: z.number().int().min(0).max(10000).optional(),
  bytes: z.number().int().min(0).max(10000000000).optional(), unexpectedSources: z.number().int().min(0).max(10000).optional(),
  expectedVoiceSubnet: address.nullable().optional(), scopeVerified: z.boolean().optional(),
  observation: z.string().max(250).optional(), reason: z.string().max(250).optional(),
  profile: z.enum(["quick", "hourly", "capacity"]).optional(), targetId: z.literal("sccc-external-v1").optional(),
  elapsedMs: z.number().finite().min(0).max(930000).optional(), mbps: z.number().finite().min(0).max(1000000).nullable().optional(),
  linkSpeedBps: z.number().finite().min(0).max(1e14).nullable().optional(),
  termination: z.string().min(1).max(80).optional(), scheduledWindow: z.string().max(100).optional(),
  rangeCount: z.number().int().min(0).max(10).optional(),
  bytesAccounted: z.boolean().optional(),
  segments: z.array(z.object({ ordinal: z.number().int().min(0).max(9), requestedBytes: z.number().int().min(1).max(1073741824), bytes: z.number().int().min(0).max(1073741824), status: z.number().int().min(0).max(599), elapsedMs: z.number().finite().min(0).max(930000) }).strict()).max(10).optional(),
}).strict();
export const resultSchema = z.object({ jobId: z.string().uuid(), kind: z.enum(["network", "multicast", "throughput"]),
  startedAt: iso, completedAt: iso, outcome, details: detailsSchema,
  selectionRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), slotAt: iso.optional(),
  capacityJobId: z.string().uuid().optional(), attemptId: z.string().uuid().optional(),
}).strict().superRefine((result, ctx) => {
  if (result.kind !== "throughput") return;
  if (result.selectionRevision === undefined || !result.slotAt || !result.details.profile || !result.details.targetId || result.details.bytes === undefined || result.details.elapsedMs === undefined || !result.details.termination || result.details.rangeCount === undefined)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Throughput result metadata is required." });
  if (result.outcome === "completed" && (!(result.details.bytes! > 0) || !(result.details.elapsedMs! > 0) || result.details.mbps === undefined || result.details.mbps === null))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Completed throughput requires measured bytes, time and rate." });
});
export const heartbeatInput = z.object({ assignmentId: z.string().uuid(), deviceId: z.string().uuid(),
  snapshot: snapshotSchema, results: z.array(resultSchema).max(20),
  runningJobId: z.string().uuid().optional(),
}).strict();
export type ProbeSnapshot = z.infer<typeof snapshotSchema>;
export type ProbeResult = z.infer<typeof resultSchema>;

export type ThroughputProfile = "quick" | "hourly" | "capacity";
export const THROUGHPUT_PROFILES = {
  quick: { maxBytes: 5242880, timeoutSeconds: 10 },
  hourly: { maxBytes: 64000000, timeoutSeconds: 10 },
  capacity: { maxBytes: 10000000000, timeoutSeconds: 900 },
} as const;
export interface ProbeJob { id: string; assignmentId: string; deviceId: string; kind: "network" | "multicast" | "throughput"; issuedAt: number; expiresAt: number;
  selectionRevision?: number; slotAt?: string;
  capacityJobId?: string;
  options?: { profile: ThroughputProfile; targetId: "sccc-external-v1"; maxBytes: number; timeoutSeconds: number };
}
export class JobSigner {
  constructor(private readonly key: KeyObject) {
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Building probe signing requires a P-256 key.");
  }
  static fromFile(path: string) { return new JobSigner(createPrivateKey(readFileSync(path))); }
  publicKey() { return createPublicKey(this.key).export({ format: "der", type: "spki" }).toString("base64"); }
  sign(job: ProbeJob): string {
    const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "SCCC-PROBE-JOB" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(job)).toString("base64url");
    const data = `${header}.${body}`;
    return `${data}.${sign("sha256", Buffer.from(data), { key: this.key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  }
}

export function probeState(lastSeen: string | Date | null, enabled: boolean, now = Date.now()) {
  if (!enabled) return "revoked";
  if (!lastSeen) return "awaiting_enrollment";
  return now - new Date(lastSeen).getTime() <= 5 * 60_000 ? "reporting" : "stale";
}

export class ProbeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
