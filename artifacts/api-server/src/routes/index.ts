import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import entriesRouter from "./entries";
import reportsRouter from "./reports";
import risksRouter from "./risks";
import networkRouter from "./network";
import afterActionRouter from "./after_action";
import dashboardRouter from "./dashboard";
import exportRouter from "./export";
import statusReportRouter from "./status_report";
import quotesRouter from "./quotes";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/entries", entriesRouter);
router.use("/reports", reportsRouter);
router.use("/risks", risksRouter);
router.use("/network", networkRouter);
router.use("/after-action", afterActionRouter);
router.use("/dashboard", dashboardRouter);
router.use("/export", exportRouter);
router.use("/status-report", statusReportRouter);
router.use("/quotes", quotesRouter);

export default router;
