import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireNetworkAdmin } from "./auth";
import { DiagnosticsError } from "../lib/building_diagnostics_store";
import { buildingDiagnosticsAssignmentStore, MAX_BUILDING_ASSIGNMENTS, normalizeAssignmentIds } from "../lib/building_diagnostics_assignment";

const input = z.object({
  adObjectGuids: z.array(z.string().uuid()).min(1).max(MAX_BUILDING_ASSIGNMENTS).transform(normalizeAssignmentIds),
  building: z.string().trim().min(1).max(120).nullable(), reason: z.string().trim().min(3).max(300), apply: z.literal(true),
}).strict();
const groupInput = z.object({ groupObjectGuid: z.string().uuid(), building: z.string().trim().min(1).max(120).nullable(), reason: z.string().trim().min(3).max(300), apply: z.literal(true) }).strict();

export function createBuildingDiagnosticsAssignmentRouter(store = buildingDiagnosticsAssignmentStore) {
  const router = Router();
  router.use(["/building-assignments", "/building-group-mappings"], requireAuth, requireNetworkAdmin, (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    return process.env.BUILDING_DIAGNOSTICS_ENABLED === "true" ? next() : void res.status(503).json({ error: "Building diagnostics is not enabled" });
  });
  router.get("/building-assignments", async (_req, res) => res.json(await store.get()));
  router.post("/building-assignments", async (req: any, res) => {
    if (!z.string().uuid().safeParse(req.user?.entraObjectId).success) throw new DiagnosticsError(403, "Microsoft sign-in is required to change building assignments");
    const parsed = input.safeParse(req.body);
    if (!parsed.success) throw new DiagnosticsError(400, "Select valid AD identities, a campus building or clear, and an assignment reason");
    return res.json(await store.apply(parsed.data, { userId: req.user.id, entraObjectId: req.user.entraObjectId, name: req.user.name || req.user.email }));
  });
  router.post("/building-group-mappings", async (req: any, res) => {
    if (!z.string().uuid().safeParse(req.user?.entraObjectId).success) throw new DiagnosticsError(403, "Microsoft sign-in is required to change building assignments");
    const parsed = groupInput.safeParse(req.body);
    if (!parsed.success) throw new DiagnosticsError(400, "Select a current AD group, a campus building or clear, and a mapping reason");
    return res.json(await store.applyGroup(parsed.data, { userId: req.user.id, entraObjectId: req.user.entraObjectId, name: req.user.name || req.user.email }));
  });
  router.use((error: any, req: any, res: any, _next: any) => {
    if (!(error instanceof DiagnosticsError)) req.log?.error("Building assignment operation failed");
    return res.status(error instanceof DiagnosticsError ? error.status : 500).json({ error: error instanceof DiagnosticsError ? error.message : "Building assignment operation failed" });
  });
  return router;
}
