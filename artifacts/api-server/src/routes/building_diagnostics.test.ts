import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("./auth", () => ({
  requireAuth(req: any, res: any, next: any) { if (req.headers.authorization !== "Bearer fred-session") return res.status(401).json({ error: "Unauthorized" }); req.user = { id: 7, role: req.headers["x-role"] }; next(); },
  requireNetworkAdmin(req: any, res: any, next: any) { return ["cio", "network", "network_engineer"].includes(req.user?.role) ? next() : res.status(403).json({ error: "Forbidden" }); },
  requireCIO(req: any, res: any, next: any) { return req.user?.role === "cio" ? next() : res.status(403).json({ error: "CIO required" }); },
}));
import { createBuildingDiagnosticsRouter } from "./building_diagnostics";
import { jobProof } from "../lib/building_diagnostics";
const id = "12078014-77bb-43b6-9bde-bbb213668861", jobId = "1bf02e30-1a1e-4d16-9c33-ef3abfd36471";
const token = `sccc-diag.${"a".repeat(43)}`, worker = "w".repeat(40);
const adComputer = { adObjectGuid: id, computerName: "PC-1", domain: "sccc.edu", enabled: true };
const store = {
  settings: vi.fn(async () => ({ schedulerArmed: false, rotationIntervalMinutes: 360, revision: 0, persisted: true })),
  saveSettings: vi.fn(async (settings: any) => ({ ...settings, revision: 1, persisted: true })), workerSeen: vi.fn(async () => undefined),
  adInventory: vi.fn(async () => ({ snapshotComplete: true, adObservedAt: new Date().toISOString(), adComputers: [adComputer], fresh: true })), ingestAd: vi.fn(async () => ({ ok: true })),
  overview: vi.fn(async () => ({ devices: [], buildings: [], jobs: [] })),
  ingest: vi.fn(async () => ({ ok: true })), provision: vi.fn(async () => ({ deviceId: id, deviceToken: token })),
  authenticate: vi.fn(async (value: string) => value === token ? { deviceId: id, computerName: "PC-1", domain: "sccc.edu" } : null),
  queue: vi.fn(async () => ({ queued: 1, jobIds: [jobId] })), checkIn: vi.fn(), transfer: vi.fn(), transferReceipt: vi.fn(), result: vi.fn(async () => ({ ok: true })), reports: vi.fn(async () => ({ reports: [], nextCursor: "0" })),
  revoke: vi.fn(async () => ({ ok: true })), rotate: vi.fn(async () => ({ deviceId: id, deviceToken: token })),
  cancel: vi.fn(async () => ({ ok: true, status: "cancelled" })), jobStatus: vi.fn(async () => ({ id: jobId, status: "running", expiresAt: new Date(Date.now() + 60000).toISOString() })),
};
function app() { const a = express(); a.use(express.json()); a.use("/api/building-diagnostics", createBuildingDiagnosticsRouter(store as any)); return a; }
const path = "/api/building-diagnostics";
const heartbeat = { deviceId: id, computerName: "PC-1", adDomain: "sccc.edu", adJoined: true, uptimeSeconds: 20, agentVersion: "1.0.0", interfaces: [{ mac: "aa:bb:cc:dd:ee:ff", ipAddresses: ["10.0.0.4"], kind: "ethernet" }] };
beforeEach(() => {
  vi.clearAllMocks(); process.env.BUILDING_DIAGNOSTICS_ENABLED = "true"; process.env.BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED = "false"; process.env.BUILDING_DIAGNOSTICS_WORKER_TOKEN = worker;
  delete process.env.BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN;
  delete process.env.BUILDING_DIAGNOSTICS_EXTERNAL_SUSTAINED_ENABLED;
  store.checkIn.mockResolvedValue(null); store.transfer.mockResolvedValue({ downloadBytes: 256, uploadBytes: 256 });
});
describe("building diagnostics authority boundaries", () => {
  it("allows network manual work but restricts persisted automatic scheduling to the CIO", async () => {
    const settings = { schedulerArmed: true, rotationIntervalMinutes: 180 };
    for (const role of ["network", "network_engineer", "helpdesk"]) expect((await request(app()).put(`${path}/settings`).set("Authorization", "Bearer fred-session").set("x-role", role).send(settings)).status).toBe(403);
    for (const credential of [worker, token, "alerts.send-token"]) expect((await request(app()).put(`${path}/settings`).set("Authorization", `Bearer ${credential}`).send(settings)).status).toBe(401);
    expect(store.saveSettings).not.toHaveBeenCalled();
    const saved = await request(app()).put(`${path}/settings`).set("Authorization", "Bearer fred-session").set("x-role", "cio").send(settings);
    expect(saved.status).toBe(200); expect(saved.headers["cache-control"]).toBe("no-store");
    expect(store.saveSettings).toHaveBeenCalledWith(settings, "Fred user 7");
    expect((await request(app()).post(`${path}/jobs`).set("Authorization", "Bearer fred-session").set("x-role", "network").send({ deviceIds: [id] })).status).toBe(202);
    expect(store.queue).toHaveBeenCalledWith({ deviceIds: [id] }, "Fred user 7");
  });
  it("bounds schedule settings and rejects ambiguous or duplicate manual targets", async () => {
    for (const body of [{ schedulerArmed: true, rotationIntervalMinutes: 59 }, { schedulerArmed: true, rotationIntervalMinutes: 1441 }, { schedulerArmed: "true", rotationIntervalMinutes: 360 }, { schedulerArmed: false, rotationIntervalMinutes: 360, command: "run" }]) {
      expect((await request(app()).put(`${path}/settings`).set("Authorization", "Bearer fred-session").set("x-role", "cio").send(body)).status).toBe(400);
    }
    for (const body of [{ deviceIds: ["invalid"] }, { deviceIds: [id, id] }, { deviceIds: [id], building: "Science" }]) expect((await request(app()).post(`${path}/jobs`).set("Authorization", "Bearer fred-session").set("x-role", "network").send(body)).status).toBe(400);
    expect(store.saveSettings).not.toHaveBeenCalled(); expect(store.queue).not.toHaveBeenCalled();
  });
  it("reports disabled defaults without touching settings or worker persistence", async () => {
    process.env.BUILDING_DIAGNOSTICS_ENABLED = "false";
    const response = await request(app()).get(`${path}/settings`).set("Authorization", "Bearer fred-session").set("x-role", "network");
    expect(response.body).toMatchObject({ schedulerArmed: false, rotationIntervalMinutes: 360, persisted: false, effectiveSchedulerEnabled: false });
    expect((await request(app()).put(`${path}/settings`).set("Authorization", "Bearer fred-session").set("x-role", "cio").send({ schedulerArmed: true, rotationIntervalMinutes: 360 })).status).toBe(503);
    expect(store.settings).not.toHaveBeenCalled(); expect(store.saveSettings).not.toHaveBeenCalled(); expect(store.workerSeen).not.toHaveBeenCalled();
  });
  it("accepts only bounded central port telemetry and records authenticated worker contact", async () => {
    const observedAt = new Date().toISOString();
    const portTelemetry = { source: "snmp", observedAt, linkMbps: 1000, inBitsPerSecond: 12_000, inErrors: 2 };
    const observation = { mac: "00:11:22:33:44:55", source: "switch", building: "Science", switchName: "synthetic", port: "1/1/2", observedAt, edge: true, portTelemetry };
    const body = { snapshotComplete: true, adObservedAt: observedAt, adComputers: [adComputer], observations: [observation], userBuildingAssignments: [], collectorStatus: { observedAt, status: "ok", switchesObserved: 1, portObservations: 1, wifiObservations: 0 } };
    expect((await request(app()).post(`${path}/inventory`).set("Authorization", `Bearer ${worker}`).send(body)).status).toBe(200);
    expect(store.ingest).toHaveBeenCalledWith(body); expect(store.workerSeen).toHaveBeenCalledTimes(1);
    for (const telemetry of [{ ...portTelemetry, inErrors: Number.MAX_SAFE_INTEGER + 1 }, { ...portTelemetry, inErrors: 1.5 }, { ...portTelemetry, inBitsPerSecond: -1 }, { ...portTelemetry, source: "endpoint-claim" }]) expect((await request(app()).post(`${path}/inventory`).set("Authorization", `Bearer ${worker}`).send({ ...body, observations: [{ ...observation, portTelemetry: telemetry }] })).status).toBe(400);
    expect((await request(app()).post(`${path}/inventory`).set("Authorization", `Bearer ${worker}`).send({ ...body, observations: [{ ...observation, source: "wifi", bssid: observation.mac }] })).status).toBe(400);
    expect(store.ingest).toHaveBeenCalledTimes(1);
  });
  it("restricts the AD-only exchange to the private worker and rejects incomplete or mixed-scope uploads", async () => {
    const body = { snapshotComplete: true, adObservedAt: new Date().toISOString(), adComputers: [adComputer] };
    for (const credential of [token, "fred-session", "alerts.send-token"]) {
      expect((await request(app()).get(`${path}/ad-inventory`).set("Authorization", `Bearer ${credential}`).set("x-role", "cio")).status).toBe(401);
      expect((await request(app()).post(`${path}/ad-inventory`).set("Authorization", `Bearer ${credential}`).send(body)).status).toBe(401);
    }
    const read = await request(app()).get(`${path}/ad-inventory`).set("Authorization", `Bearer ${worker}`);
    expect(read.status).toBe(200); expect(read.headers["cache-control"]).toBe("no-store"); expect(read.body.adComputers).toEqual([adComputer]);
    expect((await request(app()).post(`${path}/ad-inventory`).set("Authorization", `Bearer ${worker}`).send(body)).status).toBe(200);
    expect(store.ingestAd).toHaveBeenCalledWith({ adObservedAt: body.adObservedAt, adComputers: [adComputer] });
    for (const invalid of [{ ...body, snapshotComplete: false }, { ...body, adComputers: [] }, { ...body, adComputers: [adComputer, adComputer] }, { ...body, observations: [] }]) expect((await request(app()).post(`${path}/ad-inventory`).set("Authorization", `Bearer ${worker}`).send(invalid)).status).toBe(400);
    expect(store.ingestAd).toHaveBeenCalledTimes(1);
  });
  it("exports a worker-only presence projection without user, MAC, audit or token data", async () => {
    for (const credential of [token, "fred-session", "alerts.send-token"]) expect((await request(app()).get(`${path}/reporting-snapshot`).set("Authorization", `Bearer ${credential}`).set("x-role", "cio")).status).toBe(401);
    store.overview.mockResolvedValueOnce({ readiness: { counts: { inventory: 1 } }, devices: [{ deviceId: id, adObjectGuid: jobId, computerName: "PC-1", adDomain: "sccc.edu", adEnabled: true, enrolled: true, revoked: false, online: true, adVerified: true, lastCheckIn: "2026-10-25T12:00:00Z", location: { building: "Synthetic", kind: "network-confirmed", source: "switch / 1/1/2", observedAt: "2026-10-25T12:00:00Z" }, loggedOnUser: "private-user", interfaces: [{ mac: "private-mac" }], deviceToken: "private-token", lastResult: { error: "private-error" } }], audit: ["private-audit"] } as any);
    const response = await request(app()).get(`${path}/reporting-snapshot`).set("Authorization", `Bearer ${worker}`);
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.devices).toEqual([{ deviceId: id, adObjectGuid: jobId, computerName: "PC-1", domain: "sccc.edu", enabled: true, enrolled: true, online: true, adVerified: true, lastSeenAt: "2026-10-25T12:00:00Z", location: { building: "Synthetic", kind: "network-confirmed", source: "switch / 1/1/2", observedAt: "2026-10-25T12:00:00Z" } }]);
    expect(response.body.updatedAt).toBe(response.body.observedAt);
    expect(JSON.stringify(response.body)).not.toMatch(/private-/);
  });
  it("separates administrator cancellation from device-owned status and rejects arbitrary external targets", async () => {
    expect((await request(app()).post(`${path}/jobs/${jobId}/cancel`).set("Authorization", `Bearer ${token}`).send({ reason: "stop measurement" })).status).toBe(401);
    expect((await request(app()).post(`${path}/jobs/${jobId}/cancel`).set("Authorization", "Bearer fred-session").set("x-role", "network").send({ reason: "stop measurement" })).status).toBe(200);
    expect((await request(app()).get(`${path}/agent/jobs/${jobId}`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect(store.jobStatus).toHaveBeenCalledWith(id, jobId);
    expect((await request(app()).post(`${path}/jobs`).set("Authorization", "Bearer fred-session").set("x-role", "network").send({ deviceIds: [id], type: "external-quick", targetOrigin: "https://evil.example.org" })).status).toBe(400);
  });
  it("accepts only bounded external measurement fields and emits v2 proofs for capable helpers", async () => {
    const job = { id: jobId, expiresAt: new Date(Date.now() + 120000).toISOString(), downloadBytes: 5242880, uploadBytes: 0, pingCount: 1, proofVersion: 2, type: "external-quick" as const, targetOrigin: "https://probe.example.org", timeoutSeconds: 30 };
    store.checkIn.mockResolvedValue(job);
    const response = await request(app()).post(`${path}/agent/check-in`).set("Authorization", `Bearer ${token}`).send({ ...heartbeat, capabilities: ["external-probe-v2"] });
    expect(response.body.job.proof).toBe(jobProof(token, id, job));
    const external = { type: job.type, targetOrigin: job.targetOrigin, path: "/probe-5mb.bin", timestamp: new Date().toISOString(), bytesReceived: 1024, elapsedMs: 30, httpStatus: 0, failure: "timeout", dnsMs: 2, dnsAddresses: ["8.8.8.8"], activeAdapter: { interfaceAlias: "Ethernet", localIp: "10.1.2.3", subnetPrefixLength: 24 } };
    expect((await request(app()).post(`${path}/agent/results`).set("Authorization", `Bearer ${token}`).send({ deviceId: id, jobId, external })).status).toBe(200);
    expect((await request(app()).post(`${path}/agent/results`).set("Authorization", `Bearer ${token}`).send({ deviceId: id, jobId, external: { ...external, bytesReceived: 1073741825 } })).status).toBe(400);
    expect((await request(app()).post(`${path}/agent/results`).set("Authorization", `Bearer ${token}`).send({ deviceId: id, jobId, external: { ...external, headers: { Authorization: "secret" } } })).status).toBe(400);
  });
  it("requires Fred network administrator access for viewing and queueing", async () => {
    expect((await request(app()).get(`${path}/overview`)).status).toBe(401);
    expect((await request(app()).get(`${path}/overview`).set("Authorization", "Bearer fred-session").set("x-role", "helpdesk")).status).toBe(403);
    expect((await request(app()).get(`${path}/overview`).set("Authorization", "Bearer fred-session").set("x-role", "network")).status).toBe(200);
    expect((await request(app()).post(`${path}/jobs`).set("Authorization", `Bearer ${worker}`).send({ deviceIds: [id] })).status).toBe(401);
    expect(store.queue).not.toHaveBeenCalled();
  });
  it("denies alert tokens, worker tokens and anonymous callers on agent routes", async () => {
    for (const credential of ["", worker, "sccc-device.alert-token"]) {
      expect((await request(app()).post(`${path}/agent/check-in`).set("Authorization", `Bearer ${credential}`).send(heartbeat)).status).toBe(401);
    }
    expect(store.checkIn).not.toHaveBeenCalled();
  });
  it("requires complete authenticated worker inventory; agent cannot assert AD roster", async () => {
    const body = { adObservedAt: new Date().toISOString(), adComputers: [adComputer], observations: [], userBuildingAssignments: [] };
    expect((await request(app()).post(`${path}/inventory`).set("Authorization", `Bearer ${token}`).send({ ...body, snapshotComplete: true })).status).toBe(401);
    expect((await request(app()).post(`${path}/inventory`).set("Authorization", `Bearer ${worker}`).send(body)).status).toBe(400);
    expect((await request(app()).post(`${path}/inventory`).set("Authorization", `Bearer ${worker}`).send({ ...body, snapshotComplete: true })).status).toBe(200);
    expect(store.ingest).toHaveBeenCalledTimes(1);
  });
  it("keeps disabled feature inert and does not initialize persistence", async () => {
    process.env.BUILDING_DIAGNOSTICS_ENABLED = "false";
    const response = await request(app()).get(`${path}/overview`).set("Authorization", "Bearer fred-session").set("x-role", "cio");
    expect(response.body.enabled).toBe(false); expect(response.body.devices).toEqual([]); expect(store.overview).not.toHaveBeenCalled();
    expect((await request(app()).post(`${path}/agent/check-in`).set("Authorization", `Bearer ${token}`).send(heartbeat)).status).toBe(503);
    expect(store.authenticate).not.toHaveBeenCalled();
  });
  it("rejects computer identity mismatches and arbitrary command fields", async () => {
    expect((await request(app()).post(`${path}/agent/check-in`).set("Authorization", `Bearer ${token}`).send({ ...heartbeat, computerName: "SPOOF" })).status).toBe(403);
    expect((await request(app()).post(`${path}/agent/check-in`).set("Authorization", `Bearer ${token}`).send({ ...heartbeat, command: "run" })).status).toBe(400);
    expect(store.checkIn).not.toHaveBeenCalled();
  });
  it("returns a device-bound job proof without alert or worker authority", async () => {
    const job = { id: jobId, expiresAt: "2026-10-25T12:02:00.000Z", downloadBytes: 8388608, uploadBytes: 8388608, pingCount: 5 };
    store.checkIn.mockResolvedValue(job);
    const response = await request(app()).post(`${path}/agent/check-in`).set("Authorization", `Bearer ${token}`).send(heartbeat);
    expect(response.status).toBe(200); expect(response.body.job.proof).toBe(jobProof(token, id, job));
    expect(JSON.stringify(response.body)).not.toContain(token);
  });
  it("restricts revoke and credential recovery to network administrators or the private worker", async () => {
    expect((await request(app()).post(`${path}/devices/${id}/revoke`).set("Authorization", `Bearer ${token}`).send({ reason: "recovery" })).status).toBe(401);
    expect((await request(app()).post(`${path}/devices/${id}/rotate`).set("Authorization", "Bearer fred-session").set("x-role", "helpdesk").send({ reason: "recovery" })).status).toBe(403);
    expect((await request(app()).post(`${path}/devices/${id}/revoke`).set("Authorization", `Bearer ${worker}`).send({ reason: "lost endpoint" })).status).toBe(200);
    const response = await request(app()).post(`${path}/devices/${id}/rotate`).set("Authorization", "Bearer fred-session").set("x-role", "cio").send({ reason: "recovery" });
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(store.rotate).toHaveBeenCalledWith(id, "recovery", "Fred user 7");
  });
});
describe("bounded transfer and result routes", () => {
  it("does not allocate/download for unauthenticated requests", async () => {
    expect((await request(app()).get(`${path}/agent/download/${jobId}`)).status).toBe(401);
    expect(store.transfer).not.toHaveBeenCalled();
  });
  it("sends the exact uncompressed authenticated download budget", async () => {
    const response = await request(app()).get(`${path}/agent/download/${jobId}`).set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200); expect(response.headers["content-length"]).toBe("256"); expect(response.body.length).toBe(256);
    expect(store.transferReceipt).toHaveBeenCalledWith(jobId, "download", 256);
  });
  it("counts upload bytes without buffering a body or accepting mismatched budgets", async () => {
    const response = await request(app()).put(`${path}/agent/upload/${jobId}`).set("Authorization", `Bearer ${token}`).set("Content-Type", "application/octet-stream").send(Buffer.alloc(256));
    expect(response.status).toBe(200); expect(response.body.bytes).toBe(256);
    expect(store.transferReceipt).toHaveBeenCalledWith(jobId, "upload", 256);
    expect((await request(app()).put(`${path}/agent/upload/${jobId}`).set("Authorization", `Bearer ${token}`).set("Content-Type", "application/octet-stream").send(Buffer.alloc(257))).status).toBe(413);
  });
  it("requires complete measurements and rejects device cross-submission", async () => {
    expect((await request(app()).post(`${path}/agent/results`).set("Authorization", `Bearer ${token}`).send({ deviceId: id, jobId, downloadMbps: 4 })).status).toBe(400);
    expect((await request(app()).post(`${path}/agent/results`).set("Authorization", `Bearer ${token}`).send({ deviceId: jobId, jobId, error: "failed" })).status).toBe(403);
    expect(store.result).not.toHaveBeenCalled();
  });
  it("limits and validates private worker report cursors", async () => {
    expect((await request(app()).get(`${path}/reports?limit=1001`).set("Authorization", `Bearer ${worker}`)).status).toBe(400);
    expect((await request(app()).get(`${path}/reports?after=0&limit=100`).set("Authorization", `Bearer ${worker}`)).status).toBe(200);
    expect(store.reports).toHaveBeenCalledWith("0", 100);
  });
});
