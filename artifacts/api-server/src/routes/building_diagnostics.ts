import { randomBytes } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { requireAuth, requireCIO, requireNetworkAdmin } from "./auth";
import { diagnosticsReadiness, externalProbeConfig, jobProof, MAX_TRANSFER_BYTES, MAX_ROTATION_MINUTES, MIN_ROTATION_MINUTES, schedulerSettings, secretsEqual, SUSTAINED_OBJECT_BYTES, TARGET_LABEL } from "../lib/building_diagnostics";
import { diagnosticsStore, DiagnosticsError } from "../lib/building_diagnostics_store";

const text = z.string().trim().min(1).max(120);
const mac = z.string().regex(/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$|^[0-9a-f]{12}$/i);
const guid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const portTelemetrySchema = z.object({ source: z.enum(["snmp", "switch-cli"]), observedAt: timestamp,
  ifIndex: z.number().int().min(1).max(2147483647).optional(), operStatus: z.enum(["up", "down", "unknown"]).optional(),
  linkMbps: z.number().finite().min(0).max(1_000_000).optional(), inBitsPerSecond: z.number().finite().min(0).max(1_000_000_000_000).optional(), outBitsPerSecond: z.number().finite().min(0).max(1_000_000_000_000).optional(),
  inErrors: counter.optional(), outErrors: counter.optional(), inDiscards: counter.optional(), outDiscards: counter.optional(),
}).strict().refine((v) => Object.keys(v).some((key) => !["source", "observedAt"].includes(key)), "An actual port measurement is required");
const observationSchema = z.object({ mac: mac.optional(), bssid: mac.optional(), building: text, switchName: text.optional(), port: text.optional(), source: z.enum(["switch", "wifi"]), observedAt: timestamp, edge: z.boolean(), portTelemetry: portTelemetrySchema.optional() }).strict()
  .refine((o) => o.source === "switch" ? !!o.mac : !!o.bssid, "Matching MAC or BSSID required")
  .refine((o) => !o.portTelemetry || (o.source === "switch" && o.edge && !!o.switchName && !!o.port), "Port measurements require an identified access switch port");
