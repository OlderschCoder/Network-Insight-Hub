import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getBreakGlassStatus } from "../lib/seed_breakglass";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const breakGlass = getBreakGlassStatus().state;
  // A failed emergency-login seed degrades overall health so external monitors
  // (and the /api/healthz probe) surface it loudly instead of reporting "ok".
  const status = breakGlass === "failed" ? "degraded" : "ok";
  const data = HealthCheckResponse.parse({ status, breakGlass });
  res.status(status === "degraded" ? 503 : 200).json(data);
});

export default router;
