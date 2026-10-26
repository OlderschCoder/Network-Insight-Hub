import { Router, type RequestHandler } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { requireAuth, requireCIO, requireNetworkAdmin } from "./auth";
import { BuildingProbeStore } from "../lib/building_probe_store";
import { assignmentInput, enrollmentInput, heartbeatInput, computerName, token, JobSigner,
  probeState, ProbeError, PAGING, THROUGHPUT_PROFILES, matches } from "../lib/building_probe_protocol";
import { PROBE_TIME_ZONE, STAGGER_SECONDS } from "../lib/building_probe_scheduler";

type Store = Pick<BuildingProbeStore, "list" | "buildings" | "createBuilding" | "assign" | "select" | "revoke" | "enroll" | "authenticate" | "heartbeat" | "enqueue" | "exportResults">;
interface Dependencies {
  store: Store; enabled: () => boolean; signer: () => JobSigner;
  authenticate: RequestHandler; view: RequestHandler; manage: RequestHandler;
  publicOrigin: () => string;
  schedule?: () => { enabled: boolean; targetReady: boolean; quickConcurrency?:number;hourlyConcurrency?:number;capacityConcurrency?: number };
  exportTokenHash?: () => string | null;
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
  const schedule = () => {
    const policy = deps.schedule?.() ?? { enabled: false, targetReady: false, capacityConcurrency: 1 };
    return { ...policy, enabled: deps.enabled() && policy.enabled, targetId: "sccc-external-v1", profiles: THROUGHPUT_PROFILES, timeZone: PROBE_TIME_ZONE,
      capacityWindows: ["07:00", "19:00"], staggerWindowSeconds: STAGGER_SECONDS, capacityStartDeadlineMinutes: 45, capacityHardEndMinutes: 60,
      quickConcurrency:Math.max(1,Math.min(4,policy.quickConcurrency??4)),hourlyConcurrency:Math.max(1,Math.min(2,policy.hourlyConcurrency??1)),capacityConcurrency: Math.max(1,Math.min(2,policy.capacityConcurrency??1)),quickQueueWindowSeconds:240,
      reason: !policy.enabled ? "Staged: scheduling is disabled pending bounds review." : !policy.targetReady ? "Staged: external throughput target readiness is not approved." : null };
  };
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
    if (!deps.enabled()) { res.json({ enabled: false, probes: [], buildings: [], schedule: schedule(), paging: PAGING }); return; }
    const probes = await deps.store.list();
    res.setHeader("Cache-Control", "no-store");
    res.json({ enabled: true, paging: PAGING, buildings: await deps.store.buildings(), schedule: schedule(),
      probes: probes.map((p: any) => ({ ...p, state: probeState(p.lastSeen, p.enabled) })) });
  }));
  router.get("/history",deps.authenticate,deps.view,run(async (_req,res)=>{
    if(!deps.enabled()){res.json({probes:[]});return;} res.setHeader("Cache-Control","no-store");
    res.json({probes:(await deps.store.list(true)).map((p:any)=>({...p,state:probeState(p.lastSeen,p.enabled)}))});
  }));
  router.post("/buildings",deps.authenticate,deps.manage,run(async(req,res)=>{
    enabled();const body=z.object({label:z.string().trim().min(1).max(160)}).strict().parse(req.body);
    res.status(201).json(await deps.store.createBuilding(body.label,req.user.id));
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
      assignmentId: assignment.id, building: assignment.building, computerName: computerName(input.computerName),
      bootstrapToken: bootstrap, jobPublicKey: signer.publicKey(), adapterId: input.adapterId || null,
      expectedVoiceSubnet: input.expectedVoiceSubnet || null, enabled: true }, expiresInMinutes: 20 });
  }));
  router.post("/assignments/:id/selection",deps.authenticate,deps.manage,run(async(req,res)=>{
    enabled();const id=z.string().uuid().parse(req.params.id);const body=z.object({selected:z.boolean()}).strict().parse(req.body);
    res.json(await deps.store.select(id,body.selected));
  }));
  router.post("/assignments/:id/revoke", deps.authenticate, deps.manage, run(async (req, res) => {
    enabled(); const id = z.string().uuid().parse(req.params.id); await deps.store.revoke(id); res.json({ revoked: true });
  }));
  router.post("/assignments/:id/jobs", deps.authenticate, deps.view, run(async (req, res) => {
    enabled(); deps.signer(); const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ kind: z.enum(["network", "multicast", "throughput"]) }).strict().parse(req.body);
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
      input.snapshot, input.results, deps.signer(), input.runningJobId);
    res.setHeader("Cache-Control", "no-store"); res.json(result);
  }));
  router.get("/results/export",run(async(req,res)=>{
    enabled();const hash=deps.exportTokenHash?.()??null;
    if(!matches(getBearer(req),hash))throw new ProbeError(401,"A separate read-only export credential is required.");
    const after=z.string().regex(/^\d{1,18}$/).parse(req.query.after??"0");const limit=z.coerce.number().int().min(1).max(1000).parse(req.query.limit??100);
    const recent=z.enum(['true','false']).parse(req.query.recent??'false')==='true';
    if(recent&&after!=='0')throw new ProbeError(400,'Recent mode cannot be combined with a nonzero cursor.');
    res.setHeader("Cache-Control","no-store");res.json(await deps.store.exportResults(after,limit,recent));
  }));
  router.get("/agent/ping", run(async (req, res) => {
    enabled(); const assignment = z.string().uuid().parse(req.headers["x-sccc-assignment"]);
    const device = z.string().uuid().parse(req.headers["x-sccc-device"]);
    await deps.store.authenticate(assignment, device, getBearer(req)); res.status(204).end();
  }));
  return router;
}

let signer: JobSigner | undefined;
const schedulePolicy=()=>({enabled:process.env.BUILDING_PROBE_SCHEDULER_ENABLED==="true",targetReady:process.env.BUILDING_PROBE_THROUGHPUT_TARGET_READY==="true",quickConcurrency:Math.max(1,Math.min(4,Math.floor(Number(process.env.BUILDING_PROBE_QUICK_CONCURRENCY)||4))),hourlyConcurrency:Math.max(1,Math.min(2,Math.floor(Number(process.env.BUILDING_PROBE_HOURLY_CONCURRENCY)||1))),capacityConcurrency:Math.max(1,Math.min(2,Math.floor(Number(process.env.BUILDING_PROBE_CAPACITY_CONCURRENCY)||1))) });
const router = createBuildingProbesRouter({
  store: new BuildingProbeStore(pool,schedulePolicy), enabled: () => process.env.BUILDING_PROBES_ENABLED === "true",schedule:schedulePolicy,
  exportTokenHash:()=>{const path=process.env.BUILDING_PROBE_EXPORT_TOKEN_HASH_FILE;if(!path)return null;try{const hash=readFileSync(path,"utf8").trim();return /^[a-f0-9]{64}$/.test(hash)?hash:null;}catch{return null;}},
  signer: () => {
    const path = process.env.BUILDING_PROBE_SIGNING_KEY_FILE;
    if (!path) throw new ProbeError(503, "A separate building-probe job signing key is required.");
    return signer ??= JobSigner.fromFile(path);
  },
  authenticate: requireAuth, view: requireNetworkAdmin, manage: requireCIO,
  publicOrigin: () => process.env.BUILDING_PROBE_PUBLIC_ORIGIN || "https://app-server2.centralus.cloudapp.azure.com",
});
export default router;
