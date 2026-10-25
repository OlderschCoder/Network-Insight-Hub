import { Router, type RequestHandler } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { isIP } from "node:net";
import { requireAuth, requireCIO, requireNetworkAdmin } from "./auth";
import { BuildingProbeStore } from "../lib/building_probe_store";
import { assignmentInput, enrollmentInput, heartbeatInput, computerName, token, JobSigner,
  probeState, ProbeError, PAGING } from "../lib/building_probe_protocol";

type Store = Pick<BuildingProbeStore, "list" | "assign" | "revoke" | "enroll" | "authenticate" | "heartbeat" | "enqueue">;
interface Dependencies {
  store: Store; enabled: () => boolean; signer: () => JobSigner;
  authenticate: RequestHandler; view: RequestHandler; manage: RequestHandler;
  publicOrigin: () => string;
}
function getBearer(req: any): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || "");
  if (!match) throw new ProbeError(401, "A scoped probe credential is required.");
  return match[1];
}
export function createBuildingProbesRouter(deps: Dependencies) {
  const router = Router();
  const counters = new Map<string, { start: number; count: number }>();
  const limited = (key: string, limit: number) => {
    const now = Date.now();
    for (const [k, value] of counters) if (now - value.start >= 60_000) counters.delete(k);
    let counter = counters.get(key);
    if (!counter) {
      if (counters.size >= 2048) throw new ProbeError(429, "Enrollment is busy; retry later.");
      counter = { start: now, count: 0 }; counters.set(key, counter);
    }
    if (++counter.count > limit) throw new ProbeError(429, "Probe request rate exceeded.");
  };
  const enabled = () => { if (!deps.enabled()) throw new ProbeError(503, "Building probes are not enabled on this server."); };
  const run = (fn: (req: any, res: any) => Promise<void>): RequestHandler => async (req, res) => {
    try { await fn(req, res); }
    catch (error: any) {
      if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid building-probe request." }); return; }
      if (error instanceof ProbeError) { res.status(error.status).json({ error: error.message }); return; }
      // Never return SQL, raw exceptions, provisioning values or credentials.
      res.status(503).json({ error: "Building-probe storage or signing is unavailable." });
    }
  };
  router.get("/", deps.authenticate, deps.view, run(async (_req, res) => {
    if (!deps.enabled()) { res.json({ enabled: false, probes: [], paging: PAGING }); return; }
    const probes = await deps.store.list();
    res.setHeader("Cache-Control", "no-store");
    res.json({ enabled: true, paging: PAGING,
      probes: probes.map((p: any) => ({ ...p, state: probeState(p.lastSeen, p.enabled) })) });
  }));
  router.post("/assignments", deps.authenticate, deps.manage, run(async (req, res) => {
    enabled(); const signer = deps.signer();
    const input = assignmentInput.parse(req.body);
    try { computerName(input.computerName); } catch { throw new ProbeError(400, "A valid Windows computer name is required."); }
    if (input.expectedVoiceSubnet && isIP(input.expectedVoiceSubnet.split("/")[0]) !== 4)
      throw new ProbeError(400, "Expected voice subnet must be an IPv4 CIDR.");
    const origin = new URL(deps.publicOrigin());
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
      throw new ProbeError(503, "A fixed public HTTPS origin must be configured.");
    const bootstrap = token();
    const assignment = await deps.store.assign(input, bootstrap, req.user.id);
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ assignment, provisioning: { serverUrl: `${origin.origin}/api/building-probes`,
      assignmentId: assignment.id, building: input.building.trim(), computerName: computerName(input.computerName),
      bootstrapToken: bootstrap, jobPublicKey: signer.publicKey(), adapterId: input.adapterId || null,
      expectedVoiceSubnet: input.expectedVoiceSubnet || null, enabled: true }, expiresInMinutes: 20 });
  }));
  router.post("/assignments/:id/revoke", deps.authenticate, deps.manage, run(async (req, res) => {
    enabled(); const id = z.string().uuid().parse(req.params.id); await deps.store.revoke(id); res.json({ revoked: true });
  }));
  router.post("/assignments/:id/jobs", deps.authenticate, deps.view, run(async (req, res) => {
    enabled(); deps.signer(); const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ kind: z.enum(["network", "multicast"]) }).strict().parse(req.body);
    res.status(202).json(await deps.store.enqueue(id, body.kind, req.user.id));
  }));
  router.post("/agent/enroll", run(async (req, res) => {
    enabled(); limited(`enroll:${req.ip}`, 60);
    const input = enrollmentInput.parse(req.body); const bootstrap = getBearer(req);
    try { computerName(input.computerName); } catch { throw new ProbeError(400, "Invalid computer name."); }
    await deps.store.enroll(input, bootstrap);
    res.setHeader("Cache-Control", "no-store");
    res.json({ deviceId: input.deviceId, deviceToken: input.proposedToken });
  }));
  router.post("/agent/heartbeat", run(async (req, res) => {
    enabled(); const input = heartbeatInput.parse(req.body); const credential = getBearer(req);
    await deps.store.authenticate(input.assignmentId, input.deviceId, credential);
    limited(`probe:${input.assignmentId}`, 12);
    if (input.results.some(r => new Date(r.completedAt).getTime() < new Date(r.startedAt).getTime()
      || (r.outcome === "received" && (!r.details.packets || !r.details.localAddress))))
      throw new ProbeError(400, "Inconsistent diagnostic result.");
    const result = await deps.store.heartbeat(input.assignmentId, input.deviceId, credential,
      input.snapshot, input.results, deps.signer());
    res.setHeader("Cache-Control", "no-store"); res.json(result);
  }));
  router.get("/agent/ping", run(async (req, res) => {
    enabled(); const assignment = z.string().uuid().parse(req.headers["x-sccc-assignment"]);
    const device = z.string().uuid().parse(req.headers["x-sccc-device"]);
    await deps.store.authenticate(assignment, device, getBearer(req)); res.status(204).end();
  }));
  return router;
}

let signer: JobSigner | undefined;
const router = createBuildingProbesRouter({
  store: new BuildingProbeStore(pool), enabled: () => process.env.BUILDING_PROBES_ENABLED === "true",
  signer: () => {
    const path = process.env.BUILDING_PROBE_SIGNING_KEY_FILE;
    if (!path) throw new ProbeError(503, "A separate building-probe job signing key is required.");
    return signer ??= JobSigner.fromFile(path);
  },
  authenticate: requireAuth, view: requireNetworkAdmin, manage: requireCIO,
  publicOrigin: () => process.env.BUILDING_PROBE_PUBLIC_ORIGIN || "https://app-server2.centralus.cloudapp.azure.com",
});
export default router;
