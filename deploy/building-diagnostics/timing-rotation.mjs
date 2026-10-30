export const ACTOR = "approved recurring timing and HTTPS request-loss probes";
export const INTERVAL_MS = 6 * 60 * 60_000;
export const RETRY_MS = 30 * 60_000;
export const DAILY_JOB_LIMIT = 128;

// A single bounded probe per pass; all transfer/identity checks remain in Fred.
export function planTimingProbe({ devices, history, pending, dailyJobs, externalConfigured, now = Date.now() }) {
  if (pending.some(p => p.status !== "queued" || p.requested_by === ACTOR) || dailyJobs >= DAILY_JOB_LIMIT) return null;
  const candidates = [];
  for (const d of devices) {
    if (!d.deviceId || !d.enrolled || d.revoked || !d.online || !d.adVerified || d.adEnabled !== true
        || d.location?.kind !== "network-confirmed" || !d.location.building
        || !Number.isFinite(Date.parse(d.lastCheckIn)) || now - Date.parse(d.lastCheckIn) > 120_000) continue;
    if (pending.some(p => p.device_id === d.deviceId)) continue;
    for (const type of ["external-quick", "fred"]) {
      if (type === "external-quick" && (!externalConfigured || !d.capabilities?.includes("external-probe-v2"))) continue;
      const rows = history.filter(r => r.building === d.location.building && r.type === type);
      const lastSuccess = Math.max(0, ...rows.map(r => Date.parse(r.last_success) || 0));
      const lastAttempt = Math.max(0, ...rows.map(r => Date.parse(r.last_attempt) || 0));
      if (now - lastSuccess < INTERVAL_MS || now - lastAttempt < RETRY_MS) continue;
      const deviceLast = Math.max(0, ...rows.filter(r => r.device_id === d.deviceId).map(r => Date.parse(r.last_attempt) || 0));
      candidates.push({ deviceId: d.deviceId, computer: d.computerName, building: d.location.building, type, lastSuccess, deviceLast });
    }
  }
  return candidates.sort((a, b) => a.lastSuccess - b.lastSuccess || a.building.localeCompare(b.building)
    || a.type.localeCompare(b.type) || a.deviceLast - b.deviceLast || a.computer.localeCompare(b.computer))[0] ?? null;
}