const provisionSchema = z.object({ adObjectGuid: guid, computerName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/), domain: text, enabled: z.literal(true).optional() }).strict();
const adComputersSchema = z.array(provisionSchema.extend({ enabled: z.boolean() })).min(1).max(30_000).refine((rows) => new Set(rows.map((row) => row.adObjectGuid.toLowerCase())).size === rows.length, "Duplicate AD object identity");
const adInventorySchema = z.object({ snapshotComplete: z.literal(true), adObservedAt: timestamp, adComputers: adComputersSchema }).strict();
const inventorySchema = z.object({
  snapshotComplete: z.literal(true),
  adObservedAt: timestamp,
  adComputers: adComputersSchema,
  observations: z.array(observationSchema).max(60_000),
  userBuildingAssignments: z.array(z.object({ username: text, building: text, source: z.enum(["desk-phone", "assignment"]), observedAt: timestamp }).strict()).max(30_000),
  collectorStatus: z.object({ observedAt: timestamp, status: z.enum(["ok", "degraded"]), switchesObserved: z.number().int().min(0).max(1000), portObservations: z.number().int().min(0).max(60000), wifiObservations: z.number().int().min(0).max(60000) }).strict().optional(),
}).strict();
const checkInSchema = z.object({
  deviceId: guid, computerName: text, adDomain: text, adJoined: z.boolean(), uptimeSeconds: z.number().finite().nonnegative(), agentVersion: z.string().max(40), loggedOnUser: text.optional(),
  capabilities: z.array(z.literal("external-probe-v2")).max(1).optional(),
  interfaces: z.array(z.object({ mac, ipAddresses: z.array(z.string().ip()).max(16), gateway: z.string().ip().optional(), kind: z.enum(["ethernet", "wifi", "other"]), bssid: mac.optional(), ssid: z.string().max(64).optional(), linkMbps: z.number().finite().nonnegative().max(1_000_000).optional() }).strict()).max(16),
}).strict();
const metric = z.number().finite().nonnegative().max(1_000_000).optional();
const phaseMs = z.number().finite().min(0).max(195_000).nullable().optional();
const externalResultSchema = z.object({
  type: z.enum(["external-quick", "external-sustained"]), targetOrigin: z.string().url().max(255), path: z.enum(["/probe-5mb.bin", "/probe-1gb.bin"]),
  timestamp, dnsMs: phaseMs, tcpConnectMs: phaseMs, tlsMs: phaseMs, ttfbMs: phaseMs,
  httpStatus: z.union([z.literal(0), z.number().int().min(100).max(599)]), bytesReceived: z.number().int().min(0).max(SUSTAINED_OBJECT_BYTES), elapsedMs: z.number().finite().min(0).max(195_000), mbps: metric,
  remoteAddress: z.string().ip().optional(), localAddress: z.string().ip().optional(), dnsAddresses: z.array(z.string().ip()).max(16).optional(), failure: z.string().min(1).max(120).optional(),
  activeAdapter: z.object({ interfaceAlias: text.optional(), kind: z.enum(["ethernet", "wifi", "other"]).optional(), mac: mac.optional(), localIp: z.string().ip().optional(), subnetPrefixLength: z.number().int().min(0).max(128).optional(), gateway: z.string().ip().optional(), ssid: z.string().max(64).optional(), bssid: mac.optional() }).strict().optional(),
}).strict();
const resultsSchema = z.object({ deviceId: guid, jobId: guid, downloadMbps: metric, uploadMbps: metric, latencyMs: z.number().finite().min(0).max(120_000).optional(), requestLossPercent: z.number().finite().min(0).max(100).optional(), downloadBytes: z.number().int().min(0).max(MAX_TRANSFER_BYTES).optional(), uploadBytes: z.number().int().min(0).max(MAX_TRANSFER_BYTES).optional(), error: z.string().min(1).max(500).optional(), external: externalResultSchema.optional() }).strict().refine((r) => !!r.error || !!r.external || (r.downloadMbps !== undefined && r.uploadMbps !== undefined && r.latencyMs !== undefined && r.requestLossPercent !== undefined), "Successful result requires all measurements");
const queueSchema = z.object({ deviceIds: z.array(guid).min(1).max(100).optional(), building: text.optional(), type: z.enum(["fred", "external-quick", "external-sustained"]).optional(), maxBytes: z.number().int().min(5_242_880).max(SUSTAINED_OBJECT_BYTES).optional(), scheduledAt: timestamp.optional(), sustainedConfirmed: z.boolean().optional() }).strict()
  .refine((v) => !!v.deviceIds !== !!v.building, "Select devices or a building, not both")
  .refine((v) => !v.deviceIds || new Set(v.deviceIds).size === v.deviceIds.length, "Duplicate device selection");
const settingsSchema = z.object({ schedulerArmed: z.boolean(), rotationIntervalMinutes: z.number().int().min(MIN_ROTATION_MINUTES).max(MAX_ROTATION_MINUTES) }).strict();
const credentialActionSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

function bearer(req: any): string { const value = req.headers.authorization; return typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7) : ""; }
function workerValid(req: any) { const expected = process.env.BUILDING_DIAGNOSTICS_WORKER_TOKEN ?? ""; return expected.length >= 32 && secretsEqual(bearer(req), expected); }
function flags() { const enabled = process.env.BUILDING_DIAGNOSTICS_ENABLED === "true"; return { enabled, schedulerEnabled: enabled && process.env.BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED === "true" }; }
const enabledOnly: RequestHandler = (_req, res, next) => flags().enabled ? next() : void res.status(503).json({ error: "Building diagnostics is not enabled" });
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> { const result = schema.safeParse(value); if (!result.success) throw new DiagnosticsError(400, "Invalid diagnostics request"); return result.data; }

