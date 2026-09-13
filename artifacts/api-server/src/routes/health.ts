import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getBreakGlassStatus } from "../lib/seed_breakglass";
import { getFredAlertWorkerHealth } from "../lib/fred_building_alert_worker";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const breakGlass = getBreakGlassStatus().state;
  const fredAlerts = getFredAlertWorkerHealth();
  // A failed emergency-login seed degrades overall health so external monitors
  // (and the /api/healthz probe) surface it loudly instead of reporting "ok".
  // An enabled Fred worker must complete a cycle or observe another replica's
  // active shared lease before this process is ready. Disabled alerting is an
  // intentional healthy state.
  const status =
    breakGlass === "failed" ||
    fredAlerts.state === "starting" ||
    fredAlerts.state === "degraded"
      ? "degraded"
      : "ok";
  const data = HealthCheckResponse.parse({ status, breakGlass, fredAlerts });
  res.status(status === "degraded" ? 503 : 200).json(data);
});

export default router;
