import { pool } from "../../lib/db/src/index";
import { diagnosticsStore } from "../../artifacts/api-server/src/lib/building_diagnostics_store";
import { externalProbeConfig } from "../../artifacts/api-server/src/lib/building_diagnostics";
import { ACTOR, planTimingProbe } from "./timing-rotation.mjs";

async function run() {
  const lock = await pool.connect();
  try {
    if (!(await lock.query("SELECT pg_try_advisory_lock(921833334) AS held")).rows[0].held) return { skipped: "another timing collector is active" };
    if (process.env.BUILDING_DIAGNOSTICS_TIMING_ENABLED !== "true") return { skipped: "timing collection is disabled" };
    const overview = await diagnosticsStore.overview();
    if (!overview.settings.effectiveSchedulerEnabled) return { skipped: "diagnostics rotation is disarmed" };
    const pending = (await pool.query("SELECT id,device_id,status,requested_by FROM building_diagnostics_jobs WHERE status IN ('queued','running') AND expires_at>now() AND scheduled_at<=now()")).rows;
    const dailyJobs = Number((await pool.query("SELECT count(*) AS n FROM building_diagnostics_jobs WHERE requested_by=$1 AND created_at>now()-interval '24 hours'", [ACTOR])).rows[0].n);
    const history = (await pool.query(`SELECT j.device_id,j.building,j.type,max(j.created_at) AS last_attempt,
      max(r.recorded_at) FILTER (WHERE (j.type='fred' AND r.data->>'requestLossPercent' IS NOT NULL)
        OR (j.type='external-quick' AND r.data->'external'->>'dnsMs' IS NOT NULL
          AND r.data->'external'->>'tcpConnectMs' IS NOT NULL AND r.data->'external'->>'tlsMs' IS NOT NULL
          AND r.data->'external'->>'ttfbMs' IS NOT NULL)) AS last_success
      FROM building_diagnostics_jobs j LEFT JOIN building_diagnostics_reports r ON r.job_id=j.id
      WHERE j.type IN ('fred','external-quick') AND j.created_at>now()-interval '7 days'
      GROUP BY j.device_id,j.building,j.type`)).rows;
    const planned = planTimingProbe({ devices: overview.devices, history, pending, dailyJobs, externalConfigured: externalProbeConfig().configured });
    if (!planned) return { skipped: "no eligible due probe, pending measurement, or daily limit", pending: pending.length, dailyJobs };
    if (!process.argv.includes("--apply")) return { dryRun: true, planned, dailyJobs };
    // Explicit bounded device selection; use the production queue's normal
    // capability, budget, concurrency, audit and receipt validation.
    const queued = await diagnosticsStore.queue({ deviceIds: [planned.deviceId], type: planned.type }, ACTOR);
    return { ...queued, type: planned.type, computer: planned.computer, building: planned.building, dailyJobs: dailyJobs + queued.queued };
  } finally {
    await lock.query("SELECT pg_advisory_unlock(921833334)");
    lock.release();
  }
}

run().then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : "Timing collection failed" }));
  process.exitCode = 1;
}).finally(() => pool.end());
