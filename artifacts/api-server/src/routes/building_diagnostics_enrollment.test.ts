import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("./auth", () => ({
  requireAuth(req: any, res: any, next: any) { if (req.headers.authorization !== "Bearer fred-session") return res.status(401).json({ error: "Unauthorized" }); req.user = { id: 7, role: req.headers["x-role"] }; next(); },
  requireNetworkAdmin(req: any, res: any, next: any) { return ["cio", "network", "network_engineer"].includes(req.user?.role) ? next() : res.status(403).json({ error: "Forbidden" }); },
}));
import { createDiagnosticsEnrollmentRouter } from "./building_diagnostics_enrollment";
const id = "12078014-77bb-43b6-9bde-bbb213668861", requestId = "1bf02e30-1a1e-4d16-9c33-ef3abfd36471", claimId = "deefcfac-9721-4f21-922a-1d79457e0da0", worker = "w".repeat(40);
const store = { create: vi.fn(async () => ({ requestId, requested: 1, items: [{ adObjectGuid: id, status: "queued" }] })), get: vi.fn(async () => ({ requestId, items: [] })), claim: vi.fn(async () => ({ items: [] })), provision: vi.fn(async () => ({ deviceToken: "private-worker-only" })), result: vi.fn(async () => ({ ok: true })) };
const path = "/api/building-diagnostics/devices/bulk-enrollment";
function app() { const app = express(); app.use(express.json()); app.use("/api/building-diagnostics", createDiagnosticsEnrollmentRouter(store as any)); return app; }
beforeEach(() => { vi.clearAllMocks(); process.env.BUILDING_DIAGNOSTICS_ENABLED = "true"; process.env.BUILDING_DIAGNOSTICS_WORKER_TOKEN = worker; });
describe("protected bulk diagnostics enrollment", () => {
  it("requires an existing network-role SSO session to originate a selection", async () => {
    for (const token of [worker, "alert-token", "device-token"]) expect((await request(app()).post(path).set("Authorization", `Bearer ${token}`).send({ requestId, adObjectGuids: [id] })).status).toBe(401);
    expect((await request(app()).post(path).set("Authorization", "Bearer fred-session").set("x-role", "viewer").send({ requestId, adObjectGuids: [id] })).status).toBe(403);
    const response = await request(app()).post(path).set("Authorization", "Bearer fred-session").set("x-role", "network").send({ requestId, adObjectGuids: [id] });
    expect(response.status).toBe(202); expect(response.headers["cache-control"]).toBe("no-store"); expect(JSON.stringify(response.body)).not.toContain("deviceToken");
    expect(store.create).toHaveBeenCalledWith({ requestId, adObjectGuids: [id] }, "Fred user 7");
  });
  it("rejects duplicate, oversized and arbitrary command/config selections", async () => {
    for (const input of [{ requestId, adObjectGuids: [id, id] }, { requestId, adObjectGuids: [id], activateScheduler: true }, { requestId, adObjectGuids: Array(1001).fill(id) }, { requestId, adObjectGuids: ["bad-guid"] }, { requestId, adObjectGuids: [] }]) expect((await request(app()).post(path).set("Authorization", "Bearer fred-session").set("x-role", "cio").send(input)).status).toBe(400);
    expect(store.create).not.toHaveBeenCalled();
  });
  it("confines claims, one-time credentials and receipts to the private worker", async () => {
    for (const operation of ["claim", "provision", "result"]) expect((await request(app()).post(`${path}/worker/${operation}`).set("Authorization", "Bearer fred-session").set("x-role", "cio").send({})).status).toBe(401);
    expect((await request(app()).post(`${path}/worker/provision`).set("Authorization", `Bearer ${worker}`).send({ requestId, adObjectGuid: id, claimId })).status).toBe(201);
    expect((await request(app()).get(`${path}/${requestId}`).set("Authorization", `Bearer ${worker}`)).status).toBe(401);
    expect((await request(app()).post(`${path}/worker/result`).set("Authorization", `Bearer ${worker}`).send({ requestId, adObjectGuid: id, claimId, status: "online", reason: "installed-awaiting-check-in" })).status).toBe(400);
  });
  it("honors the existing feature gate without queuing work", async () => {
    process.env.BUILDING_DIAGNOSTICS_ENABLED = "false";
    expect((await request(app()).post(path).set("Authorization", "Bearer fred-session").set("x-role", "network").send({ requestId, adObjectGuids: [id] })).status).toBe(503);
    expect(store.create).not.toHaveBeenCalled();
  });
  it("supports an optional bounded UUID request filter without changing worker authorization", async () => {
    expect((await request(app()).post(`${path}/worker/claim`).set("Authorization", `Bearer ${worker}`).send({ workerId: "TEST-WORKER" })).status).toBe(200);
    expect(store.claim).toHaveBeenLastCalledWith("TEST-WORKER", undefined);
    expect((await request(app()).post(`${path}/worker/claim`).set("Authorization", `Bearer ${worker}`).send({ workerId: "TEST-WORKER", requestIds: [requestId.toUpperCase(), requestId] })).status).toBe(200);
    expect(store.claim).toHaveBeenLastCalledWith("TEST-WORKER", [requestId]);
    for (const requestIds of [[], ["bad-guid"], Array(17).fill(requestId), null, requestId]) expect((await request(app()).post(`${path}/worker/claim`).set("Authorization", `Bearer ${worker}`).send({ workerId: "TEST-WORKER", requestIds })).status).toBe(400);
    expect(store.claim).toHaveBeenCalledTimes(2);
  });
});
