import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Router, type IRouter, type Request } from "express";
import { sendReportEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const reportRecipient = "Itech@sccc.edu";
const subjectPrefix = "SCCC Student Access - Hourly Password Reset Log - ";

function isLoopback(req: Request): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

router.post("/password-reset-report", async (req, res) => {
  const host = req.header("Host") ?? "";
  if (!isLoopback(req) || req.header("X-Forwarded-For") || !/^127\.0\.0\.1(?::8080)?$/.test(host)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const timestampText = String(req.header("X-SCCC-Report-Timestamp") ?? "");
  const signatureText = String(req.header("X-SCCC-Report-Signature") ?? "").toLowerCase();
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !/^[0-9a-f]{64}$/.test(signatureText)) {
    res.status(401).json({ error: "Invalid report authentication" });
    return;
  }

  const subject = typeof req.body?.subject === "string" ? req.body.subject : "";
  const html = typeof req.body?.html === "string" ? req.body.html : "";
  const csvFileName = typeof req.body?.csvFileName === "string" ? req.body.csvFileName : "";
  const csvBase64 = typeof req.body?.csvBase64 === "string" ? req.body.csvBase64 : "";
  if (!subject.startsWith(subjectPrefix) || subject.length > 180 || html.length === 0 || html.length > 262_144 || !/^sccc-password-reset-log-[0-9]{8}-[0-9]{4}\.csv$/.test(csvFileName)) {
    res.status(400).json({ error: "Invalid report payload" });
    return;
  }

  let csv: Buffer;
  try {
    csv = Buffer.from(csvBase64, "base64");
  } catch {
    res.status(400).json({ error: "Invalid report attachment" });
    return;
  }
  if (csv.length === 0 || csv.length > 524_288) {
    res.status(400).json({ error: "Invalid report attachment" });
    return;
  }

  try {
    const keyPath = process.env.KIOSK_REPORT_KEY_PATH || "/var/lib/sccc-mfa/kiosk-device.key";
    const key = await readFile(keyPath);
    if (key.length < 32) throw new Error("KIOSK_REPORT_KEY_INVALID");
    const signedContent = `${timestampText}\n${subject}\n${sha256(html)}\n${sha256(csv)}`;
    const expected = createHmac("sha256", key).update(signedContent).digest();
    const supplied = Buffer.from(signatureText, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).json({ error: "Invalid report authentication" });
      return;
    }

    await sendReportEmail({
      to: [reportRecipient],
      subject,
      text: "SCCC Student Access hourly password-reset activity is included in the attached CSV. Passwords and Temporary Access Pass values are never included.",
      html,
      attachments: [{ filename: csvFileName, content: csv, contentType: "text/csv" }],
    });
    logger.info({ recipient: reportRecipient, csvBytes: csv.length }, "Sent kiosk password reset report");
    res.json({ sent: true });
  } catch (error) {
    logger.error({ err: error }, "Failed to send kiosk password reset report");
    res.status(502).json({ error: "Mail delivery failed" });
  }
});

export default router;
