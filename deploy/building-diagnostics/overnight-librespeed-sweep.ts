import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { pool } from "@workspace/db";
import { libreSpeedConfig } from "../../artifacts/api-server/src/lib/building_diagnostics";
import { diagnosticsBuildingName } from "../../artifacts/api-server/src/lib/building_diagnostics_catalog";
import { diagnosticsStore } from "../../artifacts/api-server/src/lib/building_diagnostics_store";

type Args = {
  campaign: string;
  cutoff: Date;
  reportDir: string;
  intervalSeconds: number;
  pendingTarget: number;
  once: boolean;
  dryRun: boolean;
};

type SpeedMeasurement = {
  adapterKind?: string;
  downloadMbps?: number;
  uploadMbps?: number;
  pingMs?: number;
  jitterMs?: number;
  transferClosed?: boolean;
};

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseArgs(): Args {
  const cutoff = new Date(arg("--cutoff") ?? "");
  if (!Number.isFinite(cutoff.getTime())) throw new Error("--cutoff must be an ISO timestamp");
  const campaign = arg("--campaign")?.trim();
  if (!campaign) throw new Error("--campaign is required");
  const reportDir = arg("--report-dir")?.trim();
  if (!reportDir) throw new Error("--report-dir is required");
  const intervalSeconds = Number(arg("--interval-seconds") ?? "60");
  const pendingTarget = Number(arg("--pending-target") ?? "12");
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 30 || intervalSeconds > 600) throw new Error("invalid --interval-seconds");
  if (!Number.isInteger(pendingTarget) || pendingTarget < 1 || pendingTarget > 40) throw new Error("invalid --pending-target");
  return { campaign, cutoff, reportDir, intervalSeconds, pendingTarget, once: process.argv.includes("--once"), dryRun: process.argv.includes("--dry-run") };
}

function ready(device: any) {
  return !!device.deviceId && device.adEnabled === true && device.enrolled && !device.revoked && device.online && device.adVerified && device.capabilities?.includes("librespeed-v2");
}

function average(values: number[]) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;
}

function localStamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date).replace(/, /, "T").replace(/[/:]/g, "-");
}

function csv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reportingBuilding(value: unknown) {
  return diagnosticsBuildingName(typeof value === "string" ? value : null) ?? "Unassigned";
}

async function campaignJobs(campaign: string) {
  const { rows } = await pool.query(`
    SELECT j.id,j.device_id,j.building,j.status,j.created_at,j.claimed_at,j.expires_at,
      d.computer_name,r.recorded_at,r.data
    FROM building_diagnostics_jobs j
    JOIN building_diagnostics_devices d ON d.id=j.device_id
    LEFT JOIN building_diagnostics_reports r ON r.job_id=j.id
    WHERE j.requested_by=$1
    ORDER BY j.created_at`, [campaign]);
  return rows;
}

function summarizeMeasurements(rows: any[]) {
  const interfaces: Array<SpeedMeasurement & { building: string; computerName: string }> = [];
  let reportErrors = 0;
  for (const row of rows) {
    const data = row.data ?? {};
    const measurements = Array.isArray(data?.libreSpeed?.measurements) ? data.libreSpeed.measurements : [];
    if (data.error || (row.status === "complete" && measurements.length === 0)) reportErrors++;
    for (const measurement of measurements) {
      interfaces.push({ ...measurement, building: reportingBuilding(row.building), computerName: row.computer_name });
    }
  }
  const valid = interfaces.filter(item => item.transferClosed === true && Number.isFinite(item.downloadMbps) && Number.isFinite(item.uploadMbps));
  const byBuilding = new Map<string, typeof valid>();
  for (const item of valid) byBuilding.set(item.building, [...(byBuilding.get(item.building) ?? []), item]);
  return {
    reportErrors,
    interfaceMeasurements: interfaces.length,
    validatedInterfaceMeasurements: valid.length,
    ethernetMeasurements: valid.filter(item => item.adapterKind === "ethernet").length,
    wifiMeasurements: valid.filter(item => item.adapterKind === "wifi").length,
    averageDownloadMbps: average(valid.map(item => Number(item.downloadMbps))),
    averageUploadMbps: average(valid.map(item => Number(item.uploadMbps))),
    averageLatencyMs: average(valid.map(item => Number(item.pingMs)).filter(Number.isFinite)),
    averageJitterMs: average(valid.map(item => Number(item.jitterMs)).filter(Number.isFinite)),
    buildings: [...byBuilding.entries()].map(([building, items]) => ({
      building,
      computers: new Set(items.map(item => item.computerName)).size,
      interfaces: items.length,
      ethernet: items.filter(item => item.adapterKind === "ethernet").length,
      wifi: items.filter(item => item.adapterKind === "wifi").length,
      averageDownloadMbps: average(items.map(item => Number(item.downloadMbps))),
      averageUploadMbps: average(items.map(item => Number(item.uploadMbps))),
      averageLatencyMs: average(items.map(item => Number(item.pingMs)).filter(Number.isFinite)),
    })).sort((a, b) => a.building.localeCompare(b.building)),
  };
}

