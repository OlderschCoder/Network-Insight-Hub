import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { requireAuth, requireNetworkAdmin } from "./auth";
import { secretsEqual } from "../lib/building_diagnostics";
import { DiagnosticsError } from "../lib/building_diagnostics_store";
import { diagnosticsEnrollmentStore, enrollmentReasons, MAX_ENROLLMENT_DEVICES } from "../lib/building_diagnostics_enrollment";

const uuid = z.string().uuid();
const selection = z.object({ requestId: uuid, adObjectGuids: z.array(uuid).min(1).max(MAX_ENROLLMENT_DEVICES).refine(ids => new Set(ids.map(id => id.toLowerCase())).size === ids.length) }).strict();
const claim = z.object({ requestId: uuid, adObjectGuid: uuid, claimId: uuid }).strict();
const evidence = z.object({ taskRunning: z.literal(true), taskSystem: z.literal(true), helperVersion: z.string().regex(/^[A-Za-z0-9.+-]{1,40}$/), signerThumbprint: z.string().regex(/^[A-Fa-f0-9]{40}$/), payloadSha256: z.string().regex(/^[A-Fa-f0-9]{64}$/) }).strict();
const result = claim.extend({ status: z.enum(["installed", "skipped", "unreachable", "failed"]), reason: z.enum(enrollmentReasons), evidence: evidence.optional() }).strict();
function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> { const value = schema.safeParse(input); if (!value.success) throw new DiagnosticsError(400, "Invalid bulk enrollment request"); return value.data; }

export function createDiagnosticsEnrollmentRouter(store = diagnosticsEnrollmentStore) {
  const router = Router();
  const enabled: RequestHandler = (_req, res, next) => process.env.BUILDING_DIAGNOSTICS_ENABLED === "true" ? next() : void res.status(503).json({ error: "Building diagnostics is not enabled" });
  const workerOnly: RequestHandler = (req, res, next) => {
    const expected = process.env.BUILDING_DIAGNOSTICS_WORKER_TOKEN ?? "", authorization = req.headers.authorization ?? "";
    if (expected.length < 32 || !authorization.startsWith("Bearer ") || !secretsEqual(authorization.slice(7), expected)) return void res.status(401).json({ error: "Diagnostics worker authentication required" });
    next();
  };
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  // Bulk requests require the operator's existing Fred SSO session. Worker credentials cannot originate selections.
  router.post("/devices/bulk-enrollment", requireAuth, requireNetworkAdmin, enabled, async (req: any, res) => res.status(202).json(await store.create(parse(selection, req.body), `Fred user ${req.user.id}`)));
  router.get("/devices/bulk-enrollment/:requestId", requireAuth, requireNetworkAdmin, enabled, async (req, res) => res.json(await store.get(parse(uuid, req.params.requestId))));
  router.post("/devices/bulk-enrollment/worker/claim", enabled, workerOnly, async (req, res) => res.json(await store.claim(parse(z.object({ workerId: z.string().regex(/^[A-Za-z0-9-]{1,63}$/) }).strict(), req.body).workerId)));
  router.post("/devices/bulk-enrollment/worker/provision", enabled, workerOnly, async (req, res) => res.status(201).json(await store.provision(parse(claim, req.body))));
  router.post("/devices/bulk-enrollment/worker/result", enabled, workerOnly, async (req, res) => { const input = parse(result, req.body); return res.json(await store.result(input, input.status, input.reason, input.evidence)); });
  router.use((error: any, req: any, res: any, _next: any) => {
    if (!(error instanceof DiagnosticsError)) req.log?.error("Bulk enrollment operation failed");
    return res.status(error instanceof DiagnosticsError ? error.status : 500).json({ error: error instanceof DiagnosticsError ? error.message : "Bulk enrollment operation failed" });
  });
  return router;
}
