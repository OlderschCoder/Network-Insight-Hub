import express from "express";
import request from "supertest";
import { generateKeyPairSync, createPublicKey, verify, randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
vi.mock("./auth", () => ({ requireAuth: vi.fn(), requireCIO: vi.fn(), requireNetworkAdmin: vi.fn() }));
import { createBuildingProbesRouter } from "./building_probes";
import { JobSigner, heartbeatInput, probeState, token, ProbeError,digest } from "../lib/building_probe_protocol";
const id = randomUUID(), buildingId=randomUUID(), deviceId = randomUUID(), credential = token();
const signer = new JobSigner(generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey);
const snapshot = { schema: "sccc.building-probe.v1", computerName: "WEST-LAB-01", agentVersion: "0.1.0",
  capturedAt: new Date().toISOString(), uptimeSeconds: 100, diagnosticsMode: "on-demand", adapters: [],
  keyAlert: { installed: true, serviceState: "Running", version: "0.4.2", uiProcessCount: 1 } };
function setup(enabled = true,exportHash:string|null=null) {
  const store = { list: vi.fn().mockResolvedValue([]),buildings:vi.fn().mockResolvedValue([{id:buildingId,label:'West Campus',normalizedKey:'west-campus'}]),createBuilding:vi.fn().mockResolvedValue({id:buildingId}),select:vi.fn().mockResolvedValue({selected:true,revision:1}),exportResults:vi.fn().mockResolvedValue({results:[],nextCursor:'0'}), assign: vi.fn().mockResolvedValue({ id,building:'West Campus' }),
    revoke: vi.fn().mockResolvedValue(undefined), enroll: vi.fn().mockResolvedValue(undefined),
    authenticate: vi.fn().mockResolvedValue({}), heartbeat: vi.fn().mockResolvedValue({ job: null, acceptedResults: [] }),
    enqueue: vi.fn().mockResolvedValue({ id, status: "pending" }) };
  const auth = (req: any, res: any, next: any) => {
    if (req.headers.authorization !== "Bearer admin-test") return res.sendStatus(401);
    req.user = { id: 42, role: req.headers["x-role"] }; next();
  };
  const role = (roles: string[]) => (req: any, res: any, next: any) => roles.includes(req.user.role) ? next() : res.sendStatus(403);
  const app = express(); app.use(express.json({ limit: "64kb" }));
  app.use("/", createBuildingProbesRouter({ store, enabled: () => enabled, signer: () => signer,
    publicOrigin: () => "https://example.test", authenticate: auth, view: role(["cio", "network"]), manage: role(["cio"]),exportTokenHash:()=>exportHash }));
  return { app, store };
}
const admin = (req: request.Test, role = "cio") => req.set("Authorization", "Bearer admin-test").set("X-Role", role);
describe("building probes HTTP boundary", () => {
  it("requires network administrator access and separate CIO target management", async () => {
    const { app } = setup();
    expect((await request(app).get("/")).status).toBe(401);
    expect((await admin(request(app).get("/"), "helpdesk")).status).toBe(403);
    expect((await admin(request(app).get("/"), "network")).status).toBe(200);
    expect((await admin(request(app).post("/assignments"), "network").send({})).status).toBe(403);
  });
  it("defaults to an inactive, read-only empty monitor when feature is off", async () => {
    const { app, store } = setup(false);
    expect((await admin(request(app).get("/"))).body.enabled).toBe(false);
    expect(store.list).not.toHaveBeenCalled();
    expect((await request(app).post("/agent/enroll").send({})).status).toBe(503);
    expect((await admin(request(app).post("/assignments")).send({})).status).toBe(503);
  });
  it("issues a computer-bound one-time provision without persisting plaintext credentials", async () => {
    const { app, store } = setup();
    const res = await admin(request(app).post("/assignments")).send({ buildingId, computerName: "west-lab-01" });
    expect(res.status).toBe(201); expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.provisioning.computerName).toBe("WEST-LAB-01");
    expect(res.body.provisioning.bootstrapToken).toMatch(/^[\w-]{43}$/);
    expect(store.assign).toHaveBeenCalledOnce(); expect(res.body.expiresInMinutes).toBe(20);
    expect((await admin(request(app).get("/"))).body).not.toHaveProperty("bootstrapToken");
  });
  it("rejects invalid CIDRs, copied credentials and arbitrary job arguments", async () => {
    const { app, store } = setup();
    expect((await admin(request(app).post("/assignments")).send({ buildingId, computerName: "PC", expectedVoiceSubnet: "999.0.0.0/24" })).status).toBe(400);
    expect((await admin(request(app).post(`/assignments/${id}/jobs`)).send({ kind: "network", command: "whoami" })).status).toBe(400);
    expect((await request(app).post("/agent/heartbeat").send({ assignmentId: id, deviceId, snapshot, results: [] })).status).toBe(401);
    store.authenticate.mockRejectedValue(new ProbeError(401, "Probe credential rejected."));
    expect((await request(app).post("/agent/heartbeat").set("Authorization", `Bearer ${credential}`).send({ assignmentId: id, deviceId, snapshot, results: [] })).status).toBe(401);
    expect(store.heartbeat).not.toHaveBeenCalled();
  });
  it("accepts only scoped metadata and reports, never audio or shell payloads", async () => {
    const { app, store } = setup();
    const body = { assignmentId: id, deviceId, snapshot, results: [] };
    expect((await request(app).post("/agent/heartbeat").set("Authorization", `Bearer ${credential}`).send(body)).status).toBe(200);
    expect(store.heartbeat).toHaveBeenCalledOnce();
    expect(heartbeatInput.safeParse({ ...body, audio: "secret" }).success).toBe(false);
    expect(heartbeatInput.safeParse({ ...body, snapshot: { ...snapshot, alertToken: "secret" } }).success).toBe(false);
    expect((await request(app).post("/agent/heartbeat").set("Authorization", `Bearer ${credential}`).send({ ...body, results: [{ jobId: randomUUID(), kind: "multicast", startedAt: snapshot.capturedAt, completedAt: snapshot.capturedAt, outcome: "received", details: { packets: 0 } }] })).status).toBe(400);
  });
  it("does not expose storage exceptions", async () => {
    const { app, store } = setup(); store.list.mockRejectedValue(new Error("password=secret SQL"));
    const res = await admin(request(app).get("/")); expect(res.status).toBe(503); expect(res.text).not.toContain("password");
  });
  it("bounds authenticated polling and does not share alert credentials", async () => {
    const { app } = setup(); let last;
    for (let n = 0; n < 13; n++) last = await request(app).post("/agent/heartbeat").set("Authorization", `Bearer ${credential}`).send({ assignmentId: id, deviceId, snapshot, results: [] });
    expect(last!.status).toBe(429);
    expect((await request(app).get("/agent/ping").set("Authorization", "Bearer alert-credential")).status).toBe(400);
  });
  it('uses CIO-only catalog IDs and separate selection without credential revocation',async()=>{
    const {app,store}=setup();
    expect((await admin(request(app).post('/buildings'),'network').send({label:'Science'})).status).toBe(403);
    expect((await admin(request(app).post('/buildings')).send({label:'Science'})).status).toBe(201);
    expect((await admin(request(app).post('/assignments')).send({building:'Science',computerName:'PC'})).status).toBe(400);
    expect((await admin(request(app).post(`/assignments/${id}/selection`),'network').send({selected:true})).status).toBe(403);
    expect((await admin(request(app).post(`/assignments/${id}/selection`)).send({selected:false})).status).toBe(200);
    expect(store.select).toHaveBeenCalledWith(id,false);expect(store.revoke).not.toHaveBeenCalled();
  });
  it('keeps current and revoked history separate and shows reviewed schedule bounds',async()=>{
    const {app,store}=setup();
    const current=await admin(request(app).get('/'));
    expect(current.body.schedule.enabled).toBe(false);expect(current.body.schedule.profiles.hourly.maxBytes).toBe(64000000);
    expect(current.body.schedule.capacityEnabled).toBe(false);expect(current.body.schedule.capacityReason).toBe('Capacity diagnostics are disabled.');
    expect(current.body.schedule.staggerWindowSeconds).toBe(2700);
    expect((await admin(request(app).get('/history'))).status).toBe(200);expect(store.list).toHaveBeenCalledWith(true);
  });
  it('requires independent read-only export credentials and validates recent/cursor paging',async()=>{
    const {app,store}=setup(true,digest(credential));
    expect((await admin(request(app).get('/results/export'))).status).toBe(401);
    expect((await request(app).get('/results/export?recent=true&after=3').set('Authorization',`Bearer ${credential}`)).status).toBe(400);
    expect((await request(app).get('/results/export?recent=true&limit=1000').set('Authorization',`Bearer ${credential}`)).status).toBe(200);
    expect(store.exportResults).toHaveBeenCalledWith('0',1000,true);
    expect((await request(app).post('/results/export').set('Authorization',`Bearer ${credential}`).send({})).status).toBe(404);
  });
});
describe("signed jobs and monitor state", () => {
  it("signs portable P-256 jobs with a separate public key", () => {
    const job = { id, assignmentId: id, deviceId, kind: "multicast" as const, issuedAt: 100, expiresAt: 280 };
    const parts = signer.sign(job).split(".");
    const publicKey = createPublicKey({ key: Buffer.from(signer.publicKey(), "base64"), type: "spki", format: "der" });
    expect(verify("sha256", Buffer.from(parts.slice(0, 2).join(".")), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"))).toBe(true);
    expect(verify("sha256", Buffer.from(parts[0] + ".tampered"), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"))).toBe(false);
  });
  it("never treats unprovisioned or stale targets as reporting", () => {
    expect(probeState(null, true)).toBe("awaiting_enrollment");
    expect(probeState(new Date(Date.now() - 301000), true)).toBe("stale");
    expect(probeState(new Date(), false)).toBe("revoked");
    expect(probeState(new Date(), true)).toBe("reporting");
  });
});
