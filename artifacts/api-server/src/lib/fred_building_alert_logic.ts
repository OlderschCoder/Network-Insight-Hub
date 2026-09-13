import { createHash } from "node:crypto";

export const FRED_BUILDING_ALERT_STATE_VERSION = 1 as const;

export type FredObservationStatus = "up" | "down" | "unknown";
export type FredAlertPhase = "normal" | "outage";
export type FredAlertScope = "building" | "switch";

export type FredSwitchObservation = {
  switchId: string;
  status: FredObservationStatus;
  observedAt: string;
  source?: string;
};

export type FredBuildingTopology = {
  buildingId: string;
  buildingName: string;
  anchorSwitchId: string;
  childSwitchIds: readonly string[];
};

export type FredTargetAlertState = {
  phase: FredAlertPhase;
  consecutiveFreshDowns: number;
  consecutiveFreshUps: number;
  downSequenceStartedAt: string | null;
  activeIncidentId: string | null;
  lastProcessedObservationAt: string | null;
};

export type FredBuildingAlertState = {
  version: typeof FRED_BUILDING_ALERT_STATE_VERSION;
  targets: Record<string, FredTargetAlertState>;
};

export type FredBuildingAlertConfig = {
  maxObservationAgeMs: number;
  maxFutureSkewMs: number;
  maxObservationGapMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
};

export type FredObservationReason =
  | "fresh"
  | "missing"
  | "invalid_timestamp"
  | "stale"
  | "future"
  | "reported_unknown"
  | "conflicting"
  | "already_processed"
  | "building_outage";

export type FredTargetEvaluation = {
  scope: FredAlertScope;
  buildingId: string;
  targetId: string;
  targetKey: string;
  effectiveStatus: FredObservationStatus;
  reason: FredObservationReason;
  observationAt: string | null;
  observationSources: readonly string[];
  phase: FredAlertPhase;
  consecutiveFreshDowns: number;
  consecutiveFreshUps: number;
  suppressed: boolean;
};

export type FredAlertTransition = {
  kind: "outage" | "recovery";
  scope: FredAlertScope;
  buildingId: string;
  buildingName: string;
  targetId: string;
  targetName: string;
  anchorSwitchId: string;
  incidentId: string;
  idempotencyKey: string;
  occurredAt: string;
  observationAt: string;
};

export type EvaluateFredBuildingAlertsInput = {
  now: string | number | Date;
  topology: readonly FredBuildingTopology[];
  observations: readonly FredSwitchObservation[];
  previousState?: FredBuildingAlertState;
  config?: Partial<FredBuildingAlertConfig>;
};

export type EvaluateFredBuildingAlertsResult = {
  state: FredBuildingAlertState;
  transitions: FredAlertTransition[];
  evaluations: FredTargetEvaluation[];
  suppressedSwitchIds: string[];
};

export const DEFAULT_FRED_BUILDING_ALERT_CONFIG: Readonly<FredBuildingAlertConfig> =
  {
    maxObservationAgeMs: 90_000,
    maxFutureSkewMs: 5_000,
    maxObservationGapMs: 90_000,
    failureThreshold: 3,
    recoveryThreshold: 2,
  };

export const DEFAULT_FRED_OBSERVATION_SOURCE_PRIORITY = [
  "noc",
  "influx",
] as const;

export type FredResolvedSwitchObservation = {
  status: FredObservationStatus;
  reason: Exclude<
    FredObservationReason,
    "already_processed" | "building_outage"
  >;
  observedAt: string | null;
  observedAtMs: number | null;
  sources: string[];
};

type TargetDescriptor = {
  scope: FredAlertScope;
  buildingId: string;
  buildingName: string;
  targetId: string;
  targetName: string;
  targetKey: string;
  anchorSwitchId: string;
};

const normalizeId = (value: string) => value.trim().toLowerCase();

export const fredBuildingTargetKey = (buildingId: string) =>
  `building:${normalizeId(buildingId)}`;

export const fredSwitchTargetKey = (buildingId: string, switchId: string) =>
  `switch:${normalizeId(buildingId)}:${normalizeId(switchId)}`;

export function createEmptyFredBuildingAlertState(): FredBuildingAlertState {
  return { version: FRED_BUILDING_ALERT_STATE_VERSION, targets: {} };
}

function createEmptyTargetState(): FredTargetAlertState {
  return {
    phase: "normal",
    consecutiveFreshDowns: 0,
    consecutiveFreshUps: 0,
    downSequenceStartedAt: null,
    activeIncidentId: null,
    lastProcessedObservationAt: null,
  };
}

function validatePositiveInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function resolveConfig(
  config?: Partial<FredBuildingAlertConfig>,
): FredBuildingAlertConfig {
  const resolved = { ...DEFAULT_FRED_BUILDING_ALERT_CONFIG, ...config };
  validatePositiveInteger("maxObservationAgeMs", resolved.maxObservationAgeMs);
  validatePositiveInteger("maxObservationGapMs", resolved.maxObservationGapMs);
  validatePositiveInteger("failureThreshold", resolved.failureThreshold);
  validatePositiveInteger("recoveryThreshold", resolved.recoveryThreshold);
  if (
    !Number.isInteger(resolved.maxFutureSkewMs) ||
    resolved.maxFutureSkewMs < 0
  ) {
    throw new Error("maxFutureSkewMs must be a non-negative integer");
  }
  return resolved;
}

function parseNow(now: string | number | Date) {
  const parsed = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(parsed))
    throw new Error("now must be a valid timestamp");
  return parsed;
}

function validateTopology(topology: readonly FredBuildingTopology[]) {
  const buildingIds = new Set<string>();
  const assignedSwitches = new Set<string>();

  for (const building of topology) {
    const buildingId = normalizeId(building.buildingId);
    const anchorSwitchId = normalizeId(building.anchorSwitchId);
    if (!buildingId || !building.buildingName.trim() || !anchorSwitchId) {
      throw new Error(
        "Each building requires a buildingId, buildingName, and explicit anchorSwitchId",
      );
    }
    if (buildingIds.has(buildingId))
      throw new Error(`Duplicate buildingId: ${building.buildingId}`);
    buildingIds.add(buildingId);

    const localSwitches = new Set<string>();
    for (const switchIdValue of [
      building.anchorSwitchId,
      ...building.childSwitchIds,
    ]) {
      const switchId = normalizeId(switchIdValue);
      if (!switchId)
        throw new Error(
          `Building ${building.buildingId} contains an empty switchId`,
        );
      if (localSwitches.has(switchId)) {
        throw new Error(
          `Switch ${switchIdValue} is duplicated in building ${building.buildingId}`,
        );
      }
      if (assignedSwitches.has(switchId)) {
        throw new Error(
          `Switch ${switchIdValue} is assigned to more than one building`,
        );
      }
      localSwitches.add(switchId);
      assignedSwitches.add(switchId);
    }
  }
}

function clonePreviousState(
  previousState?: FredBuildingAlertState,
): FredBuildingAlertState {
  if (!previousState) return createEmptyFredBuildingAlertState();
  if (previousState.version !== FRED_BUILDING_ALERT_STATE_VERSION) {
    throw new Error(
      `Unsupported Fred building alert state version: ${previousState.version}`,
    );
  }

  const targets: Record<string, FredTargetAlertState> = {};
  for (const [key, value] of Object.entries(previousState.targets)) {
    if (value.phase === "outage" && !value.activeIncidentId) {
      throw new Error(`Outage target ${key} is missing activeIncidentId`);
    }
    targets[key] = { ...value };
  }
  return { version: FRED_BUILDING_ALERT_STATE_VERSION, targets };
}

function indexObservations(observations: readonly FredSwitchObservation[]) {
  const bySwitchId = new Map<string, FredSwitchObservation[]>();
  for (const observation of observations) {
    const key = normalizeId(observation.switchId);
    if (!key) continue;
    const existing = bySwitchId.get(key);
    if (existing) existing.push(observation);
    else bySwitchId.set(key, [observation]);
  }
  return bySwitchId;
}

