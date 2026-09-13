import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { isEmailConfigured, sendReportEmail } from "./email";
import {
  createEmptyFredBuildingAlertState,
  evaluateFredBuildingAlerts,
  fredBuildingTargetKey,
  fredSwitchTargetKey,
  type FredAlertTransition,
  type FredBuildingAlertState,
  type FredSwitchObservation,
  type FredTargetEvaluation,
} from "./fred_building_alert_logic";
import {
  describeFredTelnyxError,
  fredRecipientIdempotencyKey,
  fredRecipientToken,
  hashFredRecipient,
  loadFredTelnyxConfig,
  sendFredSms,
  type FredTelnyxConfig,
} from "./fred_telnyx";
import {
  FRED_TEST_MESSAGE,
  formatFredAlertMessage,
  fredDeliveryBaseKey,
  loadFredAlertRuntimeConfig,
  type FredAlertRuntimeConfig,
} from "./fred_alert_runtime";
import { getFredSwitchObservations } from "../routes/network_nodes";

const FRED_ALERT_ADVISORY_LOCK = 1_916_198_404;
const FRED_ALERT_POLL_LEASE_NAME = "building-monitor";
const FRED_ALERT_CRASH_LEASE_FLOOR_MS = 30_000;

type FredDbResult<Row> = {
  rows: Row[];
  rowCount?: number | null;
};

type FredDbExecutor = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<FredDbResult<Row>>;
};

type FredDbClient = FredDbExecutor & {
  release(): void;
};

export type EnabledAnchor = {
  id: string;
  buildingKey: string;
  buildingName: string;
  anchorSwitchId: string;
  anchorHostname: string;
  anchorHost: string;
  failureThreshold: number;
  recoveryThreshold: number;
  children: Array<{ switchId: string; hostname: string; host: string }>;
};

type PersistedStateRow = {
  scope: "building" | "switch";
  target_id: string;
  phase: "normal" | "outage";
  consecutive_fresh_downs: number;
  consecutive_fresh_ups: number;
  down_sequence_started_at: Date | string | null;
  active_incident_id: string | null;
  last_processed_observation_at: Date | string | null;
};

type PendingSmsRow = {
  id: string;
  incident_id: string;
  idempotency_key: string;
  recipient_hash: string;
  recipient_last4: string | null;
  transition_kind: "outage" | "recovery";
  scope: "building" | "switch";
  target_name: string;
  building_name: string;
  failure_threshold: number;
  recovery_threshold: number;
  event_at: Date | string;
};

type QueuedTransition = {
  transition: FredAlertTransition;
  incidentId: string;
  anchor: EnabledAnchor;
};

type FredPollLease = {
  token: string;
  pollIntervalMs: number;
};

export type FredTestDeliveryResult = {
  recipientToken: string;
  status: "accepted" | "failed";
  providerStatus?: string;
  errorCode?: string;
};

export type FredAlertWorkerState = "disabled" | "starting" | "ok" | "degraded";

export type FredAlertWorkerErrorCode =
  | "configuration_invalid"
  | "anchor_seed_failed"
  | "no_enabled_anchors"
  | "sms_configuration_invalid"
  | "lease_lost"
  | "tick_failed"
  | "fallback_failed";

export type FredAlertWorkerHealth = {
  state: FredAlertWorkerState;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  errorCode: FredAlertWorkerErrorCode | null;
};

let timer: NodeJS.Timeout | null = null;
let tickRunning = false;
let fredAlertWorkerHealth: FredAlertWorkerHealth = {
  state: "disabled",
  lastSuccessAt: null,
  lastErrorAt: null,
  errorCode: null,
};

export function getFredAlertWorkerHealth(): FredAlertWorkerHealth {
  return { ...fredAlertWorkerHealth };
}

function setFredAlertWorkerStarting(): void {
  fredAlertWorkerHealth = {
    ...fredAlertWorkerHealth,
    state: "starting",
    errorCode: null,
  };
}

function setFredAlertWorkerDisabled(): void {
  fredAlertWorkerHealth = {
    state: "disabled",
    lastSuccessAt: null,
    lastErrorAt: null,
    errorCode: null,
  };
}

function setFredAlertWorkerOk(): void {
  fredAlertWorkerHealth = {
    ...fredAlertWorkerHealth,
    state: "ok",
    lastSuccessAt: new Date().toISOString(),
    errorCode: null,
  };
}

function setFredAlertWorkerDegraded(errorCode: FredAlertWorkerErrorCode): void {
  fredAlertWorkerHealth = {
    ...fredAlertWorkerHealth,
    state: "degraded",
    lastErrorAt: new Date().toISOString(),
    errorCode,
  };
}

/**
 * Validate all configuration required by an enabled worker before the HTTP
 * listener starts. The returned runtime config is safe to pass to the worker
 * so startup does not silently reinterpret an invalid enablement value as off.
 */
export function prepareFredBuildingAlerts(
  env: Record<string, string | undefined> = process.env,
): FredAlertRuntimeConfig {
  try {
    const runtime = loadFredAlertRuntimeConfig(env);
    if (!runtime.enabled) {
      setFredAlertWorkerDisabled();
      return runtime;
    }
    loadFredTelnyxConfig(env);
    setFredAlertWorkerStarting();
    return runtime;
  } catch (error) {
    setFredAlertWorkerDegraded("configuration_invalid");
    throw error;
  }
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safelyLoadTelnyxConfig(): FredTelnyxConfig | null {
  try {
    return loadFredTelnyxConfig();
  } catch (error) {
    const failure = describeFredTelnyxError(error);
    logger.warn(
      { code: failure.code },
      "Fred SMS is unavailable; incident detection remains active",
    );
    return null;
  }
}

/**
 * Claim the durable, cross-replica monitoring cadence before any probe runs.
 * The longer initial expiry covers a crashed or stalled probe; normal
 * completion shortens it to no earlier than one poll interval after acquire.
 */
export async function acquireFredBuildingAlertPollLease(
  pollIntervalMs: number,
  database: FredDbExecutor = pool,
): Promise<FredPollLease | null> {
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new Error("Fred poll interval must be a positive integer.");
  }
  const token = randomUUID();
  const crashLeaseMs = Math.max(
    pollIntervalMs * 2,
    pollIntervalMs + FRED_ALERT_CRASH_LEASE_FLOOR_MS,
  );
  const result = await database.query<{ lease_token: string }>(
    `INSERT INTO fred_building_alert_poll_leases (
       lease_name, lease_token, leased_until, acquired_at, updated_at
     ) VALUES (
       $1,
       $2::uuid,
       clock_timestamp() + ($3::bigint * interval '1 millisecond'),
       clock_timestamp(),
       clock_timestamp()
     )
     ON CONFLICT (lease_name) DO UPDATE SET
       lease_token = excluded.lease_token,
       leased_until = clock_timestamp() + ($3::bigint * interval '1 millisecond'),
       acquired_at = clock_timestamp(),
       updated_at = clock_timestamp()
     WHERE fred_building_alert_poll_leases.leased_until <= clock_timestamp()
     RETURNING lease_token::text`,
    [FRED_ALERT_POLL_LEASE_NAME, token, crashLeaseMs],
  );
  return result.rows[0]?.lease_token === token
    ? { token, pollIntervalMs }
    : null;
}

