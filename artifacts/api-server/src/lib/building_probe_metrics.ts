/** Flat, credential-free projection for the existing NOC Telegraf HTTP input. */
export function projectProbeMetrics(rows: readonly any[]) {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    const result = row.result, details = result?.details;
    const time = Date.parse(row.originalSampleAt);
    if (!result || result.kind !== "throughput" || !details
      || !["quick", "hourly", "capacity"].includes(details.profile)
      || typeof row.sampleId !== "string" || !/^[a-f0-9]{64}$/.test(row.sampleId)
      || !Number.isFinite(time) || seen.has(row.sampleId)) return [];
    seen.add(row.sampleId);
    const metric: Record<string, string | number | boolean> = {
      sampleId: row.sampleId, jobId: row.jobId, deviceId: row.deviceId,
      buildingId: row.buildingId, testType: row.testType,
      originalSampleAt: row.originalSampleAt, outcome: result.outcome,
      termination: details.termination ?? "unknown",
      successful: result.outcome === "completed",
    };
    for (const field of ["bytes", "elapsedMs", "mbps", "rangeCount", "linkSpeedBps"])
      if (typeof details[field] === "number" && Number.isFinite(details[field]) && details[field] >= 0)
        metric[field] = details[field];
    // Do not export credentials, raw snapshots, current users, addresses,
    // packet data, arbitrary detail fields or arrival timestamps as sample time.
    return [metric];
  });
}