function resolveObservation(
  switchId: string,
  observationsBySwitchId: ReadonlyMap<string, FredSwitchObservation[]>,
  nowMs: number,
  config: FredBuildingAlertConfig,
): FredResolvedSwitchObservation {
  const candidates = observationsBySwitchId.get(normalizeId(switchId)) ?? [];
  if (candidates.length === 0) {
    return {
      status: "unknown",
      reason: "missing",
      observedAt: null,
      observedAtMs: null,
      sources: [],
    };
  }

  const parsed = candidates
    .map((observation) => ({
      observation,
      time: new Date(observation.observedAt).getTime(),
    }))
    .filter((candidate) => Number.isFinite(candidate.time));
  if (parsed.length === 0) {
    return {
      status: "unknown",
      reason: "invalid_timestamp",
      observedAt: null,
      observedAtMs: null,
      sources: [],
    };
  }

  const temporallyFresh = parsed.filter(
    (candidate) =>
      candidate.time <= nowMs + config.maxFutureSkewMs &&
      nowMs - candidate.time <= config.maxObservationAgeMs,
  );
  const sourceRank = (source?: string) => {
    const rank = DEFAULT_FRED_OBSERVATION_SOURCE_PRIORITY.indexOf(
      normalizeId(
        source ?? "",
      ) as (typeof DEFAULT_FRED_OBSERVATION_SOURCE_PRIORITY)[number],
    );
    return rank === -1 ? DEFAULT_FRED_OBSERVATION_SOURCE_PRIORITY.length : rank;
  };
  const summarizeNewest = (selectedPool: typeof parsed) => {
    const newestTime = Math.max(
      ...selectedPool.map((candidate) => candidate.time),
    );
    const newest = selectedPool.filter(
      (candidate) => candidate.time === newestTime,
    );
    const statuses = new Set(
      newest.map((candidate) => candidate.observation.status),
    );
    const sources = [
      ...new Set(
        newest
          .map((candidate) => candidate.observation.source?.trim())
          .filter(Boolean) as string[],
      ),
    ].sort();
    return {
      newestTime,
      statuses,
      sources,
      observedAt: new Date(newestTime).toISOString(),
    };
  };

  // Evaluate each source independently. A completed NOC up/down probe is
  // authoritative, but a current NOC execution error is not evidence and may
  // fall through to a fresh Influx heartbeat. Conflicting NOC results remain
  // unknown rather than being hidden by a lower-priority source.
  const sourceOrder = [
    ...DEFAULT_FRED_OBSERVATION_SOURCE_PRIORITY,
    ...new Set(
      temporallyFresh
        .map((candidate) => normalizeId(candidate.observation.source ?? ""))
        .filter(
          (source) =>
            !DEFAULT_FRED_OBSERVATION_SOURCE_PRIORITY.includes(
              source as (typeof DEFAULT_FRED_OBSERVATION_SOURCE_PRIORITY)[number],
            ),
        ),
    ),
  ];
  let skippedUnknown: FredResolvedSwitchObservation | null = null;
  for (const source of sourceOrder) {
    const sourceCandidates = temporallyFresh.filter(
      (candidate) => normalizeId(candidate.observation.source ?? "") === source,
    );
    if (sourceCandidates.length === 0) continue;
    const summary = summarizeNewest(sourceCandidates);
    if (summary.statuses.size !== 1) {
      return {
        status: "unknown",
        reason: "conflicting",
        observedAt: summary.observedAt,
        observedAtMs: summary.newestTime,
        sources: summary.sources,
      };
    }
    const [status] = summary.statuses;
    if (status === "up" || status === "down") {
      return {
        status,
        reason: "fresh",
        observedAt: summary.observedAt,
        observedAtMs: summary.newestTime,
        sources: summary.sources,
      };
    }
    const unknown = {
      status: "unknown" as const,
      reason: "reported_unknown" as const,
      observedAt: summary.observedAt,
      observedAtMs: summary.newestTime,
      sources: summary.sources,
    };
    if (source === "noc") {
      skippedUnknown = unknown;
      continue;
    }
    return unknown;
  }
  if (skippedUnknown) return skippedUnknown;

  // No source supplied usable fresh evidence. Choose the highest-priority
  // source only to explain why the result is unknown.
  const selectedPool = parsed.filter(
    (candidate) =>
      sourceRank(candidate.observation.source) ===
      Math.min(...parsed.map((item) => sourceRank(item.observation.source))),
  );
  const summary = summarizeNewest(selectedPool);
  if (summary.statuses.size !== 1) {
    return {
      status: "unknown",
      reason: "conflicting",
      observedAt: summary.observedAt,
      observedAtMs: summary.newestTime,
      sources: summary.sources,
    };
  }
  const reason =
    summary.newestTime > nowMs + config.maxFutureSkewMs
      ? "future"
      : nowMs - summary.newestTime > config.maxObservationAgeMs
        ? "stale"
        : "reported_unknown";
  return {
    status: "unknown",
    reason,
    observedAt: summary.observedAt,
    observedAtMs: summary.newestTime,
    sources: summary.sources,
  };
}

export function resolveFredSwitchObservation(input: {
  switchId: string;
  observations: readonly FredSwitchObservation[];
  now: string | number | Date;
  config?: Partial<FredBuildingAlertConfig>;
}): FredResolvedSwitchObservation {
  const nowMs = parseNow(input.now);
  const config = resolveConfig(input.config);
  return resolveObservation(
    input.switchId,
    indexObservations(input.observations),
    nowMs,
    config,
  );
}

