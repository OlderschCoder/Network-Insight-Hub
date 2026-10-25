import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("./auth", () => ({
  requireAuth(req: any, res: any, next: any) { if (req.headers.authorization !== "Bearer fred-session") return res.status(401).json({ error: "Unauthorized" }); req.user = { id: 7, role: req.headers["x-role"] }; next(); },
  requireNetworkAdmin(req: any, res: any, next: any) { return ["cio", "network", "network_engineer"].includes(req.user?.role) ? next() : res.status(403).json({ error: "Forbidden" }); },
}));
import { createBuildingDiagnosticsRouter } from "./building_diagnostics";
import { jobProof } from "../lib/building_diagnostics";
const id = "12078014-77bb-43b6-9bde-bbb213668861", jobId = "1bf02e30-1a1e-4d16-9c33-ef3abfd36471";
const token = `sccc-diag.${"a".repeat(43)}`, worker = "w".repeat(40);
const store = {
  overview: vi.fn(async () => ({ devices: [], buildings: [], jobs: [] })),
  ingest: vi.fn(async () => ({ ok: true })), provision: vi.fn(async () => ({ deviceId: id, deviceToken: token })),
  authenticate: vi.fn(async (value: string) => value === token ? { deviceId: id, computerName: "PC-1", domain: "sccc.edu" } : null),
  queue: vi.fn(async () => ({ queued: 1, jobIds: [jobId] })), checkIn: vi.fn(), transfer: vi.fn(), transferReceipt: vi.fn(), result: vi.fn(async () => ({ ok: true })), reports: vi.fn(async () => ({ reports: [], nextCursor: "0" })),
  revoke: vi.fn(async () => ({ ok: true })), rotate: vi.fn(async () => ({ deviceId: id, deviceToken: token })),
};
function app() { const a = express(); a.use(express.json()); a.use("/api/building-diagnostics", createBuildingDiagnosticsRouter(store as any)); return a; }
const path = "/api/building-diagnostics";
const heartbeat = { deviceId: id, computerName: "PC-1", adDomain: "sccc.edu", adJoined: true, uptimeSeconds: 20, agentVersion: "1.0.0", interfaces: [{ mac: "aa:bb:cc:dd:ee:ff", ipAddresses: ["10.0.0.4"], kind: "ethernet" }] };
beforeEach(() => {
  vi.clearAllMocks(); process.env.BUILDING_DIAGNOSTICS_ENABLED = "true"; process.env.BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED = "false"; process.env.BUILDING_DIAGNOSTICS_WORKER_TOKEN = worker;
  store.checkIn.mockResolvedValue(null); store.transfer.mockResolvedValue({ downloadBytes: 256, uploadBytes: 256 });
});
describe("building diagnostics authority boundaries", () => {
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
    const body = { adObservedAt: new Date().toISOString(), adComputers: [], observations: [], userBuildingAssignments: [] };
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
