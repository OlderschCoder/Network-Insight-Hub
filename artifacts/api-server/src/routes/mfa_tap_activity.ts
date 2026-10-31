import { readFile } from "node:fs/promises";
import { Router, type IRouter } from "express";
import { requireAuth } from "./auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

type UsageRow = {
  date: string;
  objectId: string;
  displayName: string;
  userPrincipalName: string;
  studentId: string;
  school: string;
  count: number;
  selfServiceCount: number;
  facultyCount: number;
  lastUtc: string;
};

type UsageReport = {
  generatedUtc: string;
  policy: { dailyLimit: number; reviewThreshold: number };
  rows: UsageRow[];
};

function parseDays(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, Math.floor(parsed)));
}

router.get("/", requireAuth, async (req, res) => {
  const days = parseDays(req.query.days);
  const reportPath = process.env.MFA_TAP_USAGE_REPORT_PATH
    || "/home/scccadmin/apps/Network-Insight-Hub/data/mfa-tap-usage-report.json";

  try {
    const report = JSON.parse(await readFile(reportPath, "utf8")) as UsageReport;
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - days + 1);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    const rows = (Array.isArray(report.rows) ? report.rows : [])
      .filter((row) => row.date >= cutoffDate)
      .sort((left, right) => right.date.localeCompare(left.date) || right.count - left.count);
    const reviewThreshold = report.policy?.reviewThreshold ?? 4;
    const dailyLimit = report.policy?.dailyLimit ?? 7;
    const uniqueStudents = new Set(rows.map((row) => row.objectId)).size;

    res.json({
      generatedUtc: report.generatedUtc,
      days,
      policy: { dailyLimit, reviewThreshold },
      summary: {
        totalPasses: rows.reduce((sum, row) => sum + row.count, 0),
        uniqueStudents,
        reviewFlags: rows.filter((row) => row.count >= reviewThreshold).length,
        policyExceeded: rows.filter((row) => row.count > dailyLimit).length,
      },
      rows,
    });
  } catch (error) {
    logger.error({ err: error }, "Unable to read MFA TAP usage report");
    res.status(503).json({ error: "MFA TAP usage report is temporarily unavailable" });
  }
});

export default router;
