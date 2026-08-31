import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Router, type IRouter, type Request } from "express";
import { sendReportEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const reportRecipient = "itech@sccc.edu";
const eupAlertRecipients = [reportRecipient, "mark.bojeun@sccc.edu"];
const subjectPrefix = "SCCC Student Access - Hourly Password Reset Log - ";
const studentNotificationSubject =
  "SCCC password changed through OnlineKiosk";
const eupAlertSubjectPrefix = "SCCC EUP Alert - ";
const eupRecoverySubjectPrefix = "SCCC EUP Recovery - ";
let onlineKioskActivityWriteQueue: Promise<void> = Promise.resolve();

function isLoopback(req: Request): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isOnlineKioskVm(req: Request): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "10.0.0.45" || address === "::ffff:10.0.0.45";
}

function isCloudSyncVm(req: Request): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "10.0.0.15" || address === "::ffff:10.0.0.15";
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function persistOnlineKioskActivity(row: Record<string, unknown>): Promise<void> {
  const activityPath = process.env.ONLINE_KIOSK_ACTIVITY_PATH
    || "/home/scccadmin/apps/Network-Insight-Hub/data/online-kiosk-password-reset-audit.jsonl";
  const eventId = String(row.EventId ?? "");
  const write = onlineKioskActivityWriteQueue.then(async () => {
    await mkdir(dirname(activityPath), { recursive: true, mode: 0o700 });
    let existing = "";
    try {
      existing = await readFile(activityPath, "utf8");
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    const duplicate = existing
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => {
        try {
          return String(JSON.parse(line)?.EventId ?? "") === eventId;
        } catch {
          return false;
        }
      });
    if (!duplicate) {
      await appendFile(activityPath, `${JSON.stringify(row)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    }
  });
  onlineKioskActivityWriteQueue = write.catch(() => undefined);
  await write;
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

router.post("/eup-alert", async (req, res) => {
  const host = req.header("Host") ?? "";
  if (!isLoopback(req) || req.header("X-Forwarded-For") || !/^127\.0\.0\.1(?::8080)?$/.test(host)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const timestampText = String(req.header("X-SCCC-EUP-Timestamp") ?? "");
  const signatureText = String(req.header("X-SCCC-EUP-Signature") ?? "").toLowerCase();
  const timestamp = Number(timestampText);
  const alertId = typeof req.body?.alertId === "string" ? req.body.alertId.trim().toLowerCase() : "";
  const severity = typeof req.body?.severity === "string" ? req.body.severity.trim().toLowerCase() : "";
  const subject = typeof req.body?.subject === "string" ? req.body.subject : "";
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  const html = typeof req.body?.html === "string" ? req.body.html : "";
  if (
    !Number.isSafeInteger(timestamp)
    || Math.abs(Date.now() / 1000 - timestamp) > 300
    || !/^[0-9a-f]{64}$/.test(signatureText)
    || !/^[a-z0-9][a-z0-9:._-]{2,127}$/.test(alertId)
    || !/^(warning|critical|recovery|test)$/.test(severity)
    || (!(subject.startsWith(eupAlertSubjectPrefix) || subject.startsWith(eupRecoverySubjectPrefix)))
    || subject.length > 180
    || text.length === 0
    || text.length > 32_768
    || html.length === 0
    || html.length > 65_536
  ) {
    res.status(400).json({ error: "Invalid EUP alert payload" });
    return;
  }

  try {
    const keyPath = process.env.EUP_MONITOR_KEY_PATH || "/etc/sccc-eup/monitor.key";
    const key = await readFile(keyPath);
    if (key.length < 32) throw new Error("EUP_MONITOR_KEY_INVALID");
    const signedContent = `${timestampText}\n${alertId}\n${severity}\n${subject}\n${sha256(html)}`;
    const expected = createHmac("sha256", key).update(signedContent).digest();
    const supplied = Buffer.from(signatureText, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).json({ error: "Invalid EUP alert authentication" });
      return;
    }

    await sendReportEmail({ to: eupAlertRecipients, subject, text, html });
    logger.info({ alertId, severity, recipients: eupAlertRecipients }, "Sent EUP provisioning alert");
    res.json({ sent: true, alertId, recipients: eupAlertRecipients });
  } catch (error) {
    logger.error({ err: error, alertId, severity }, "Failed to send EUP provisioning alert");
    res.status(502).json({ error: "Mail delivery failed" });
  }
});

router.get("/eup-accepted-manifest", async (req, res) => {
  const host = req.header("Host") ?? "";
  if (!isCloudSyncVm(req) || req.header("X-Forwarded-For") || !/^10\.0\.0\.44(?::8080)?$/.test(host)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const timestampText = String(req.header("X-SCCC-EUP-Timestamp") ?? "");
  const signatureText = String(req.header("X-SCCC-EUP-Signature") ?? "").toLowerCase();
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !/^[0-9a-f]{64}$/.test(signatureText)) {
    res.status(401).json({ error: "Invalid accepted-manifest authentication" });
    return;
  }
  try {
    const keyPath = process.env.EUP_MONITOR_KEY_PATH || "/etc/sccc-eup/monitor.key";
    const key = await readFile(keyPath);
    if (key.length < 32) throw new Error("EUP_MONITOR_KEY_INVALID");
    const expected = createHmac("sha256", key).update(`${timestampText}\naccepted-manifest`).digest();
    const supplied = Buffer.from(signatureText, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).json({ error: "Invalid accepted-manifest authentication" });
      return;
    }
    const monitorPath = process.env.EUP_ACCEPTED_MONITOR_PATH || "/var/lib/sccc-eup/accepted-student-monitor.json";
    const monitor = JSON.parse(await readFile(monitorPath, "utf8"));
    const bannerVerificationPath = process.env.EUP_BANNER_VERIFICATION_PATH
      || "/var/lib/sccc-eup/banner-person-verification.json";
    const bannerVerification = await readFile(bannerVerificationPath, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => ({ Accounts: [] }));
    const verifiedLogins = new Map<string, { login: string; personId: string; udcIdentifier: string; checkedUtc: number }>();
    const loginOwners = new Map<string, string>();
    const ambiguousBannerIds = new Set<string>();
    for (const row of Array.isArray(bannerVerification?.Accounts) ? bannerVerification.Accounts : []) {
      const bannerId = String(row?.BannerId ?? "").trim();
      const login = String(row?.BannerUserName ?? "").trim().toLowerCase();
      const personId = String(row?.PersonId ?? "").trim().toLowerCase();
      const expectedUdcIdentifier = String(row?.ExpectedUdcIdentifier ?? "").trim().toUpperCase();
      const profileUdcIdentifier = String(row?.ProfileUdcIdentifier ?? "").trim().toUpperCase();
      const checkedUtc = Date.parse(String(row?.CheckedUtc ?? ""));
      const userNameVerified = row?.UserNameVerified === true
        && row?.IdentityLinkVerified === true;
      if (!/^800[0-9]{6}$/.test(bannerId)
        || !/^[a-z0-9][a-z0-9._-]{0,29}$/i.test(login)
        || !personId
        || !expectedUdcIdentifier
        || expectedUdcIdentifier !== profileUdcIdentifier
        || !Number.isFinite(checkedUtc)
        || Math.abs(Date.now() - checkedUtc) > 15 * 60 * 1000
        || !userNameVerified) continue;
      const existing = verifiedLogins.get(bannerId);
      if (existing && (existing.login !== login || existing.personId !== personId || existing.udcIdentifier !== expectedUdcIdentifier)) {
        ambiguousBannerIds.add(bannerId);
        verifiedLogins.delete(bannerId);
        continue;
      }
      const priorOwner = loginOwners.get(login);
      if (priorOwner && priorOwner !== bannerId) {
        ambiguousBannerIds.add(priorOwner);
        ambiguousBannerIds.add(bannerId);
        verifiedLogins.delete(priorOwner);
        verifiedLogins.delete(bannerId);
        continue;
      }
      if (!ambiguousBannerIds.has(bannerId)) {
        loginOwners.set(login, bannerId);
        verifiedLogins.set(bannerId, { login, personId, udcIdentifier: expectedUdcIdentifier, checkedUtc });
      }
    }
    const students = (Array.isArray(monitor?.Students) ? monitor.Students : [])
      .filter((value: any) =>
        /^800[0-9]{6}$/.test(String(value?.BannerId ?? ""))
        && String(value?.UdcIdentifier ?? "").length > 0
        && /^[a-z0-9][a-z0-9._-]{1,63}@sccc\.edu$/i.test(String(value?.EntraUpn ?? ""))
        && /^[a-z0-9][a-z0-9._-]{1,63}@g\.sccc\.edu$/i.test(String(value?.CollegeEmail ?? ""))
        && String(value?.Status ?? "") !== "excluded_staff_identity")
      .map((value: any) => {
        const verified = verifiedLogins.get(String(value?.BannerId ?? ""));
        const monitorPersonId = String(value?.PersonId ?? "").trim().toLowerCase();
        const monitorUdcIdentifier = String(value?.UdcIdentifier ?? "").trim().toUpperCase();
        const identityMatches = verified
          && verified.personId === monitorPersonId
          && verified.udcIdentifier === monitorUdcIdentifier;
        return {
          ...value,
          CanvasLogin: identityMatches ? verified.login : null,
        };
      })
      .sort((left: any, right: any) => String(right.DecidedOnUtc ?? "").localeCompare(String(left.DecidedOnUtc ?? "")));
    res.json({ generatedUtc: monitor.GeneratedUtc, students });
  } catch (error) {
    logger.error({ err: error }, "Failed to provide EUP accepted-student manifest");
    res.status(503).json({ error: "Accepted-student manifest unavailable" });
  }
});

router.post("/eup-cloud-sync-heartbeat", async (req, res) => {
  const host = req.header("Host") ?? "";
  if (!isCloudSyncVm(req) || req.header("X-Forwarded-For") || !/^10\.0\.0\.44(?::8080)?$/.test(host)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const timestampText = String(req.header("X-SCCC-EUP-Timestamp") ?? "");
  const signatureText = String(req.header("X-SCCC-EUP-Signature") ?? "").toLowerCase();
  const timestamp = Number(timestampText);
  const computerName = typeof req.body?.computerName === "string" ? req.body.computerName.trim() : "";
  const utc = typeof req.body?.utc === "string" ? req.body.utc.trim() : "";
  const serviceStatus = typeof req.body?.serviceStatus === "string" ? req.body.serviceStatus.trim() : "";
  const serviceStartType = typeof req.body?.serviceStartType === "string" ? req.body.serviceStartType.trim() : "";
  const traceUtc = typeof req.body?.traceUtc === "string" ? req.body.traceUtc.trim() : "";
  const agentVersion = typeof req.body?.agentVersion === "string" ? req.body.agentVersion.trim() : "";
  const serviceBusConnections = Number(req.body?.serviceBusConnections);
  const observedUtc = Date.parse(utc);
  const observedTraceUtc = Date.parse(traceUtc);
  if (
    !Number.isSafeInteger(timestamp)
    || Math.abs(Date.now() / 1000 - timestamp) > 300
    || !/^[0-9a-f]{64}$/.test(signatureText)
    || computerName !== "ENTRACLOUDCON"
    || !Number.isFinite(observedUtc)
    || Math.abs(Date.now() - observedUtc) > 5 * 60_000
    || !Number.isFinite(observedTraceUtc)
    || serviceStatus.length > 32
    || serviceStartType.length > 32
    || agentVersion.length > 64
    || !Number.isSafeInteger(serviceBusConnections)
    || serviceBusConnections < 0
    || serviceBusConnections > 64
  ) {
    res.status(400).json({ error: "Invalid Cloud Sync heartbeat payload" });
    return;
  }

  try {
    const keyPath = process.env.EUP_MONITOR_KEY_PATH || "/etc/sccc-eup/monitor.key";
    const key = await readFile(keyPath);
    if (key.length < 32) throw new Error("EUP_MONITOR_KEY_INVALID");
    const signedContent = `${timestampText}\n${computerName}\n${utc}\n${serviceStatus}\n${traceUtc}\n${serviceBusConnections}`;
    const expected = createHmac("sha256", key).update(signedContent).digest();
    const supplied = Buffer.from(signatureText, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).json({ error: "Invalid Cloud Sync heartbeat authentication" });
      return;
    }

    const heartbeatPath = process.env.EUP_CLOUD_SYNC_HEARTBEAT_PATH
      || "/var/lib/sccc-eup/cloud-sync-heartbeat.json";
    const temporaryPath = `${heartbeatPath}.tmp`;
    const payload = {
      receivedUtc: new Date().toISOString(),
      computerName,
      observedUtc: new Date(observedUtc).toISOString(),
      serviceStatus,
      serviceStartType,
      traceUtc: new Date(observedTraceUtc).toISOString(),
      traceAgeSeconds: Math.max(0, Math.round((Date.now() - observedTraceUtc) / 1000)),
      agentVersion,
      serviceBusConnections,
    };
    await mkdir(dirname(heartbeatPath), { recursive: true, mode: 0o750 });
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o640 });
    await rename(temporaryPath, heartbeatPath);
    res.json({ recorded: true, receivedUtc: payload.receivedUtc });
  } catch (error) {
    logger.error({ err: error }, "Failed to record EUP Cloud Sync heartbeat");
    res.status(500).json({ error: "Heartbeat persistence failed" });
  }
});

router.post("/eup-ad-snapshot", async (req, res) => {
  const host = req.header("Host") ?? "";
  if (!isCloudSyncVm(req) || req.header("X-Forwarded-For") || !/^10\.0\.0\.44(?::8080)?$/.test(host)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const timestampText = String(req.header("X-SCCC-EUP-Timestamp") ?? "");
  const signatureText = String(req.header("X-SCCC-EUP-Signature") ?? "").toLowerCase();
  const timestamp = Number(timestampText);
  const snapshotSha256 = typeof req.body?.snapshotSha256 === "string" ? req.body.snapshotSha256.toLowerCase() : "";
  const snapshotBase64 = typeof req.body?.snapshotBase64 === "string" ? req.body.snapshotBase64 : "";
  if (
    !Number.isSafeInteger(timestamp)
    || Math.abs(Date.now() / 1000 - timestamp) > 300
    || !/^[0-9a-f]{64}$/.test(signatureText)
    || !/^[0-9a-f]{64}$/.test(snapshotSha256)
    || snapshotBase64.length === 0
    || snapshotBase64.length > 8_000_000
  ) {
    res.status(400).json({ error: "Invalid AD snapshot envelope" });
    return;
  }

  try {
    const keyPath = process.env.EUP_MONITOR_KEY_PATH || "/etc/sccc-eup/monitor.key";
    const key = await readFile(keyPath);
    if (key.length < 32) throw new Error("EUP_MONITOR_KEY_INVALID");
    const signedContent = `${timestampText}\n${snapshotSha256}`;
    const expected = createHmac("sha256", key).update(signedContent).digest();
    const supplied = Buffer.from(signatureText, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).json({ error: "Invalid AD snapshot authentication" });
      return;
    }

    const snapshotBytes = Buffer.from(snapshotBase64, "base64");
    if (snapshotBytes.length === 0 || snapshotBytes.length > 6_000_000 || sha256(snapshotBytes) !== snapshotSha256) {
      res.status(400).json({ error: "Invalid AD snapshot content hash" });
      return;
    }
    const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
    const generatedUtc = Date.parse(String(snapshot?.GeneratedUtc ?? ""));
    const accounts = Array.isArray(snapshot?.Accounts) ? snapshot.Accounts : [];
    if (
      !Number.isFinite(generatedUtc)
      || Math.abs(Date.now() - generatedUtc) > 10 * 60_000
      || !Number.isInteger(snapshot?.Total)
      || snapshot.Total !== accounts.length
      || accounts.length > 10_000
      || accounts.some((account: any) =>
        !/^800[0-9]{6}$/.test(String(account?.BannerId ?? ""))
        || !String(account?.UserPrincipalName ?? "").toLowerCase().endsWith("@sccc.edu")
        || !String(account?.DistinguishedName ?? "").toLowerCase().includes(",ou=studentpopulation,ou=people,dc=sccc,dc=edu"))
    ) {
      res.status(400).json({ error: "AD snapshot failed schema validation" });
      return;
    }

    const snapshotPath = process.env.EUP_AD_SNAPSHOT_PATH || "/var/lib/sccc-eup/ad-cohort-reconciliation.json";
    const temporaryPath = `${snapshotPath}.tmp`;
    await mkdir(dirname(snapshotPath), { recursive: true, mode: 0o750 });
    await writeFile(temporaryPath, snapshotBytes, { mode: 0o640 });
    await rename(temporaryPath, snapshotPath);
    logger.info({ total: accounts.length, needReview: snapshot.NeedReview }, "Stored EUP AD verification snapshot");
    res.json({ stored: true, total: accounts.length, generatedUtc: new Date(generatedUtc).toISOString() });
  } catch (error) {
    logger.error({ err: error }, "Failed to store EUP AD verification snapshot");
    res.status(500).json({ error: "AD snapshot persistence failed" });
  }
});

router.post("/student-password-reset-notification", async (req, res) => {
  const host = req.header("Host") ?? "";
  const localCaller = isLoopback(req) && /^127\.0\.0\.1(?::8080)?$/.test(host);
  const onlineKioskCaller = isOnlineKioskVm(req) && /^10\.0\.0\.44(?::8080)?$/.test(host);
  if ((!localCaller && !onlineKioskCaller) || req.header("X-Forwarded-For")) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const timestampText = String(req.header("X-SCCC-Report-Timestamp") ?? "");
  const signatureText = String(req.header("X-SCCC-Report-Signature") ?? "").toLowerCase();
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !/^[0-9a-f]{64}$/.test(signatureText)) {
    res.status(401).json({ error: "Invalid notification authentication" });
    return;
  }

  const recipient = typeof req.body?.recipient === "string"
    ? req.body.recipient.trim().toLowerCase()
    : "";
  const subject = typeof req.body?.subject === "string" ? req.body.subject : "";
  const html = typeof req.body?.html === "string" ? req.body.html : "";
  if (
    !/^[a-z0-9][a-z0-9._-]{0,63}@g\.sccc\.edu$/.test(recipient)
    || subject !== studentNotificationSubject
    || html.length === 0
    || html.length > 32_768
  ) {
    res.status(400).json({ error: "Invalid notification payload" });
    return;
  }

  try {
    const keyPath = process.env.KIOSK_REPORT_KEY_PATH || "/var/lib/sccc-mfa/kiosk-device.key";
    const key = await readFile(keyPath);
    if (key.length < 32) throw new Error("KIOSK_REPORT_KEY_INVALID");
    const signedContent = `${timestampText}\n${recipient}\n${subject}\n${sha256(html)}`;
    const expected = createHmac("sha256", key).update(signedContent).digest();
    const supplied = Buffer.from(signatureText, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).json({ error: "Invalid notification authentication" });
      return;
    }

    await sendReportEmail({
      to: [recipient],
      subject,
      text:
        "Your SCCC account password was changed through OnlineKiosk. "
        + "No password or Temporary Access Pass is included. If you did not make this change, "
        + "contact SCCC IT immediately at itech@sccc.edu or (620) 417-1200.",
      html,
    });
    logger.info({ recipient }, "Sent OnlineKiosk password-reset notification");
    res.json({ sent: true });
  } catch (error) {
    logger.error({ err: error, recipient }, "Failed to send OnlineKiosk password-reset notification");
    res.status(502).json({ error: "Mail delivery failed" });
  }
});

router.post("/online-kiosk-reset-activity", async (req, res) => {
  const host = req.header("Host") ?? "";
  const localCaller = isLoopback(req) && /^127\.0\.0\.1(?::8080)?$/.test(host);
  const onlineKioskCaller = isOnlineKioskVm(req) && /^10\.0\.0\.44(?::8080)?$/.test(host);
  if ((!localCaller && !onlineKioskCaller) || req.header("X-Forwarded-For")) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const timestampText = String(req.header("X-SCCC-Report-Timestamp") ?? "");
  const signatureText = String(req.header("X-SCCC-Report-Signature") ?? "").toLowerCase();
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !/^[0-9a-f]{64}$/.test(signatureText)) {
    res.status(401).json({ error: "Invalid activity authentication" });
    return;
  }

  const eventId = typeof req.body?.eventId === "string" ? req.body.eventId.trim().toLowerCase() : "";
  const utc = typeof req.body?.utc === "string" ? req.body.utc.trim() : "";
  const account = typeof req.body?.account === "string" ? req.body.account.trim().toLowerCase() : "";
  const sourceIp = typeof req.body?.sourceIp === "string" ? req.body.sourceIp.trim() : "";
  const occurred = Date.parse(utc);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(eventId)
    || !Number.isFinite(occurred)
    || occurred > Date.now() + 5 * 60_000
    || occurred < Date.now() - 35 * 24 * 60 * 60_000
    || !/^[a-z0-9][a-z0-9._-]{0,63}@sccc\.edu$/.test(account)
    || sourceIp.length < 3
    || sourceIp.length > 64
    || !/^[0-9a-f:.]+$/i.test(sourceIp)
  ) {
    res.status(400).json({ error: "Invalid activity payload" });
    return;
  }

  try {
    const keyPath = process.env.KIOSK_REPORT_KEY_PATH || "/var/lib/sccc-mfa/kiosk-device.key";
    const key = await readFile(keyPath);
    if (key.length < 32) throw new Error("KIOSK_REPORT_KEY_INVALID");
    const signedContent = `${timestampText}\n${eventId}\n${utc}\n${account}\n${sourceIp}`;
    const expected = createHmac("sha256", key).update(signedContent).digest();
    const supplied = Buffer.from(signatureText, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).json({ error: "Invalid activity authentication" });
      return;
    }

    await persistOnlineKioskActivity({
      Utc: new Date(occurred).toISOString(),
      Type: "online-kiosk-password-reset",
      Result: "success",
      Actor: "online-kiosk:self-service",
      Target: account,
      Ip: sourceIp,
      School: null,
      Reason: "Student-selected password changed through internal OnlineKiosk",
      CorrelationId: null,
      EventId: eventId,
    });
    logger.info({ eventId }, "Recorded OnlineKiosk password reset activity");
    res.json({ recorded: true, eventId });
  } catch (error) {
    logger.error({ err: error, eventId }, "Failed to record OnlineKiosk password reset activity");
    res.status(502).json({ error: "Activity recording failed" });
  }
});

export default router;