function incidentIdFor(
  target: TargetDescriptor,
  downSequenceStartedAt: string,
) {
  const compactTime = downSequenceStartedAt.replace(/[^0-9]/g, "");
  const targetIdentity =
    target.scope === "building"
      ? target.buildingId
      : `${target.buildingId}-${target.targetId}`;
  const normalizedParts = [
    target.scope,
    normalizeId(target.buildingId),
    normalizeId(target.targetId),
    downSequenceStartedAt,
  ];
  const lengthDelimitedIdentity = normalizedParts
    .map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`)
    .join("|");
  const digest = createHash("sha256")
    .update(lengthDelimitedIdentity)
    .digest("hex")
    .slice(0, 24);
  const readableTarget = normalizeId(targetIdentity)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  return `fred-${target.scope}-${readableTarget || "target"}-${compactTime}-${digest}`;
}

function transitionFor(
  kind: FredAlertTransition["kind"],
  target: TargetDescriptor,
  incidentId: string,
  nowMs: number,
  observationAt: string,
): FredAlertTransition {
  return {
    kind,
    scope: target.scope,
    buildingId: target.buildingId,
    buildingName: target.buildingName,
    targetId: target.targetId,
    targetName: target.targetName,
    anchorSwitchId: target.anchorSwitchId,
    incidentId,
    idempotencyKey: `fred-alert:${incidentId}:${kind}`,
    occurredAt: new Date(nowMs).toISOString(),
    observationAt,
  };
}

function evaluateTarget(
  target: TargetDescriptor,
  previous: FredTargetAlertState,
  observation: FredResolvedSwitchObservation,
  nowMs: number,
  config: FredBuildingAlertConfig,
): {
  state: FredTargetAlertState;
  evaluation: FredTargetEvaluation;
  transition?: FredAlertTransition;
} {
  const state = { ...previous };
  let reason: FredObservationReason = observation.reason;
  let transition: FredAlertTransition | undefined;
  const previousObservationMs = state.lastProcessedObservationAt
    ? new Date(state.lastProcessedObservationAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const isNewFreshObservation =
    observation.reason === "fresh" &&
    observation.observedAtMs != null &&
    observation.observedAtMs > previousObservationMs;
  const observationGapMs =
    isNewFreshObservation && Number.isFinite(previousObservationMs)
      ? observation.observedAtMs! - previousObservationMs
      : null;

  if (observation.reason !== "fresh") {
    state.consecutiveFreshDowns = 0;
    state.consecutiveFreshUps = 0;
    if (state.phase === "normal") state.downSequenceStartedAt = null;
  } else if (!isNewFreshObservation) {
    reason = "already_processed";
  } else {
    const observationAt = observation.observedAt!;
    if (
      observationGapMs != null &&
      observationGapMs > config.maxObservationGapMs
    ) {
      state.consecutiveFreshDowns = 0;
      state.consecutiveFreshUps = 0;
      if (state.phase === "normal") state.downSequenceStartedAt = null;
    }
    state.lastProcessedObservationAt = observationAt;
    if (state.phase === "normal" && observation.status === "down") {
      state.consecutiveFreshDowns += 1;
      state.consecutiveFreshUps = 0;
      state.downSequenceStartedAt ??= observationAt;
      if (state.consecutiveFreshDowns >= config.failureThreshold) {
        const incidentId = incidentIdFor(target, state.downSequenceStartedAt!);
        state.phase = "outage";
        state.activeIncidentId = incidentId;
        transition = transitionFor(
          "outage",
          target,
          incidentId,
          nowMs,
          observationAt,
        );
      }
    } else if (state.phase === "normal") {
      state.consecutiveFreshDowns = 0;
      state.consecutiveFreshUps = 0;
      state.downSequenceStartedAt = null;
    } else if (observation.status === "up") {
      state.consecutiveFreshUps += 1;
      state.consecutiveFreshDowns = 0;
      if (state.consecutiveFreshUps >= config.recoveryThreshold) {
        const incidentId = state.activeIncidentId!;
        state.phase = "normal";
        state.consecutiveFreshUps = 0;
        state.downSequenceStartedAt = null;
        state.activeIncidentId = null;
        transition = transitionFor(
          "recovery",
          target,
          incidentId,
          nowMs,
          observationAt,
        );
      }
    } else {
      state.consecutiveFreshUps = 0;
    }
  }

  return {
    state,
    transition,
    evaluation: {
      scope: target.scope,
      buildingId: target.buildingId,
      targetId: target.targetId,
      targetKey: target.targetKey,
      effectiveStatus:
        observation.reason === "fresh" ? observation.status : "unknown",
      reason,
      observationAt: observation.observedAt,
      observationSources: observation.sources,
      phase: state.phase,
      consecutiveFreshDowns: state.consecutiveFreshDowns,
      consecutiveFreshUps: state.consecutiveFreshUps,
      suppressed: false,
    },
  };
}

function suppressTarget(
  target: TargetDescriptor,
  previous: FredTargetAlertState,
  observation: FredResolvedSwitchObservation,
): { state: FredTargetAlertState; evaluation: FredTargetEvaluation } {
  const state = { ...previous };
  if (state.phase === "normal") {
    state.consecutiveFreshDowns = 0;
    state.consecutiveFreshUps = 0;
    state.downSequenceStartedAt = null;
  } else {
    state.consecutiveFreshUps = 0;
  }

  if (observation.reason === "fresh" && observation.observedAtMs != null) {
    const previousObservationMs = state.lastProcessedObservationAt
      ? new Date(state.lastProcessedObservationAt).getTime()
      : Number.NEGATIVE_INFINITY;
    if (observation.observedAtMs > previousObservationMs) {
      state.lastProcessedObservationAt = observation.observedAt;
    }
  }

  return {
    state,
    evaluation: {
      scope: target.scope,
      buildingId: target.buildingId,
      targetId: target.targetId,
      targetKey: target.targetKey,
      effectiveStatus: "unknown",
      reason: "building_outage",
      observationAt: observation.observedAt,
      observationSources: observation.sources,
      phase: state.phase,
      consecutiveFreshDowns: state.consecutiveFreshDowns,
      consecutiveFreshUps: state.consecutiveFreshUps,
      suppressed: true,
    },
  };
}

export function evaluateFredBuildingAlerts(
  input: EvaluateFredBuildingAlertsInput,
): EvaluateFredBuildingAlertsResult {
  const nowMs = parseNow(input.now);
  const config = resolveConfig(input.config);
  validateTopology(input.topology);

  const state = clonePreviousState(input.previousState);
  const observationsBySwitchId = indexObservations(input.observations);
  const transitions: FredAlertTransition[] = [];
  const evaluations: FredTargetEvaluation[] = [];
  const suppressedSwitchIds: string[] = [];

  for (const building of input.topology) {
    const buildingTarget: TargetDescriptor = {
      scope: "building",
      buildingId: building.buildingId,
      buildingName: building.buildingName,
      targetId: building.buildingId,
      targetName: building.buildingName,
      targetKey: fredBuildingTargetKey(building.buildingId),
      anchorSwitchId: building.anchorSwitchId,
    };
    const buildingResult = evaluateTarget(
      buildingTarget,
      state.targets[buildingTarget.targetKey] ?? createEmptyTargetState(),
      resolveObservation(
        building.anchorSwitchId,
        observationsBySwitchId,
        nowMs,
        config,
      ),
      nowMs,
      config,
    );
    state.targets[buildingTarget.targetKey] = buildingResult.state;
    evaluations.push(buildingResult.evaluation);
    if (buildingResult.transition) transitions.push(buildingResult.transition);

    const suppressChildren = buildingResult.state.phase === "outage";
    for (const switchId of building.childSwitchIds) {
      const switchTarget: TargetDescriptor = {
        scope: "switch",
        buildingId: building.buildingId,
        buildingName: building.buildingName,
        targetId: switchId,
        targetName: switchId,
        targetKey: fredSwitchTargetKey(building.buildingId, switchId),
        anchorSwitchId: building.anchorSwitchId,
      };
      const previousTarget =
        state.targets[switchTarget.targetKey] ?? createEmptyTargetState();
      const observation = resolveObservation(
        switchId,
        observationsBySwitchId,
        nowMs,
        config,
      );
      if (suppressChildren) {
        const result = suppressTarget(
          switchTarget,
          previousTarget,
          observation,
        );
        state.targets[switchTarget.targetKey] = result.state;
        evaluations.push(result.evaluation);
        suppressedSwitchIds.push(switchId);
      } else {
        const result = evaluateTarget(
          switchTarget,
          previousTarget,
          observation,
          nowMs,
          config,
        );
        state.targets[switchTarget.targetKey] = result.state;
        evaluations.push(result.evaluation);
        if (result.transition) transitions.push(result.transition);
      }
    }
  }

  return { state, transitions, evaluations, suppressedSwitchIds };
}