async function writeReport(args: Args, final = false) {
  const overview = await diagnosticsStore.overview();
  const rows = await campaignJobs(args.campaign);
  const currentReady = overview.devices.filter(ready);
  const targeted = new Set(rows.map(row => String(row.device_id)));
  const status = Object.fromEntries(["queued", "running", "complete", "expired", "cancelled"].map(name => [name, rows.filter(row => row.status === name).length]));
  const metrics = summarizeMeasurements(rows);
  const report = {
    campaign: args.campaign,
    generatedAt: new Date().toISOString(),
    generatedAtCentral: new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "full", timeStyle: "long" }).format(new Date()),
    cutoff: args.cutoff.toISOString(),
    final,
    fleet: {
      adEnabled: overview.devices.filter((device: any) => device.adEnabled === true).length,
      enrolledActive: overview.devices.filter((device: any) => device.enrolled && !device.revoked).length,
      readyNow: currentReady.length,
      targetedUniqueComputers: targeted.size,
      completedUniqueComputers: new Set(rows.filter(row => row.status === "complete").map(row => String(row.device_id))).size,
      readyButNotYetTargeted: currentReady.filter((device: any) => !targeted.has(device.deviceId)).length,
    },
    jobs: { total: rows.length, ...status },
    performance: metrics,
  };
  const computerRows = rows.map(row => {
    const measurements: SpeedMeasurement[] = Array.isArray(row.data?.libreSpeed?.measurements) ? row.data.libreSpeed.measurements : [];
    const valid = measurements.filter(item => item.transferClosed === true && Number.isFinite(item.downloadMbps) && Number.isFinite(item.uploadMbps));
    return {
      computer: row.computer_name,
      building: reportingBuilding(row.building),
      status: row.status,
      recordedAt: row.recorded_at ? new Date(row.recorded_at).toISOString() : "",
      interfaces: valid.length,
      ethernet: valid.filter(item => item.adapterKind === "ethernet").length,
      wifi: valid.filter(item => item.adapterKind === "wifi").length,
      averageDownloadMbps: average(valid.map(item => Number(item.downloadMbps))),
      averageUploadMbps: average(valid.map(item => Number(item.uploadMbps))),
      averageLatencyMs: average(valid.map(item => Number(item.pingMs)).filter(Number.isFinite)),
      error: row.data?.error ?? "",
    };
  });
  const csvBody = [
    "computer,building,status,recorded_at,interfaces,ethernet,wifi,average_download_mbps,average_upload_mbps,average_latency_ms,error",
    ...computerRows.map(row => [row.computer, row.building, row.status, row.recordedAt, row.interfaces, row.ethernet, row.wifi, row.averageDownloadMbps, row.averageUploadMbps, row.averageLatencyMs, row.error].map(csv).join(",")),
    "",
  ].join("\n");
  await mkdir(args.reportDir, { recursive: true });
  const name = `${final ? "final" : "hourly"}-${localStamp()}`;
  const body = `${JSON.stringify(report, null, 2)}\n`;
  await Promise.all([
    writeFile(path.join(args.reportDir, `${name}.json`), body),
    writeFile(path.join(args.reportDir, `${name}.csv`), csvBody),
    writeFile(path.join(args.reportDir, "latest.json"), body),
    writeFile(path.join(args.reportDir, "latest-computers.csv"), csvBody),
    writeFile(path.join(args.reportDir, "latest-summary.txt"), [
      `${report.generatedAtCentral}`,
      `Ready now: ${report.fleet.readyNow}; targeted: ${report.fleet.targetedUniqueComputers}; complete: ${report.fleet.completedUniqueComputers}`,
      `Jobs queued/running/complete/expired/cancelled: ${status.queued}/${status.running}/${status.complete}/${status.expired}/${status.cancelled}`,
      `Validated interfaces: ${metrics.validatedInterfaceMeasurements} (${metrics.ethernetMeasurements} Ethernet, ${metrics.wifiMeasurements} Wi-Fi)`,
      `Average download/upload: ${metrics.averageDownloadMbps ?? "n/a"}/${metrics.averageUploadMbps ?? "n/a"} Mbps`,
      `Average latency/jitter: ${metrics.averageLatencyMs ?? "n/a"}/${metrics.averageJitterMs ?? "n/a"} ms`,
      "",
    ].join("\n")),
  ]);
  console.log(JSON.stringify({ event: "report", ...report.fleet, jobs: report.jobs, performance: { validated: metrics.validatedInterfaceMeasurements, downloadMbps: metrics.averageDownloadMbps, uploadMbps: metrics.averageUploadMbps } }));
  return report;
}