export async function completeFredBuildingAlertPollLease(
  lease: FredPollLease,
  database: FredDbExecutor = pool,
): Promise<boolean> {
  const result = await database.query<{ lease_token: string }>(
    `UPDATE fred_building_alert_poll_leases
     SET leased_until = greatest(
           acquired_at + ($3::bigint * interval '1 millisecond'),
           clock_timestamp()
         ),
         updated_at = clock_timestamp()
     WHERE lease_name = $1 AND lease_token = $2::uuid
     RETURNING lease_token::text`,
    [FRED_ALERT_POLL_LEASE_NAME, lease.token, lease.pollIntervalMs],
  );
  return result.rows[0]?.lease_token === lease.token;
}

export async function seedFredBuildingAnchorCandidates(): Promise<number> {
  const result = await pool.query<{ id: string }>(`
    WITH normalized_switches AS (
      SELECT
        id,
        trim(building) AS building_name,
        lower(trim(building)) AS normalized_building
      FROM network_switches
      WHERE nullif(trim(building), '') IS NOT NULL
        AND nullif(trim(ip_address), '') IS NOT NULL
    ), singleton_buildings AS (
      SELECT
        normalized_building,
        min(building_name) AS building_name,
        min(id) AS anchor_switch_id,
        count(*) AS switch_count
      FROM normalized_switches
      GROUP BY normalized_building
    ), candidates AS (
      SELECT
        regexp_replace(
          regexp_replace(normalized_building, '[^a-z0-9]+', '-', 'g'),
          '(^-|-$)',
          '',
          'g'
        ) AS building_key,
        building_name,
        anchor_switch_id
      FROM singleton_buildings
      WHERE switch_count = 1
    )
    INSERT INTO fred_building_anchors (
      building_key,
      building_name,
      anchor_switch_id,
      enabled
    )
    SELECT building_key, building_name, anchor_switch_id, false
    FROM candidates
    WHERE building_key <> ''
    ON CONFLICT (building_key) DO NOTHING
    RETURNING id::text
  `);
  return result.rowCount ?? 0;
}

const normalizeTopologyIdentity = (value: string) => value.trim().toLowerCase();

/** Fail the full cycle when enabled topology is ambiguous across anchors. */
export function validateFredEnabledAnchorTopology(
  anchors: readonly EnabledAnchor[],
): void {
  const buildingKeys = new Set<string>();
  const buildingNames = new Set<string>();
  const assignedSwitchIds = new Set<string>();

  for (const anchor of anchors) {
    const buildingKey = normalizeTopologyIdentity(anchor.buildingKey);
    const buildingName = normalizeTopologyIdentity(anchor.buildingName);
    if (!buildingKey || !buildingName || !anchor.anchorSwitchId.trim()) {
      throw new Error(
        "Fred enabled topology contains an incomplete building anchor.",
      );
    }
    if (buildingKeys.has(buildingKey)) {
      throw new Error(
        `Fred enabled topology contains duplicate building key: ${buildingKey}`,
      );
    }
    if (buildingNames.has(buildingName)) {
      throw new Error(
        `Fred enabled topology contains duplicate building name: ${buildingName}`,
      );
    }
    buildingKeys.add(buildingKey);
    buildingNames.add(buildingName);

    for (const switchIdValue of [
      anchor.anchorSwitchId,
      ...anchor.children.map((child) => child.switchId),
    ]) {
      const switchId = normalizeTopologyIdentity(switchIdValue);
      if (!switchId) {
        throw new Error(
          `Fred enabled topology contains an empty switch ID for ${buildingKey}`,
        );
      }
      if (assignedSwitchIds.has(switchId)) {
        throw new Error(
          `Fred enabled topology assigns switch ${switchId} more than once.`,
        );
      }
      assignedSwitchIds.add(switchId);
    }
  }
}

async function loadEnabledAnchors(): Promise<EnabledAnchor[]> {
  const result = await pool.query<{
    anchor_id: string;
    building_key: string;
    building_name: string;
    anchor_switch_id: string;
    anchor_hostname: string | null;
    anchor_host: string | null;
    failure_threshold: number;
    recovery_threshold: number;
    child_switch_id: string | null;
    child_hostname: string | null;
    child_host: string | null;
  }>(`
    SELECT
      a.id::text AS anchor_id,
      a.building_key,
      a.building_name,
      a.anchor_switch_id::text,
      anchor_switch.hostname AS anchor_hostname,
      anchor_switch.ip_address AS anchor_host,
      a.failure_threshold,
      a.recovery_threshold,
      child_switch.id::text AS child_switch_id,
      child_switch.hostname AS child_hostname,
      child_switch.ip_address AS child_host
    FROM fred_building_anchors a
    JOIN network_switches anchor_switch ON anchor_switch.id = a.anchor_switch_id
    LEFT JOIN network_switches child_switch
      ON lower(trim(child_switch.building)) = lower(trim(a.building_name))
     AND child_switch.id <> a.anchor_switch_id
    WHERE a.enabled = true
    ORDER BY a.building_name, child_switch.hostname
  `);

  const byId = new Map<string, EnabledAnchor>();
  for (const row of result.rows) {
    if (!row.anchor_hostname?.trim() || !row.anchor_host?.trim()) {
      throw new Error(
        `Fred enabled topology has incomplete anchor monitoring data for ${row.building_key}.`,
      );
    }
    const anchor = byId.get(row.anchor_id) ?? {
      id: row.anchor_id,
      buildingKey: row.building_key,
      buildingName: row.building_name,
      anchorSwitchId: row.anchor_switch_id,
      anchorHostname: row.anchor_hostname,
      anchorHost: row.anchor_host,
      failureThreshold: Number(row.failure_threshold),
      recoveryThreshold: Number(row.recovery_threshold),
      children: [],
    };
    if (row.child_switch_id) {
      if (!row.child_hostname?.trim() || !row.child_host?.trim()) {
        throw new Error(
          `Fred enabled topology has incomplete child monitoring data for ${row.building_key}.`,
        );
      }
      anchor.children.push({
        switchId: row.child_switch_id,
        hostname: row.child_hostname,
        host: row.child_host,
      });
    }
    byId.set(row.anchor_id, anchor);
  }
  return [...byId.values()];
}

