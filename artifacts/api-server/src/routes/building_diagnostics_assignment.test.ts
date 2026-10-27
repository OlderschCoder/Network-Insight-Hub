import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("./network_nodes", () => ({ getBuildingSummaries: vi.fn() }));
vi.mock("./auth", () => ({
  requireAuth(req: any, res: any, next: any) {
    if (req.headers.authorization !== "Bearer fred-session") return res.status(401).json({ error: "Unauthorized" });
    req.user = { id: 7, role: req.headers["x-role"], name: "Synthetic operator", entraObjectId: req.headers["x-entra"] === "none" ? null : "b8f6d2ad-ad3f-42d4-ae3c-602592904c88" }; next();
  },
  requireNetworkAdmin(req: any, res: any, next: any) { return ["cio", "network", "network_engineer"].includes(req.user?.role) ? next() : res.status(403).json({ error: "Forbidden" }); },
}));
import { createBuildingDiagnosticsAssignmentRouter } from "./building_diagnostics_assignment";
import { DiagnosticsError } from "../lib/building_diagnostics_store";
const id = "a3cf38da-324f-437b-bd35-1d34bd32b2e9", other = "b2b8d74a-57bf-4ebf-85d7-8429ca6eab1c";
const store = { get: vi.fn(async () => ({ buildings: ["Agriculture", "Hobble"], assignments: [] })), apply: vi.fn(async (_input: any, _actor: any) => ({ ok: true, updated: 1, assignments: [] })), applyGroup: vi.fn(async (_input: any, _actor: any) => ({ ok: true, updated: 1 })) };
const path = "/api/building-diagnostics/building-assignments";
const body = { adObjectGuids: [id], building: "Hobble", reason: "Operator confirmed the assignment", apply: true };
function app() { const app = express(); app.use(express.json()); app.use("/api/building-diagnostics", createBuildingDiagnosticsAssignmentRouter(store as any)); return app; }
beforeEach(() => { vi.clearAllMocks(); process.env.BUILDING_DIAGNOSTICS_ENABLED = "true"; });
function post(input: unknown = body) { return request(app()).post(path).set("Authorization", "Bearer fred-session").set("x-role", "network").send(input); }
describe("manual building assignment authorization and intent", () => {
  it("requires the existing network session and keeps GET metadata non-cacheable", async () => {
    expect((await request(app()).get(path)).status).toBe(401);
    expect((await request(app()).post(path).set("Authorization", "Bearer worker-token").send(body)).status).toBe(401);
    expect((await request(app()).get(path).set("Authorization", "Bearer fred-session").set("x-role", "viewer")).status).toBe(403);
    const result = await request(app()).get(path).set("Authorization", "Bearer fred-session").set("x-role", "network");
    expect(result.status).toBe(200); expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body).toEqual({ buildings: ["Agriculture", "Hobble"], assignments: [] });
  });
  it("requires an actual Entra-linked operator for mutation", async () => {
    expect((await post().set("x-entra", "none")).status).toBe(403);
    expect(store.apply).not.toHaveBeenCalled();
  });
  it("normalizes selected identities once and takes audit identity only from the session", async () => {
    const result = await post({ ...body, adObjectGuids: [other, id.toUpperCase(), id], reason: "  Confirmed campus placement  " });
    expect(result.status).toBe(200);
    expect(store.apply).toHaveBeenCalledWith({ ...body, adObjectGuids: [id, other], reason: "Confirmed campus placement" }, { userId: 7, entraObjectId: "b8f6d2ad-ad3f-42d4-ae3c-602592904c88", name: "Synthetic operator" });
  });
  it("supports an explicit reversible clear without changing the request scope", async () => {
    expect((await post({ ...body, building: null })).status).toBe(200);
    expect(store.apply.mock.calls[0][0].building).toBeNull();
  });
  it("rejects missing Apply, arbitrary commands, invalid identities and unbounded requests", async () => {
    for (const invalid of [{ ...body, apply: false }, { ...body, apply: undefined }, { ...body, adObjectGuids: [] }, { ...body, adObjectGuids: ["invalid"] }, { ...body, adObjectGuids: Array(1001).fill(id) }, { ...body, reason: "x" }, { ...body, reason: "x".repeat(301) }, { ...body, building: "" }, { ...body, runTest: true }, { ...body, actor: "forged" }]) expect((await post(invalid)).status).toBe(400);
    expect(store.apply).not.toHaveBeenCalled();
  });
  it("fails closed when the feature is disabled", async () => {
    process.env.BUILDING_DIAGNOSTICS_ENABLED = "false";
    expect((await post()).status).toBe(503); expect(store.apply).not.toHaveBeenCalled();
  });
  it("returns validation failures without raw internal errors", async () => {
    store.apply.mockRejectedValueOnce(new DiagnosticsError(409, "Current AD inventory required"));
    expect((await post()).body).toEqual({ error: "Current AD inventory required" });
    store.apply.mockRejectedValueOnce(new Error("synthetic private detail"));
    expect((await post()).body).toEqual({ error: "Building assignment operation failed" });
  });
  it("requires the same authenticated explicit Apply contract for editable AD group mappings", async () => {
    const group = { groupObjectGuid: other, building: "Hobble", reason: "Confirmed directory group mapping", apply: true };
    const endpoint = "/api/building-diagnostics/building-group-mappings";
    expect((await request(app()).post(endpoint).send(group)).status).toBe(401);
    expect((await request(app()).post(endpoint).set("Authorization", "Bearer fred-session").set("x-role", "network").set("x-entra", "none").send(group)).status).toBe(403);
    expect((await request(app()).post(endpoint).set("Authorization", "Bearer fred-session").set("x-role", "network").send({ ...group, apply: false })).status).toBe(400);
    expect((await request(app()).post(endpoint).set("Authorization", "Bearer fred-session").set("x-role", "network").send(group)).status).toBe(200);
    expect(store.applyGroup).toHaveBeenCalledWith(group, { userId: 7, entraObjectId: "b8f6d2ad-ad3f-42d4-ae3c-602592904c88", name: "Synthetic operator" });
  });
});