async function queueCycle(args: Args) {
  const overview = await diagnosticsStore.overview();
  const jobs = await campaignJobs(args.campaign);
  const targeted = new Set(jobs.map(row => String(row.device_id)));
  const pending = jobs.filter(row => row.status === "queued" || row.status === "running").length;
  const capacity = Math.max(0, args.pendingTarget - pending);
  const candidates = overview.devices.filter(ready).filter((device: any) => !targeted.has(device.deviceId))
    .sort((a: any, b: any) => String(a.location?.building ?? "~").localeCompare(String(b.location?.building ?? "~")) || String(a.lastTestAt ?? "").localeCompare(String(b.lastTestAt ?? "")));
  if (args.dryRun || capacity === 0 || candidates.length === 0) {
    console.log(JSON.stringify({ event: args.dryRun ? "dry-run" : "cycle", ready: overview.devices.filter(ready).length, targeted: targeted.size, pending, candidates: candidates.length, queued: 0 }));
    return 0;
  }
  let queued = 0;
  const perCycle = Math.min(capacity, libreSpeedConfig().canaryMax);
  for (const device of candidates.slice(0, perCycle)) {
    try {
      const result = await diagnosticsStore.queue({ deviceIds: [device.deviceId], type: "librespeed-v2" }, args.campaign, false);
      queued += result.queued;
    } catch (error) {
      console.warn(JSON.stringify({ event: "queue-skip", computerName: device.computerName, message: error instanceof Error ? error.message : String(error) }));
    }
  }
  console.log(JSON.stringify({ event: "cycle", ready: overview.devices.filter(ready).length, targeted: targeted.size + queued, pending: pending + queued, candidates: Math.max(0, candidates.length - queued), queued }));
  return queued;
}

async function main() {
  const args = parseArgs();
  await mkdir(args.reportDir, { recursive: true });
  if (args.cutoff.getTime() <= Date.now()) throw new Error("cutoff is already in the past");
  let reportedHour = "";
  do {
    const now = new Date();
    if (now >= args.cutoff) break;
    await queueCycle(args);
    const hour = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).format(now);
    if (hour !== reportedHour) { await writeReport(args); reportedHour = hour; }
    if (args.once || args.dryRun) break;
    await new Promise(resolve => setTimeout(resolve, args.intervalSeconds * 1000));
  } while (true);
  if (!args.dryRun) {
    await pool.query("UPDATE building_diagnostics_jobs SET status='cancelled',cancelled_reason='Overnight campaign reached its 5:00 AM cutoff' WHERE requested_by=$1 AND status='queued'", [args.campaign]);
    await writeReport(args, true);
  }
  await pool.end();
}

main().catch(async error => {
  console.error(error);
  try { await pool.end(); } catch { /* no-op */ }
  process.exitCode = 1;
});