export function createBuildingDiagnosticsRouter(store = diagnosticsStore) {
  const router = Router();
  const workerOnly: RequestHandler = async (req, res, next) => { if (!workerValid(req)) return void res.status(401).json({ error: "Diagnostics worker authentication required" }); await store.workerSeen(); next(); };
  const adminOrWorker: RequestHandler = async (req, res, next) => { if (workerValid(req)) { await store.workerSeen(); next(); } else requireAuth(req, res, () => requireNetworkAdmin(req, res, next)); };
  const actor = (req: any) => workerValid(req) ? "private AD worker" : `Fred user ${req.user.id}`;
  const agentOnly: RequestHandler = async (req: any, res, next) => {
    const token = bearer(req);
    const identity = await store.authenticate(token);
    if (!identity) return void res.status(401).json({ error: "Diagnostics device authentication required" });
    req.diagnosticDevice = identity;
    next();
  };
  router.get("/overview", requireAuth, requireNetworkAdmin, async (_req, res) => {
    const config = flags();
    res.set("Cache-Control", "no-store");
    if (!config.enabled) return res.json({ ...config, devices: [], buildings: [], jobs: [], audit: [], settings: schedulerSettings(), readiness: diagnosticsReadiness(), inventoryUpdatedAt: null, targetLabel: TARGET_LABEL, externalProbe: externalProbeConfig() });
    const overview = await store.overview();
    return res.json({ ...config, ...overview, schedulerEnabled: overview.settings?.effectiveSchedulerEnabled ?? false });
  });
  router.get("/settings", requireAuth, requireNetworkAdmin, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    return res.json(flags().enabled ? await store.settings() : schedulerSettings());
  });
  router.put("/settings", requireAuth, requireCIO, enabledOnly, async (req: any, res) => {
    res.set("Cache-Control", "no-store");
    return res.json(await store.saveSettings(parse(settingsSchema, req.body), `Fred user ${req.user.id}`));
  });
  router.get("/ad-inventory", enabledOnly, workerOnly, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    return res.json(await store.adInventory());
  });
  router.post("/ad-inventory", enabledOnly, workerOnly, async (req, res) => {
    const { snapshotComplete: _complete, ...data } = parse(adInventorySchema, req.body);
    return res.json(await store.ingestAd(data));
  });
  router.get("/reporting-snapshot", enabledOnly, workerOnly, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    const overview = await store.overview(), observedAt = new Date().toISOString();
    const devices = overview.devices.map((d) => ({ deviceId: d.deviceId, adObjectGuid: d.adObjectGuid, computerName: d.computerName, domain: d.adDomain,
      enabled: d.adEnabled, enrolled: d.enrolled && !d.revoked, online: d.online, adVerified: d.adVerified, lastSeenAt: d.lastCheckIn,
      ...(d.loggedOnUser ? { loggedOnUser: d.loggedOnUser } : {}),
      location: { building: d.location.building, kind: d.location.kind, source: d.location.source, observedAt: d.location.observedAt } }));
    return res.json({ observedAt, updatedAt: observedAt, readiness: overview.readiness, devices });
  });
  router.post("/inventory", enabledOnly, workerOnly, async (req, res) => {
    const input = parse(inventorySchema, req.body);
    const ids = new Set(input.adComputers.map((a) => a.adObjectGuid.toLowerCase()));
    if (ids.size !== input.adComputers.length) throw new DiagnosticsError(400, "Duplicate AD object identity");
    return res.json(await store.ingest(input));
  });
  router.post("/devices/provision", enabledOnly, adminOrWorker, async (req: any, res) => {
    res.set("Cache-Control", "no-store");
    return res.status(201).json(await store.provision(parse(provisionSchema, req.body), actor(req)));
  });
  router.post("/devices/:deviceId/revoke", enabledOnly, adminOrWorker, async (req, res) => {
    const { reason } = parse(credentialActionSchema, req.body);
    res.set("Cache-Control", "no-store");
    return res.json(await store.revoke(parse(guid, req.params.deviceId), reason, actor(req)));
  });
  router.post("/devices/:deviceId/rotate", enabledOnly, adminOrWorker, async (req, res) => {
    const { reason } = parse(credentialActionSchema, req.body);
    res.set("Cache-Control", "no-store");
    return res.json(await store.rotate(parse(guid, req.params.deviceId), reason, actor(req)));
  });
  router.post("/jobs", enabledOnly, requireAuth, requireNetworkAdmin, async (req: any, res) => res.status(202).json(await store.queue(parse(queueSchema, req.body), `Fred user ${req.user.id}`)));
  router.post("/jobs/:jobId/cancel", enabledOnly, requireAuth, requireNetworkAdmin, async (req: any, res) => res.json(await store.cancel(parse(guid, req.params.jobId), parse(credentialActionSchema, req.body).reason, `Fred user ${req.user.id}`)));
  router.get("/reports", enabledOnly, workerOnly, async (req, res) => {
    const after = typeof req.query.after === "string" ? req.query.after : "0";
    const limit = Number(req.query.limit ?? 100);
    if (!/^\d{1,18}$/.test(after) || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new DiagnosticsError(400, "Invalid report cursor");
    res.set("Cache-Control", "no-store");
    return res.json(await store.reports(after, limit));
  });
  router.use("/agent", enabledOnly, agentOnly, (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.post("/agent/check-in", async (req: any, res) => {
    const input = parse(checkInSchema, req.body), identity = req.diagnosticDevice;
    if (input.deviceId !== identity.deviceId || input.computerName.toLowerCase() !== identity.computerName.toLowerCase() || input.adDomain.toLowerCase() !== identity.domain.toLowerCase() || !input.adJoined) throw new DiagnosticsError(403, "Diagnostics identity does not match provisioned AD computer");
    const job = await store.checkIn(input, flags().schedulerEnabled);
    return res.json({ ok: true, job: job ? { ...job, proof: jobProof(bearer(req), input.deviceId, job) } : null });
  });
  router.get("/agent/jobs/:jobId", async (req: any, res) => res.json(await store.jobStatus(req.diagnosticDevice.deviceId, parse(guid, req.params.jobId))));
  router.get("/agent/ping/:jobId", async (req: any, res) => {
    await store.transfer(req.diagnosticDevice.deviceId, parse(guid, req.params.jobId), "ping");
    return res.json({ ok: true });
  });
  router.get("/agent/download/:jobId", async (req: any, res) => {
    const jobId = parse(guid, req.params.jobId);
    const job = await store.transfer(req.diagnosticDevice.deviceId, jobId, "download");
    if (job.downloadBytes < 1 || job.downloadBytes > MAX_TRANSFER_BYTES) throw new DiagnosticsError(409, "Invalid transfer budget");
    req.setTimeout(20_000);
    res.set({ "Content-Type": "application/octet-stream", "Content-Length": String(job.downloadBytes), "Content-Encoding": "identity" });
    // Incompressible bounded payload. Only one persisted job can run across all devices.
    const payload = randomBytes(job.downloadBytes);
    await store.transferReceipt(jobId, "download", payload.length);
    return res.end(payload);
  });
  router.put("/agent/upload/:jobId", async (req: any, res) => {
    if (!req.is("application/octet-stream")) throw new DiagnosticsError(415, "Use application/octet-stream");
    const jobId = parse(guid, req.params.jobId);
    const job = await store.transfer(req.diagnosticDevice.deviceId, jobId, "upload");
    const length = Number(req.get("content-length"));
    if (!Number.isInteger(length) || length !== job.uploadBytes || length > MAX_TRANSFER_BYTES) { req.resume(); throw new DiagnosticsError(413, "Transfer size does not match job budget"); }
    req.setTimeout(20_000, () => req.destroy());
    let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > job.uploadBytes) { req.destroy(); return; } }
    if (bytes !== job.uploadBytes) throw new DiagnosticsError(400, "Incomplete upload");
    await store.transferReceipt(jobId, "upload", bytes);
    return res.json({ ok: true, bytes, receivedBytes: bytes });
  });
  router.post("/agent/results", async (req: any, res) => {
    const input = parse(resultsSchema, req.body);
    if (input.deviceId !== req.diagnosticDevice.deviceId) throw new DiagnosticsError(403, "Diagnostics device mismatch");
    return res.json(await store.result(req.diagnosticDevice.deviceId, input));
  });
  router.use((err: any, req: any, res: any, _next: any) => {
    if (!(err instanceof DiagnosticsError)) req.log?.error({ err }, "building diagnostics request failed");
    if (res.headersSent) return res.destroy();
    return res.status(err instanceof DiagnosticsError ? err.status : 500).json({ error: err instanceof DiagnosticsError ? err.message : "Building diagnostics request failed" });
  });
  return router;
}
export default createBuildingDiagnosticsRouter();
