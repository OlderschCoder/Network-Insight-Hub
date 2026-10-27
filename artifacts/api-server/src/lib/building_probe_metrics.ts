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
    if (typeof row.capacityJobId === "string") metric.capacityJobId = row.capacityJobId;
    if (typeof row.attemptId === "string") metric.attemptId = row.attemptId;
    for (const field of ["bytes", "elapsedMs", "mbps", "rangeCount", "linkSpeedBps"])
      if (typeof details[field] === "number" && Number.isFinite(details[field]) && details[field] >= 0)
        metric[field] = details[field];
    // Do not export credentials, raw snapshots, current users, addresses,
    // packet data, arbitrary detail fields or arrival timestamps as sample time.
    return [metric];
  });
}

/** One point per logical building/window, never a fabricated physical device. */
export function projectCapacityMetrics(windows: readonly any[]) {
  const seen = new Set<string>();
  return windows.flatMap(window => {
    const { capacityJobId, buildingId, originalSampleAt, bytesValidated, bytesReserved, remainingBytes } = window;
    if (typeof capacityJobId !== "string" || typeof buildingId !== "string"
      || !Number.isFinite(Date.parse(originalSampleAt)) || seen.has(capacityJobId)
      || ![bytesValidated, bytesReserved, remainingBytes].every(value => Number.isSafeInteger(value) && value >= 0)
      || bytesValidated + bytesReserved + remainingBytes !== 10_000_000_000) return [];
    seen.add(capacityJobId);
    return [{ capacityJobId, buildingId, originalSampleAt, bytesValidated, bytesReserved, remainingBytes,
      state: String(window.state).slice(0, 80), attemptCount: Math.min(2, window.attempts?.length ?? 0),
      complete: bytesValidated === 10_000_000_000,
      ...(Number.isFinite(Date.parse(window.deadlineAt)) ? { deadlineAtMs: Date.parse(window.deadlineAt) } : {}) }];
  });
}

/** Health observation times may advance; performance sample times never do. */
export function projectProbeHealth(rows: readonly any[], observedAt: string) {
  const now = Date.parse(observedAt);
  if (!Number.isFinite(now)) throw new Error("A health observation timestamp is required.");
  const seen = new Set<string>();
  return rows.flatMap(row => {
    if (typeof row.assignmentId !== "string" || typeof row.buildingId !== "string" || seen.has(row.assignmentId)) return [];
    seen.add(row.assignmentId);
    const heartbeat = Date.parse(row.lastSeen), sample = Date.parse(row.lastThroughputAt);
    const activation = Date.parse(row.activationAt), missed = Date.parse(row.missedSlot);
    const hasHeartbeat = Number.isFinite(heartbeat) && heartbeat <= now + 30_000;
    const hasSample = Number.isFinite(sample) && sample <= now + 30_000;
    const online = hasHeartbeat && now - heartbeat <= 90_000;
    const selected = row.selected === true;
    return [{ assignmentId: row.assignmentId, buildingId: row.buildingId, observedAt,
      ...(typeof row.deviceId === "string" ? { deviceId: row.deviceId } : {}),
      selected, capable: row.capable === true, eligible: row.eligible === true, online,
      offline: selected && !online, hasThroughputSample: hasSample,
      ...(hasHeartbeat ? { heartbeatAgeSeconds: Math.max(0, (now - heartbeat) / 1000) } : {}),
      ...(hasSample ? { throughputAgeSeconds: Math.max(0, (now - sample) / 1000) } : {}),
      staleThroughput: selected && row.capable === true && (hasSample ? now - sample > 420_000
        : Number.isFinite(activation) && now - activation > 420_000),
      missedSlot: selected && Number.isFinite(missed) && (!hasSample || missed > sample),
      consecutiveFailures: Math.max(0, Number(row.consecutiveFailures) || 0),
      ...(typeof row.missedSlotReason === "string" ? { missedSlotReason: row.missedSlotReason.slice(0, 160) } : {}) }];
  });
}
