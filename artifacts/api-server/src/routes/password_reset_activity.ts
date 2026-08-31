import { readFile } from "node:fs/promises";
import { Router, type IRouter } from "express";
import { requireAuth } from "./auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const DEFAULT_HOURS = 7 * 24;
const MAX_HOURS = 30 * 24;
const MAX_ROWS = 1_000;

type AuditEntry = {
  Utc?: unknown;
  Type?: unknown;
  Result?: unknown;
  Actor?: unknown;
  Target?: unknown;
  Ip?: unknown;
  Reason?: unknown;
  CorrelationId?: unknown;
};

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseHours(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_HOURS;
  return Math.min(MAX_HOURS, Math.max(1, Math.floor(parsed)));
}

function requiresItAssistance(detail: string): boolean {
  return detail.toLowerCase().includes("insufficient privileges to complete the operation");
}

router.get("/", requireAuth, async (req, res) => {
  const hours = parseHours(req.query.hours);
  const generated = new Date();
  const since = new Date(generated.getTime() - hours * 60 * 60 * 1_000);
  const auditPath = process.env.KIOSK_AUDIT_PATH || "/var/lib/sccc-mfa/audit.jsonl";
  const onlineKioskAuditPath = process.env.ONLINE_KIOSK_ACTIVITY_PATH
    || "/home/scccadmin/apps/Network-Insight-Hub/data/online-kiosk-password-reset-audit.jsonl";

  try {
    const readAudit = async (path: string): Promise<string> => {
      try {
        return await readFile(path, "utf8");
      } catch (error: any) {
        if (error?.code === "ENOENT") return "";
        throw error;
      }
    };
    const contents = [await readAudit(auditPath), await readAudit(onlineKioskAuditPath)]
      .filter(Boolean)
      .join("\n");

    const rows = contents
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AuditEntry];
        } catch {
          return [];
        }
      })
      .filter((entry) => entry.Type === "kiosk-password-reset" || entry.Type === "online-kiosk-password-reset")
      .map((entry) => {
        const utc = asText(entry.Utc);
        const time = Date.parse(utc);
        const originalDetail = asText(entry.Reason);
        const assisted = requiresItAssistance(originalDetail);
        return {
          utc,
          time,
          account: asText(entry.Target, "Unknown account"),
          outcome: assisted ? "assisted" : asText(entry.Result, "unknown").toLowerCase(),
          kiosk: entry.Type === "online-kiosk-password-reset"
            ? "OnlineKiosk"
            : asText(entry.Actor, "Unknown kiosk").replace(/^kiosk-device:/, "Kiosk "),
          sourceIp: asText(entry.Ip, "Unknown"),
          detail: assisted ? "IT-assisted recovery required" : originalDetail,
          requestId: assisted ? "" : asText(entry.CorrelationId),
        };
      })
      .filter((row) => Number.isFinite(row.time) && row.time >= since.getTime())
      .sort((a, b) => b.time - a.time)
      .slice(0, MAX_ROWS)
      .map(({ time: _time, ...row }) => row);

    const successful = rows.filter((row) => row.outcome === "success").length;
    const failed = rows.filter((row) => row.outcome === "failed").length;
    const denied = rows.filter((row) => row.outcome === "denied").length;
    const assisted = rows.filter((row) => row.outcome === "assisted").length;

    res.json({
      generatedUtc: generated.toISOString(),
      sinceUtc: since.toISOString(),
      hours,
      summary: {
        total: rows.length,
        successful,
        failed,
        denied,
        assisted,
      },
      rows,
    });
  } catch (error) {
    logger.error({ err: error }, "Unable to read password reset activity");
    res.status(500).json({ error: "Password reset activity is temporarily unavailable" });
  }
});

export default router;