async function loadPreviousState(
  client: FredDbClient,
  anchor: EnabledAnchor,
): Promise<FredBuildingAlertState> {
  const result = await client.query<PersistedStateRow>(
    `SELECT
       scope,
       target_id,
       phase,
       consecutive_fresh_downs,
       consecutive_fresh_ups,
       down_sequence_started_at,
       active_incident_id::text,
       last_processed_observation_at
     FROM fred_building_alert_states
     WHERE building_anchor_id = $1::uuid`,
    [anchor.id],
  );
  const state = createEmptyFredBuildingAlertState();
  for (const row of result.rows) {
    const key =
      row.scope === "building"
        ? fredBuildingTargetKey(anchor.buildingKey)
        : fredSwitchTargetKey(anchor.buildingKey, row.target_id);
    state.targets[key] = {
      phase: row.phase,
      consecutiveFreshDowns: Number(row.consecutive_fresh_downs),
      consecutiveFreshUps: Number(row.consecutive_fresh_ups),
      downSequenceStartedAt: toIso(row.down_sequence_started_at),
      activeIncidentId: row.active_incident_id,
      lastProcessedObservationAt: toIso(row.last_processed_observation_at),
    };
  }
  return state;
}

async function loadSuppressedTargets(
  client: FredDbClient,
  anchor: EnabledAnchor,
): Promise<Set<string>> {
  const result = await client.query<{
    scope: "building" | "switch";
    target_id: string;
  }>(
    `SELECT scope, target_id
     FROM fred_building_alert_suppressions
     WHERE building_anchor_id = $1::uuid
       AND revoked_at IS NULL
       AND starts_at <= now()
       AND (ends_at IS NULL OR ends_at > now())`,
    [anchor.id],
  );
  return new Set(result.rows.map((row) => `${row.scope}:${row.target_id}`));
}

export function isFredTransitionDeliverySuppressed(
  anchor: EnabledAnchor,
  transition: FredAlertTransition,
  suppressed: ReadonlySet<string>,
): boolean {
  const wholeBuilding = suppressed.has(`building:${anchor.buildingKey}`);
  if (transition.scope === "building") return wholeBuilding;
  return wholeBuilding || suppressed.has(`switch:${transition.targetId}`);
}

async function recordSuppressedTransition(
  client: FredDbClient,
  incidentId: string,
  transition: FredAlertTransition,
  runtime: FredAlertRuntimeConfig,
): Promise<void> {
  if (!runtime.recipientHashKey) {
    throw new Error("Fred recipient hashing is not configured.");
  }
  await client.query(
    `INSERT INTO fred_alert_deliveries (
       incident_id,
       transition_kind,
       channel,
       provider,
       recipient_hash,
       idempotency_key,
       status,
       error_code,
       error_message_redacted,
       failed_at
     ) VALUES (
       $1::uuid, $2, 'sms', 'fred_policy', $3, $4, 'failed',
       'suppressed_by_policy',
       'Delivery was suppressed by an active mute or maintenance window',
       now()
     )
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      incidentId,
      transition.kind,
      hashFredRecipient("suppressed-transition", runtime.recipientHashKey),
      `${fredDeliveryBaseKey(transition.idempotencyKey)}.policy.suppressed`,
    ],
  );
}

function targetName(
  anchor: EnabledAnchor,
  evaluation: FredTargetEvaluation,
): string {
  if (evaluation.scope === "building") return anchor.buildingName;
  return (
    anchor.children.find((child) => child.switchId === evaluation.targetId)
      ?.hostname ?? evaluation.targetId
  );
}

async function persistTransition(
  client: FredDbClient,
  anchor: EnabledAnchor,
  transition: FredAlertTransition,
  evaluation: FredTargetEvaluation,
): Promise<string> {
  const safeTargetName = targetName(anchor, evaluation);
  if (transition.kind === "outage") {
    const result = await client.query<{ id: string }>(
      `INSERT INTO fred_building_incidents (
         building_anchor_id,
         scope,
         target_id,
         target_name,
         anchor_switch_id,
         status,
         outage_idempotency_key,
         opened_at,
         opened_observation_at,
         last_observed_at,
         evidence
       ) VALUES (
         $1::uuid, $2, $3, $4, $5::integer, 'open', $6, $7::timestamptz,
         $8::timestamptz, $8::timestamptz, $9::jsonb
       )
       ON CONFLICT (outage_idempotency_key) DO UPDATE
         SET last_observed_at = greatest(
           fred_building_incidents.last_observed_at,
           excluded.last_observed_at
         ),
         updated_at = now()
       RETURNING id::text`,
      [
        anchor.id,
        transition.scope,
        transition.targetId,
        safeTargetName,
        anchor.anchorSwitchId,
        transition.idempotencyKey,
        transition.occurredAt,
        transition.observationAt,
        JSON.stringify({
          reason: evaluation.reason,
          sources: evaluation.observationSources,
          observationAt: evaluation.observationAt,
        }),
      ],
    );
    return result.rows[0].id;
  }

  const result = await client.query<{ id: string }>(
    `UPDATE fred_building_incidents
     SET status = 'resolved',
         recovery_idempotency_key = $2,
         resolved_at = $3::timestamptz,
         recovery_observation_at = $4::timestamptz,
         last_observed_at = $4::timestamptz,
         updated_at = now()
     WHERE id = $1::uuid
     RETURNING id::text`,
    [
      transition.incidentId,
      transition.idempotencyKey,
      transition.occurredAt,
      transition.observationAt,
    ],
  );
  if (!result.rows[0]) {
    throw new Error(
      "Fred recovery references an incident that does not exist.",
    );
  }
  return result.rows[0].id;
}

async function persistState(
  client: FredDbClient,
  anchor: EnabledAnchor,
  state: FredBuildingAlertState,
  evaluation: FredTargetEvaluation,
  transitioned: boolean,
): Promise<void> {
  const target = state.targets[evaluation.targetKey];
  if (!target)
    throw new Error("Fred evaluator returned incomplete target state.");
  await client.query(
    `INSERT INTO fred_building_alert_states (
       building_anchor_id,
       scope,
       target_id,
       target_name,
       phase,
       last_observed_status,
       consecutive_fresh_downs,
       consecutive_fresh_ups,
       down_sequence_started_at,
       active_incident_id,
       last_processed_observation_at,
       last_transition_at,
       state_version
     ) VALUES (
       $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz,
       $10::uuid, $11::timestamptz,
       CASE WHEN $12::boolean THEN now() ELSE NULL END,
       1
     )
     ON CONFLICT (building_anchor_id, scope, target_id) DO UPDATE SET
       target_name = excluded.target_name,
       phase = excluded.phase,
       last_observed_status = excluded.last_observed_status,
       consecutive_fresh_downs = excluded.consecutive_fresh_downs,
       consecutive_fresh_ups = excluded.consecutive_fresh_ups,
       down_sequence_started_at = excluded.down_sequence_started_at,
       active_incident_id = excluded.active_incident_id,
       last_processed_observation_at = excluded.last_processed_observation_at,
       last_transition_at = CASE
         WHEN $12::boolean THEN now()
         ELSE fred_building_alert_states.last_transition_at
       END,
       state_version = 1,
       updated_at = now()`,
    [
      anchor.id,
      evaluation.scope,
      evaluation.targetId,
      targetName(anchor, evaluation),
      target.phase,
      evaluation.effectiveStatus,
      target.consecutiveFreshDowns,
      target.consecutiveFreshUps,
      target.downSequenceStartedAt,
      target.activeIncidentId,
      target.lastProcessedObservationAt,
      transitioned,
    ],
  );
}

async function queueSmsDeliveries(
  client: FredDbClient,
  incidentId: string,
  transition: FredAlertTransition,
  telnyx: FredTelnyxConfig,
): Promise<void> {
  const baseKey = fredDeliveryBaseKey(transition.idempotencyKey);
  for (const recipient of telnyx.recipients) {
    await client.query(
      `INSERT INTO fred_alert_deliveries (
         incident_id,
         transition_kind,
         channel,
         provider,
         recipient_hash,
         recipient_last4,
         idempotency_key,
         status
       ) VALUES ($1::uuid, $2, 'sms', 'telnyx', $3, $4, $5, 'queued')
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        incidentId,
        transition.kind,
        hashFredRecipient(recipient, telnyx.recipientHashKey),
        recipient.slice(-4),
        fredRecipientIdempotencyKey(
          baseKey,
          recipient,
          telnyx.recipientHashKey,
        ),
      ],
    );
  }
}

export async function evaluateAndPersist(
  anchors: readonly EnabledAnchor[],
  observations: readonly FredSwitchObservation[],
  runtime: FredAlertRuntimeConfig,
  telnyx: FredTelnyxConfig | null,
  lease: FredPollLease,
  database: { connect(): Promise<FredDbClient> } = pool,
): Promise<QueuedTransition[] | null> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const fence = await client.query<{ lease_token: string }>(
      `SELECT lease_token::text
       FROM fred_building_alert_poll_leases
       WHERE lease_name = $1
         AND lease_token = $2::uuid
         AND leased_until > clock_timestamp()
       FOR UPDATE`,
      [FRED_ALERT_POLL_LEASE_NAME, lease.token],
    );
    if (fence.rows[0]?.lease_token !== lease.token) {
      await client.query("ROLLBACK");
      return null;
    }
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1) AS locked",
      [FRED_ALERT_ADVISORY_LOCK],
    );
    if (!lock.rows[0]?.locked) {
      await client.query("ROLLBACK");
      return null;
    }

    // An operator may disable an anchor while the external probes are in
    // flight. Revalidate and lock the enabled rows before committing any
    // resulting transition or delivery outbox record.
    const stillEnabled = await client.query<{ id: string }>(
      `SELECT id::text
       FROM fred_building_anchors
       WHERE enabled = true
         AND id = ANY($1::uuid[])
       FOR SHARE`,
      [anchors.map((anchor) => anchor.id)],
    );
    const enabledAnchorIds = new Set(stillEnabled.rows.map((row) => row.id));

    const queued: QueuedTransition[] = [];
    for (const anchor of anchors) {
      if (!enabledAnchorIds.has(anchor.id)) continue;
      const previousState = await loadPreviousState(client, anchor);
      const suppressed = await loadSuppressedTargets(client, anchor);
      const switchIds = new Set([
        anchor.anchorSwitchId,
        ...anchor.children.map((child) => child.switchId),
      ]);
      const anchorObservations = observations.filter((item) =>
        switchIds.has(item.switchId),
      );
      const result = evaluateFredBuildingAlerts({
        now: new Date(),
        topology: [
          {
            buildingId: anchor.buildingKey,
            buildingName: anchor.buildingName,
            anchorSwitchId: anchor.anchorSwitchId,
            childSwitchIds: anchor.children.map((child) => child.switchId),
          },
        ],
        observations: anchorObservations,
        previousState,
        config: {
          maxObservationAgeMs: runtime.maxObservationAgeMs,
          maxObservationGapMs: Math.max(
            runtime.maxObservationAgeMs,
            runtime.pollIntervalMs * 3,
          ),
          failureThreshold: anchor.failureThreshold,
          recoveryThreshold: anchor.recoveryThreshold,
        },
      });

      const transitionByTarget = new Map(
        result.transitions.map((transition) => [
          `${transition.scope}:${transition.targetId}`,
          transition,
        ]),
      );
      for (const evaluation of result.evaluations) {
        const transition = transitionByTarget.get(
          `${evaluation.scope}:${evaluation.targetId}`,
        );
        if (transition) {
          const incidentId = await persistTransition(
            client,
            anchor,
            transition,
            evaluation,
          );
          const target = result.state.targets[evaluation.targetKey];
          if (target) {
            target.activeIncidentId =
              transition.kind === "outage" ? incidentId : null;
          }
          const deliverySuppressed = isFredTransitionDeliverySuppressed(
            anchor,
            transition,
            suppressed,
          );
          if (deliverySuppressed) {
            await recordSuppressedTransition(
              client,
              incidentId,
              transition,
              runtime,
            );
          } else if (telnyx) {
            await queueSmsDeliveries(client, incidentId, transition, telnyx);
          }
          if (!deliverySuppressed) {
            queued.push({ transition, incidentId, anchor });
          }
        }
        await persistState(
          client,
          anchor,
          result.state,
          evaluation,
          Boolean(transition),
        );
      }
    }
    await client.query("COMMIT");
    return queued;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function messageForPendingDelivery(delivery: PendingSmsRow): string {
  return formatFredAlertMessage({
    kind: delivery.transition_kind,
    scope: delivery.scope,
    buildingName: delivery.building_name,
    targetName: delivery.target_name,
    occurredAt: toIso(delivery.event_at) ?? new Date().toISOString(),
    failureThreshold: Number(delivery.failure_threshold),
    recoveryThreshold: Number(delivery.recovery_threshold),
  });
}

async function sendFallbackEmail(
  queued: QueuedTransition,
  runtime: FredAlertRuntimeConfig,
  reasonCode: string,
): Promise<boolean> {
  const emailReady = runtime.emailRecipients.length > 0 && isEmailConfigured();
  if (!runtime.recipientHashKey) {
    throw new Error("Fred recipient hashing is not configured.");
  }
  const recipientIdentity = emailReady
    ? runtime.emailRecipients.join(",")
    : "fred-email-unconfigured";
  const idempotencyKey = `${fredDeliveryBaseKey(
    queued.transition.idempotencyKey,
  )}.email.fallback`;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO fred_alert_deliveries (
       incident_id,
       transition_kind,
       channel,
       provider,
       recipient_hash,
       idempotency_key,
       status,
       error_code,
       attempted_at
     ) VALUES ($1::uuid, $2, 'email', 'smtp', $3, $4, $5, $6, now())
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id::text`,
    [
      queued.incidentId,
      queued.transition.kind,
      hashFredRecipient(recipientIdentity, runtime.recipientHashKey),
      idempotencyKey,
      emailReady ? "sending" : "failed",
      emailReady ? reasonCode.slice(0, 100) : "email_not_configured",
    ],
  );
  const deliveryId = inserted.rows[0]?.id;
  if (!deliveryId) return true;
  if (!emailReady) {
    await pool.query(
      `UPDATE fred_alert_deliveries
       SET failed_at = now(),
           error_message_redacted = 'Fred email fallback is not configured',
           updated_at = now()
       WHERE id = $1::uuid`,
      [deliveryId],
    );
    logger.warn(
      { incidentId: queued.incidentId },
      "Fred email fallback is unavailable",
    );
    return false;
  }
  const text = formatFredAlertMessage({
    ...queued.transition,
    targetName:
      queued.transition.scope === "switch"
        ? (queued.anchor.children.find(
            (child) => child.switchId === queued.transition.targetId,
          )?.hostname ?? queued.transition.targetName)
        : queued.transition.targetName,
    failureThreshold: queued.anchor.failureThreshold,
    recoveryThreshold: queued.anchor.recoveryThreshold,
  });
  try {
    await sendReportEmail({
      to: runtime.emailRecipients,
      subject:
        queued.transition.kind === "outage"
          ? `Fred outage: ${queued.transition.buildingName}`
          : `Fred recovery: ${queued.transition.buildingName}`,
      text,
    });
  } catch {
    await pool.query(
      `UPDATE fred_alert_deliveries
       SET status = 'failed', failed_at = now(), provider_error_code = 'smtp_failed',
           provider_error_detail_redacted = 'SMTP delivery failed', updated_at = now()
       WHERE id = $1::uuid`,
      [deliveryId],
    );
    return false;
  }
  // Record only SMTP-server acceptance. If this audit update fails, leave the
  // row ambiguous so reconciliation cannot submit the same email again.
  await markFredFallbackEmailAccepted(deliveryId);
  return true;
}

export async function markFredFallbackEmailAccepted(
  deliveryId: string,
  database: FredDbExecutor = pool,
): Promise<void> {
  await database.query(
    `UPDATE fred_alert_deliveries
     SET status = 'accepted', accepted_at = now(),
         provider_status = 'accepted', provider_error_code = null,
         provider_error_title = null, provider_error_detail_redacted = null,
         updated_at = now()
     WHERE id = $1::uuid`,
    [deliveryId],
  );
}

async function attemptFallbackEmail(
  queued: QueuedTransition,
  runtime: FredAlertRuntimeConfig,
  reasonCode: string,
): Promise<boolean> {
  try {
    return await sendFallbackEmail(queued, runtime, reasonCode);
  } catch (error) {
    logger.error(
      {
        incidentId: queued.incidentId,
        transitionKind: queued.transition.kind,
        err: error instanceof Error ? error.message : "unknown",
      },
      "Fred could not audit or submit an email fallback",
    );
    return false;
  }
}

async function loadQueuedTransitionByIncident(
  incidentId: string,
  requestedKind: "outage" | "recovery",
): Promise<QueuedTransition | null> {
  const result = await pool.query<{
    incident_id: string;
    anchor_id: string;
    building_key: string;
    building_name: string;
    anchor_switch_id: string;
    anchor_hostname: string;
    anchor_host: string;
    failure_threshold: number;
    recovery_threshold: number;
    scope: "building" | "switch";
    target_id: string;
    target_name: string;
    status: "open" | "acknowledged" | "resolved";
    outage_idempotency_key: string;
    recovery_idempotency_key: string | null;
    opened_at: Date | string;
    opened_observation_at: Date | string;
    resolved_at: Date | string | null;
    recovery_observation_at: Date | string | null;
  }>(
    `SELECT
       i.id::text AS incident_id,
       a.id::text AS anchor_id,
       a.building_key,
       a.building_name,
       a.anchor_switch_id::text,
       anchor_switch.hostname AS anchor_hostname,
       anchor_switch.ip_address AS anchor_host,
       a.failure_threshold,
       a.recovery_threshold,
       i.scope,
       i.target_id,
       i.target_name,
       i.status,
       i.outage_idempotency_key,
       i.recovery_idempotency_key,
       i.opened_at,
       i.opened_observation_at,
       i.resolved_at,
       i.recovery_observation_at
     FROM fred_building_incidents i
     JOIN fred_building_anchors a ON a.id = i.building_anchor_id
     JOIN network_switches anchor_switch ON anchor_switch.id = a.anchor_switch_id
     WHERE i.id = $1::uuid`,
    [incidentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const isRecovery = requestedKind === "recovery";
  if (isRecovery && !row.recovery_idempotency_key) return null;
  const occurredAt = toIso(isRecovery ? row.resolved_at : row.opened_at);
  const observationAt = toIso(
    isRecovery ? row.recovery_observation_at : row.opened_observation_at,
  );
  if (!occurredAt || !observationAt) return null;
  const transition: FredAlertTransition = {
    kind: isRecovery ? "recovery" : "outage",
    scope: row.scope,
    buildingId: row.building_key,
    buildingName: row.building_name,
    targetId: row.target_id,
    targetName: row.target_name,
    anchorSwitchId: row.anchor_switch_id,
    incidentId: row.incident_id,
    idempotencyKey: isRecovery
      ? row.recovery_idempotency_key!
      : row.outage_idempotency_key,
    occurredAt,
    observationAt,
  };
  return {
    transition,
    incidentId: row.incident_id,
    anchor: {
      id: row.anchor_id,
      buildingKey: row.building_key,
      buildingName: row.building_name,
      anchorSwitchId: row.anchor_switch_id,
      anchorHostname: row.anchor_hostname,
      anchorHost: row.anchor_host,
      failureThreshold: Number(row.failure_threshold),
      recoveryThreshold: Number(row.recovery_threshold),
      children: [],
    },
  };
}

export async function markStaleFredSmsSubmissionsUnknown(
  database: FredDbExecutor = pool,
): Promise<void> {
  await database.query(`
    UPDATE fred_alert_deliveries
    SET status = 'unknown',
        error_code = 'ambiguous_restart',
        error_message_redacted =
          'The service restarted before Telnyx acceptance could be confirmed',
        updated_at = now()
    WHERE channel = 'sms'
      AND provider = 'telnyx'
      AND status = 'sending'
      AND attempted_at < now() - interval '2 minutes'
  `);
}

export async function markFredQueuedSmsConfigUnavailable(
  database: FredDbExecutor = pool,
): Promise<void> {
  await database.query(`
    UPDATE fred_alert_deliveries
    SET status = 'failed',
        failed_at = now(),
        error_code = 'config_unavailable',
        error_message_redacted =
          'Telnyx configuration is unavailable; the queued message was never submitted',
        updated_at = now()
    WHERE channel = 'sms'
      AND provider = 'telnyx'
      AND status = 'queued'
  `);
}

export async function markStaleFredEmailSubmissionsUnknown(
  database: FredDbExecutor = pool,
): Promise<void> {
  await database.query(`
    UPDATE fred_alert_deliveries
    SET status = 'unknown',
        error_code = 'ambiguous_restart',
        error_message_redacted =
          'The service restarted before SMTP delivery could be confirmed',
        updated_at = now()
    WHERE channel = 'email'
      AND provider = 'smtp'
      AND status = 'sending'
      AND attempted_at < now() - interval '2 minutes'
  `);
}

export type FredFallbackDeliverySnapshot = {
  hasEmailFallback: boolean;
  deliverySuppressed: boolean;
  smsStatuses: readonly string[];
};

export function needsFredFallbackEmail(
  snapshot: FredFallbackDeliverySnapshot,
): boolean {
  if (snapshot.hasEmailFallback || snapshot.deliverySuppressed) return false;
  return (
    snapshot.smsStatuses.length === 0 ||
    snapshot.smsStatuses.some(
      (status) => status === "failed" || status === "unknown",
    )
  );
}

export async function findFredFallbackCandidates(
  database: FredDbExecutor = pool,
): Promise<
  Array<{ incidentId: string; transitionKind: "outage" | "recovery" }>
> {
  const result = await database.query<{
    incident_id: string;
    transition_kind: "outage" | "recovery";
  }>(`
    WITH transitions AS (
      SELECT id AS incident_id, 'outage'::varchar AS transition_kind
      FROM fred_building_incidents
      WHERE outage_idempotency_key IS NOT NULL
      UNION ALL
      SELECT id AS incident_id, 'recovery'::varchar AS transition_kind
      FROM fred_building_incidents
      WHERE recovery_idempotency_key IS NOT NULL
        AND resolved_at IS NOT NULL
        AND recovery_observation_at IS NOT NULL
    )
    SELECT transition.incident_id::text, transition.transition_kind
    FROM transitions transition
    WHERE NOT EXISTS (
      SELECT 1
      FROM fred_alert_deliveries email_delivery
      WHERE email_delivery.incident_id = transition.incident_id
        AND email_delivery.transition_kind = transition.transition_kind
        AND email_delivery.channel = 'email'
    )
      AND NOT EXISTS (
        SELECT 1
        FROM fred_alert_deliveries policy_delivery
        WHERE policy_delivery.incident_id = transition.incident_id
          AND policy_delivery.transition_kind = transition.transition_kind
          AND policy_delivery.provider = 'fred_policy'
          AND policy_delivery.error_code = 'suppressed_by_policy'
      )
      AND (
        NOT EXISTS (
          SELECT 1
          FROM fred_alert_deliveries sms_delivery
          WHERE sms_delivery.incident_id = transition.incident_id
            AND sms_delivery.transition_kind = transition.transition_kind
            AND sms_delivery.channel = 'sms'
            AND sms_delivery.provider = 'telnyx'
        )
        OR EXISTS (
          SELECT 1
          FROM fred_alert_deliveries sms_delivery
          WHERE sms_delivery.incident_id = transition.incident_id
            AND sms_delivery.transition_kind = transition.transition_kind
            AND sms_delivery.channel = 'sms'
            AND sms_delivery.provider = 'telnyx'
            AND sms_delivery.status IN ('failed', 'unknown')
        )
      )
    ORDER BY transition.incident_id, transition.transition_kind
    LIMIT 100
  `);
  return result.rows.map((row) => ({
    incidentId: row.incident_id,
    transitionKind: row.transition_kind,
  }));
}

async function reconcileFredFallbackEmails(
  runtime: FredAlertRuntimeConfig,
  telnyxAvailable: boolean | null,
): Promise<boolean> {
  let healthy = true;
  if (telnyxAvailable === false) {
    await markFredQueuedSmsConfigUnavailable();
  }
  await markStaleFredSmsSubmissionsUnknown();
  await markStaleFredEmailSubmissionsUnknown();
  const candidates = await findFredFallbackCandidates();
  for (const candidate of candidates) {
    try {
      const queued = await loadQueuedTransitionByIncident(
        candidate.incidentId,
        candidate.transitionKind,
      );
      if (queued) {
        healthy =
          (await attemptFallbackEmail(queued, runtime, "sms_unavailable")) &&
          healthy;
      }
    } catch (error) {
      healthy = false;
      logger.error(
        {
          incidentId: candidate.incidentId,
          transitionKind: candidate.transitionKind,
          err: error instanceof Error ? error.message : "unknown",
        },
        "Fred could not reconcile an email fallback",
      );
    }
  }
  return healthy;
}

async function drainQueuedSms(
  runtime: FredAlertRuntimeConfig,
  telnyx: FredTelnyxConfig,
  queuedTransitions: readonly QueuedTransition[],
): Promise<boolean> {
  if (!runtime.webhookUrl || !runtime.webhookFailoverUrl) return false;
  const recipientByHash = new Map(
    telnyx.recipients.map((recipient) => [
      hashFredRecipient(recipient, telnyx.recipientHashKey),
      recipient,
    ]),
  );
  const result = await pool.query<PendingSmsRow>(`
    SELECT
      d.id::text,
      d.incident_id::text,
      d.idempotency_key,
      d.recipient_hash,
      d.recipient_last4,
      d.transition_kind,
      i.scope,
      i.target_name,
      a.building_name,
      a.failure_threshold,
      a.recovery_threshold,
      CASE
        WHEN d.transition_kind = 'recovery' THEN i.resolved_at
        ELSE i.opened_at
      END AS event_at
    FROM fred_alert_deliveries d
    JOIN fred_building_incidents i ON i.id = d.incident_id
    JOIN fred_building_anchors a ON a.id = i.building_anchor_id
    WHERE d.channel = 'sms'
      AND d.provider = 'telnyx'
      AND d.status = 'queued'
      AND d.transition_kind IN ('outage', 'recovery')
    ORDER BY d.queued_at
    LIMIT 50
  `);

  const failedTransitions = new Map<
    string,
    { incidentId: string; transitionKind: "outage" | "recovery" }
  >();
  for (const delivery of result.rows) {
    const recipient = recipientByHash.get(delivery.recipient_hash);
    if (!recipient) {
      await pool.query(
        `UPDATE fred_alert_deliveries
         SET status = 'failed', failed_at = now(),
             provider_error_code = 'recipient_not_configured', updated_at = now()
         WHERE id = $1::uuid AND status = 'queued'`,
        [delivery.id],
      );
      failedTransitions.set(
        `${delivery.incident_id}:${delivery.transition_kind}`,
        {
          incidentId: delivery.incident_id,
          transitionKind: delivery.transition_kind,
        },
      );
      continue;
    }
    const claimed = await pool.query<{ id: string }>(
      `UPDATE fred_alert_deliveries
       SET status = 'sending', attempted_at = now(), updated_at = now()
       WHERE id = $1::uuid AND status = 'queued'
       RETURNING id::text`,
      [delivery.id],
    );
    if (!claimed.rows[0]) continue;
    const startedAt = Date.now();
    try {
      const accepted = await sendFredSms(
        {
          to: recipient,
          text: messageForPendingDelivery(delivery),
          idempotencyKey: delivery.idempotency_key,
          webhookUrl: runtime.webhookUrl,
          webhookFailoverUrl: runtime.webhookFailoverUrl,
        },
        { config: telnyx },
      );
      await pool.query(
        `UPDATE fred_alert_deliveries
         SET status = 'accepted', provider_message_id = $2,
             provider_status = $3, accepted_at = now(), duration_ms = $4,
             updated_at = now()
         WHERE id = $1::uuid`,
        [
          delivery.id,
          accepted.providerMessageId,
          accepted.providerStatus,
          Date.now() - startedAt,
        ],
      );
      logger.info(
        { deliveryId: delivery.id, recipient: accepted.recipientToken },
        "Fred SMS accepted by Telnyx",
      );
    } catch (error) {
      const failure = describeFredTelnyxError(error);
      const status =
        failure.code === "api" && !failure.retryable ? "failed" : "unknown";
      await pool.query(
        `UPDATE fred_alert_deliveries
         SET status = $2, failed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END,
             provider_http_status = $3, provider_error_code = $4,
             provider_error_detail_redacted = $5, duration_ms = $6,
             updated_at = now()
         WHERE id = $1::uuid`,
        [
          delivery.id,
          status,
          failure.httpStatus ?? null,
          failure.providerCode ?? failure.code,
          failure.message.slice(0, 500),
          Date.now() - startedAt,
        ],
      );
      failedTransitions.set(
        `${delivery.incident_id}:${delivery.transition_kind}`,
        {
          incidentId: delivery.incident_id,
          transitionKind: delivery.transition_kind,
        },
      );
      logger.error(
        {
          deliveryId: delivery.id,
          recipient: delivery.recipient_last4
            ? `***${delivery.recipient_last4}`
            : "redacted",
          code: failure.code,
        },
        "Fred SMS was not confirmed accepted",
      );
    }
  }

  let fallbackHealthy = true;
  for (const { incidentId, transitionKind } of failedTransitions.values()) {
    const queued =
      queuedTransitions.find(
        (item) =>
          item.incidentId === incidentId &&
          item.transition.kind === transitionKind,
      ) ?? (await loadQueuedTransitionByIncident(incidentId, transitionKind));
    if (queued) {
      fallbackHealthy =
        (await attemptFallbackEmail(queued, runtime, "sms_failed")) &&
        fallbackHealthy;
    }
  }
  return fallbackHealthy;
}

export async function runFredBuildingAlertTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  let runtime: FredAlertRuntimeConfig | null = null;
  let lease: FredPollLease | null = null;
  let telnyx: FredTelnyxConfig | null | undefined;
  let mayReconcileDeliveries = false;
  let healthErrorCode: FredAlertWorkerErrorCode | null = null;
  try {
    runtime = loadFredAlertRuntimeConfig();
    if (!runtime.enabled) {
      setFredAlertWorkerDisabled();
      return;
    }
    lease = await acquireFredBuildingAlertPollLease(runtime.pollIntervalMs);
    if (!lease) return;
    telnyx = safelyLoadTelnyxConfig();
    if (!telnyx) healthErrorCode = "sms_configuration_invalid";
    const anchors = await loadEnabledAnchors();
    if (anchors.length === 0) {
      healthErrorCode = "no_enabled_anchors";
      logger.warn(
        "Fred alerts are enabled but no building anchors are enabled",
      );
      return;
    }
    validateFredEnabledAnchorTopology(anchors);
    const monitoringTargets = anchors.flatMap((anchor) => [
      { switchId: anchor.anchorSwitchId, host: anchor.anchorHost },
      ...anchor.children.map((child) => ({
        switchId: child.switchId,
        host: child.host,
      })),
    ]);
    const observations = await getFredSwitchObservations(monitoringTargets);
    const queued = await evaluateAndPersist(
      anchors,
      observations,
      runtime,
      telnyx,
      lease,
    );
    if (queued === null) {
      healthErrorCode = "lease_lost";
      logger.warn("Fred discarded a monitoring cycle after losing its lease");
      return;
    }
    const completedLease = await completeFredBuildingAlertPollLease(lease);
    lease = null;
    if (!completedLease) {
      healthErrorCode = "lease_lost";
      logger.warn(
        "Fred did not drain deliveries because the monitoring lease changed owners",
      );
      return;
    }
    mayReconcileDeliveries = true;
    if (telnyx) {
      if (!(await drainQueuedSms(runtime, telnyx, queued))) {
        healthErrorCode = "fallback_failed";
      }
    } else {
      for (const transition of queued) {
        if (
          !(await attemptFallbackEmail(
            transition,
            runtime,
            "sms_not_configured",
          ))
        ) {
          healthErrorCode = "fallback_failed";
        }
      }
    }
  } catch (error) {
    healthErrorCode ??= "tick_failed";
    logger.error(
      { err: error instanceof Error ? error.message : "unknown" },
      "Fred building alert tick failed",
    );
  } finally {
    if (lease) {
      try {
        mayReconcileDeliveries =
          await completeFredBuildingAlertPollLease(lease);
      } catch (error) {
        healthErrorCode = "tick_failed";
        logger.error(
          { err: error instanceof Error ? error.message : "unknown" },
          "Fred could not complete the durable poll lease",
        );
      }
      lease = null;
    }
    if (runtime?.enabled && mayReconcileDeliveries) {
      try {
        if (
          !(await reconcileFredFallbackEmails(
            runtime,
            telnyx === undefined ? null : telnyx !== null,
          ))
        ) {
          healthErrorCode = "fallback_failed";
        }
      } catch (error) {
        healthErrorCode = "fallback_failed";
        logger.error(
          { err: error instanceof Error ? error.message : "unknown" },
          "Fred fallback reconciliation failed",
        );
      }
    }
    if (healthErrorCode) {
      setFredAlertWorkerDegraded(healthErrorCode);
    } else if (runtime?.enabled) {
      setFredAlertWorkerOk();
    }
    tickRunning = false;
  }
}

export async function startFredBuildingAlerts(
  runtime: FredAlertRuntimeConfig = prepareFredBuildingAlerts(),
): Promise<() => void> {
  if (timer) return () => undefined;
  if (runtime.enabled) setFredAlertWorkerStarting();
  try {
    const inserted = await seedFredBuildingAnchorCandidates();
    if (inserted > 0) {
      logger.info(
        { inserted },
        "Fred created disabled single-switch building anchor candidates",
      );
    }
  } catch (error) {
    if (runtime.enabled) setFredAlertWorkerDegraded("anchor_seed_failed");
    logger.error(
      { err: error instanceof Error ? error.message : "unknown" },
      "Fred could not seed building anchor candidates",
    );
  }

  if (!runtime.enabled) {
    setFredAlertWorkerDisabled();
    logger.info("Fred building alert worker is disabled");
    return () => undefined;
  }

  void runFredBuildingAlertTick();
  timer = setInterval(
    () => void runFredBuildingAlertTick(),
    runtime.pollIntervalMs,
  );
  timer.unref();
  logger.info(
    { pollIntervalMs: runtime.pollIntervalMs },
    "Fred building alert worker started",
  );
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

async function updateTestDeliveryFailure(
  deliveryId: string,
  error: unknown,
  durationMs: number,
): Promise<FredTestDeliveryResult> {
  const failure = describeFredTelnyxError(error);
  const status =
    failure.code === "api" && !failure.retryable ? "failed" : "unknown";
  await pool.query(
    `UPDATE fred_alert_deliveries
     SET status = $2, failed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END,
         provider_http_status = $3, provider_error_code = $4,
         provider_error_detail_redacted = $5, duration_ms = $6,
         updated_at = now()
     WHERE id = $1::uuid`,
    [
      deliveryId,
      status,
      failure.httpStatus ?? null,
      failure.providerCode ?? failure.code,
      failure.message.slice(0, 500),
      durationMs,
    ],
  );
  return {
    recipientToken: "redacted",
    status: "failed",
    errorCode: failure.code,
  };
}

/** Send the fixed, explicitly non-outage message and audit every recipient. */
export async function sendFredTestAlert(): Promise<FredTestDeliveryResult[]> {
  const runtime = loadFredAlertRuntimeConfig({
    ...process.env,
    // A test verifies delivery without enabling the monitoring worker.
    FRED_ALERT_ENABLED: "false",
  });
  if (!runtime.webhookUrl || !runtime.webhookFailoverUrl) {
    throw new Error(
      "FRED_PUBLIC_BASE_URL is required to send a Fred test alert.",
    );
  }
  const telnyx = loadFredTelnyxConfig();
  const runKey = `fred-test:${randomUUID()}`;
  const results: FredTestDeliveryResult[] = [];

  for (const recipient of telnyx.recipients) {
    const idempotencyKey = fredRecipientIdempotencyKey(
      fredDeliveryBaseKey(runKey),
      recipient,
      telnyx.recipientHashKey,
    );
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO fred_alert_deliveries (
         incident_id,
         transition_kind,
         channel,
         provider,
         recipient_hash,
         recipient_last4,
         idempotency_key,
         status,
         attempted_at
       ) VALUES (NULL, 'test', 'sms', 'telnyx', $1, $2, $3, 'sending', now())
       RETURNING id::text`,
      [
        hashFredRecipient(recipient, telnyx.recipientHashKey),
        recipient.slice(-4),
        idempotencyKey,
      ],
    );
    const deliveryId = inserted.rows[0].id;
    const startedAt = Date.now();
    try {
      const accepted = await sendFredSms(
        {
          to: recipient,
          text: FRED_TEST_MESSAGE,
          idempotencyKey,
          webhookUrl: runtime.webhookUrl,
          webhookFailoverUrl: runtime.webhookFailoverUrl,
        },
        { config: telnyx },
      );
      await pool.query(
        `UPDATE fred_alert_deliveries
         SET status = 'accepted', provider_message_id = $2,
             provider_status = $3, attempted_at = now(), accepted_at = now(),
             duration_ms = $4, updated_at = now()
         WHERE id = $1::uuid`,
        [
          deliveryId,
          accepted.providerMessageId,
          accepted.providerStatus,
          Date.now() - startedAt,
        ],
      );
      results.push({
        recipientToken: accepted.recipientToken,
        status: "accepted",
        providerStatus: accepted.providerStatus,
      });
    } catch (error) {
      const failed = await updateTestDeliveryFailure(
        deliveryId,
        error,
        Date.now() - startedAt,
      );
      results.push({
        ...failed,
        recipientToken: fredRecipientToken(recipient),
      });
    }
  }
  return results;
}
