import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { networkSwitchesTable } from "./network_switches";
import { usersTable } from "./users";

export const fredBuildingAlertPollLeasesTable = pgTable(
  "fred_building_alert_poll_leases",
  {
    leaseName: varchar("lease_name", { length: 80 }).primaryKey(),
    leaseToken: uuid("lease_token").notNull(),
    leasedUntil: timestamp("leased_until", { withTimezone: true }).notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("fred_building_alert_poll_leases_expiry_idx").on(table.leasedUntil),
  ],
);

export const fredBuildingAnchorsTable = pgTable(
  "fred_building_anchors",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    buildingKey: varchar("building_key", { length: 160 }).notNull(),
    buildingName: varchar("building_name", { length: 255 }).notNull(),
    anchorSwitchId: integer("anchor_switch_id")
      .notNull()
      .references(() => networkSwitchesTable.id, { onDelete: "restrict" }),
    enabled: boolean("enabled").notNull().default(false),
    failureThreshold: integer("failure_threshold").notNull().default(3),
    recoveryThreshold: integer("recovery_threshold").notNull().default(2),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fred_building_anchors_building_key_uq").on(table.buildingKey),
    uniqueIndex("fred_building_anchors_building_name_normalized_uq").on(
      sql`lower(btrim(${table.buildingName}))`,
    ),
    uniqueIndex("fred_building_anchors_anchor_switch_uq").on(
      table.anchorSwitchId,
    ),
    check(
      "fred_building_anchors_building_key_normalized_ck",
      sql`${table.buildingKey} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "fred_building_anchors_building_name_nonempty_ck",
      sql`btrim(${table.buildingName}) <> ''`,
    ),
    check(
      "fred_building_anchors_failure_threshold_ck",
      sql`${table.failureThreshold} > 0`,
    ),
    check(
      "fred_building_anchors_recovery_threshold_ck",
      sql`${table.recoveryThreshold} > 0`,
    ),
  ],
);

export const fredBuildingIncidentsTable = pgTable(
  "fred_building_incidents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    buildingAnchorId: uuid("building_anchor_id")
      .notNull()
      .references(() => fredBuildingAnchorsTable.id, { onDelete: "restrict" }),
    scope: varchar("scope", { length: 20 }).notNull(),
    targetId: varchar("target_id", { length: 160 }).notNull(),
    targetName: varchar("target_name", { length: 255 }).notNull(),
    anchorSwitchId: integer("anchor_switch_id")
      .notNull()
      .references(() => networkSwitchesTable.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    outageIdempotencyKey: varchar("outage_idempotency_key", {
      length: 255,
    }).notNull(),
    recoveryIdempotencyKey: varchar("recovery_idempotency_key", {
      length: 255,
    }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    openedObservationAt: timestamp("opened_observation_at", {
      withTimezone: true,
    }).notNull(),
    lastObservedAt: timestamp("last_observed_at", {
      withTimezone: true,
    }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    recoveryObservationAt: timestamp("recovery_observation_at", {
      withTimezone: true,
    }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByUserId: integer("acknowledged_by_user_id").references(
      () => usersTable.id,
      {
        onDelete: "set null",
      },
    ),
    acknowledgementNote: text("acknowledgement_note"),
    assignedToUserId: integer("assigned_to_user_id").references(
      () => usersTable.id,
      {
        onDelete: "set null",
      },
    ),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fred_building_incidents_outage_idempotency_uq").on(
      table.outageIdempotencyKey,
    ),
    uniqueIndex("fred_building_incidents_recovery_idempotency_uq")
      .on(table.recoveryIdempotencyKey)
      .where(sql`${table.recoveryIdempotencyKey} is not null`),
    uniqueIndex("fred_building_incidents_one_active_target_uq")
      .on(table.buildingAnchorId, table.scope, table.targetId)
      .where(sql`${table.status} in ('open', 'acknowledged')`),
    index("fred_building_incidents_anchor_status_idx").on(
      table.buildingAnchorId,
      table.status,
    ),
    index("fred_building_incidents_target_idx").on(table.scope, table.targetId),
    check(
      "fred_building_incidents_scope_ck",
      sql`${table.scope} in ('building', 'switch')`,
    ),
    check(
      "fred_building_incidents_status_ck",
      sql`${table.status} in ('open', 'acknowledged', 'resolved')`,
    ),
  ],
);

export const fredBuildingAlertStatesTable = pgTable(
  "fred_building_alert_states",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    buildingAnchorId: uuid("building_anchor_id")
      .notNull()
      .references(() => fredBuildingAnchorsTable.id, { onDelete: "restrict" }),
    scope: varchar("scope", { length: 20 }).notNull(),
    targetId: varchar("target_id", { length: 160 }).notNull(),
    targetName: varchar("target_name", { length: 255 }).notNull(),
    phase: varchar("phase", { length: 20 }).notNull().default("normal"),
    lastObservedStatus: varchar("last_observed_status", { length: 40 })
      .notNull()
      .default("unknown"),
    consecutiveFreshDowns: integer("consecutive_fresh_downs")
      .notNull()
      .default(0),
    consecutiveFreshUps: integer("consecutive_fresh_ups").notNull().default(0),
    downSequenceStartedAt: timestamp("down_sequence_started_at", {
      withTimezone: true,
    }),
    activeIncidentId: uuid("active_incident_id").references(
      () => fredBuildingIncidentsTable.id,
      {
        onDelete: "set null",
      },
    ),
    lastProcessedObservationAt: timestamp("last_processed_observation_at", {
      withTimezone: true,
    }),
    lastTransitionAt: timestamp("last_transition_at", { withTimezone: true }),
    stateVersion: integer("state_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fred_building_alert_states_target_uq").on(
      table.buildingAnchorId,
      table.scope,
      table.targetId,
    ),
    index("fred_building_alert_states_active_incident_idx").on(
      table.activeIncidentId,
    ),
    check(
      "fred_building_alert_states_scope_ck",
      sql`${table.scope} in ('building', 'switch')`,
    ),
    check(
      "fred_building_alert_states_phase_ck",
      sql`${table.phase} in ('normal', 'outage')`,
    ),
    check(
      "fred_building_alert_states_fresh_downs_ck",
      sql`${table.consecutiveFreshDowns} >= 0`,
    ),
    check(
      "fred_building_alert_states_fresh_ups_ck",
      sql`${table.consecutiveFreshUps} >= 0`,
    ),
    check(
      "fred_building_alert_states_state_version_ck",
      sql`${table.stateVersion} > 0`,
    ),
  ],
);

export const fredBuildingAlertSuppressionsTable = pgTable(
  "fred_building_alert_suppressions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    buildingAnchorId: uuid("building_anchor_id")
      .notNull()
      .references(() => fredBuildingAnchorsTable.id, { onDelete: "restrict" }),
    scope: varchar("scope", { length: 20 }).notNull(),
    targetId: varchar("target_id", { length: 160 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull(),
    reason: text("reason").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: integer("created_by_user_id").references(
      () => usersTable.id,
      {
        onDelete: "set null",
      },
    ),
    createdByName: varchar("created_by_name", { length: 255 }).notNull(),
    revokedByUserId: integer("revoked_by_user_id").references(
      () => usersTable.id,
      {
        onDelete: "set null",
      },
    ),
    revokedByName: varchar("revoked_by_name", { length: 255 }),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fred_building_alert_suppressions_idempotency_uq").on(
      table.idempotencyKey,
    ),
    index("fred_building_alert_suppressions_active_idx").on(
      table.buildingAnchorId,
      table.scope,
      table.targetId,
      table.startsAt,
      table.endsAt,
    ),
    check(
      "fred_building_alert_suppressions_scope_ck",
      sql`${table.scope} in ('building', 'switch')`,
    ),
    check(
      "fred_building_alert_suppressions_kind_ck",
      sql`${table.kind} in ('mute', 'maintenance')`,
    ),
    check(
      "fred_building_alert_suppressions_window_ck",
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export const fredAlertDeliveriesTable = pgTable(
  "fred_alert_deliveries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    incidentId: uuid("incident_id").references(
      () => fredBuildingIncidentsTable.id,
      {
        onDelete: "restrict",
      },
    ),
    transitionKind: varchar("transition_kind", { length: 32 }).notNull(),
    channel: varchar("channel", { length: 20 }).notNull(),
    provider: varchar("provider", { length: 40 }).notNull(),
    recipientHash: varchar("recipient_hash", { length: 128 }).notNull(),
    recipientLast4: varchar("recipient_last4", { length: 4 }),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    attemptNumber: integer("attempt_number").notNull().default(1),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    providerStatus: varchar("provider_status", { length: 80 }),
    providerHttpStatus: integer("provider_http_status"),
    durationMs: integer("duration_ms"),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessageRedacted: text("error_message_redacted"),
    retryable: boolean("retryable"),
    providerErrorCode: varchar("provider_error_code", { length: 100 }),
    providerErrorTitle: varchar("provider_error_title", { length: 255 }),
    providerErrorDetailRedacted: text("provider_error_detail_redacted"),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fred_alert_deliveries_idempotency_uq").on(
      table.idempotencyKey,
    ),
    index("fred_alert_deliveries_incident_idx").on(
      table.incidentId,
      table.createdAt,
    ),
    uniqueIndex("fred_alert_deliveries_provider_message_uq")
      .on(table.provider, table.providerMessageId)
      .where(sql`${table.providerMessageId} is not null`),
    check(
      "fred_alert_deliveries_transition_kind_ck",
      sql`${table.transitionKind} in ('outage', 'recovery', 'escalation', 'unknown_warning', 'test')`,
    ),
    check(
      "fred_alert_deliveries_channel_ck",
      sql`${table.channel} in ('sms', 'voice', 'email')`,
    ),
    check("fred_alert_deliveries_attempt_ck", sql`${table.attemptNumber} > 0`),
    check(
      "fred_alert_deliveries_status_ck",
      sql`${table.status} in ('queued', 'sending', 'accepted', 'delivered', 'failed', 'unknown')`,
    ),
    check(
      "fred_alert_deliveries_recipient_hash_ck",
      sql`${table.recipientHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "fred_alert_deliveries_recipient_last4_ck",
      sql`${table.recipientLast4} is null or ${table.recipientLast4} ~ '^[0-9]{4}$'`,
    ),
    check(
      "fred_alert_deliveries_http_status_ck",
      sql`${table.providerHttpStatus} is null or (${table.providerHttpStatus} between 100 and 599)`,
    ),
    check(
      "fred_alert_deliveries_duration_ck",
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
  ],
);

export const fredWebhookEventClaimsTable = pgTable(
  "fred_webhook_event_claims",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    deliveryId: uuid("delivery_id").references(
      () => fredAlertDeliveriesTable.id,
      {
        onDelete: "set null",
      },
    ),
    payloadSha256: varchar("payload_sha256", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("claimed"),
    claimToken: uuid("claim_token")
      .notNull()
      .default(sql`gen_random_uuid()`),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '5 minutes'`),
    attemptCount: integer("attempt_count").notNull().default(1),
    eventOccurredAt: timestamp("event_occurred_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    lastErrorDetailRedacted: text("last_error_detail_redacted"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fred_webhook_event_claims_provider_event_uq").on(
      table.provider,
      table.providerEventId,
    ),
    uniqueIndex("fred_webhook_event_claims_claim_token_uq").on(
      table.claimToken,
    ),
    index("fred_webhook_event_claims_status_lease_idx").on(
      table.status,
      table.claimExpiresAt,
    ),
    index("fred_webhook_event_claims_provider_message_idx").on(
      table.provider,
      table.providerMessageId,
    ),
    check(
      "fred_webhook_event_claims_status_ck",
      sql`${table.status} in ('claimed', 'processed', 'failed')`,
    ),
    check(
      "fred_webhook_event_claims_attempt_ck",
      sql`${table.attemptCount} > 0`,
    ),
    check(
      "fred_webhook_event_claims_payload_hash_ck",
      sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const fredBuildingAlertActionsTable = pgTable(
  "fred_building_alert_actions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    buildingAnchorId: uuid("building_anchor_id")
      .notNull()
      .references(() => fredBuildingAnchorsTable.id, { onDelete: "restrict" }),
    incidentId: uuid("incident_id").references(
      () => fredBuildingIncidentsTable.id,
      {
        onDelete: "restrict",
      },
    ),
    action: varchar("action", { length: 32 }).notNull(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorName: varchar("actor_name", { length: 255 }).notNull(),
    reason: text("reason"),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fred_building_alert_actions_idempotency_uq").on(
      table.idempotencyKey,
    ),
    index("fred_building_alert_actions_anchor_created_idx").on(
      table.buildingAnchorId,
      table.createdAt,
    ),
    index("fred_building_alert_actions_incident_idx").on(
      table.incidentId,
      table.createdAt,
    ),
    check(
      "fred_building_alert_actions_action_ck",
      sql`${table.action} in ('acknowledge', 'assign', 'mute', 'unmute', 'maintenance_start', 'maintenance_end', 'resolve', 'reopen')`,
    ),
  ],
);

export type FredBuildingAnchor = typeof fredBuildingAnchorsTable.$inferSelect;
export type NewFredBuildingAnchor =
  typeof fredBuildingAnchorsTable.$inferInsert;
export type FredBuildingAlertPollLease =
  typeof fredBuildingAlertPollLeasesTable.$inferSelect;
export type NewFredBuildingAlertPollLease =
  typeof fredBuildingAlertPollLeasesTable.$inferInsert;
export type FredBuildingIncident =
  typeof fredBuildingIncidentsTable.$inferSelect;
export type NewFredBuildingIncident =
  typeof fredBuildingIncidentsTable.$inferInsert;
export type FredBuildingAlertState =
  typeof fredBuildingAlertStatesTable.$inferSelect;
export type NewFredBuildingAlertState =
  typeof fredBuildingAlertStatesTable.$inferInsert;
export type FredBuildingAlertSuppression =
  typeof fredBuildingAlertSuppressionsTable.$inferSelect;
export type NewFredBuildingAlertSuppression =
  typeof fredBuildingAlertSuppressionsTable.$inferInsert;
export type FredAlertDelivery = typeof fredAlertDeliveriesTable.$inferSelect;
export type NewFredAlertDelivery = typeof fredAlertDeliveriesTable.$inferInsert;
export type FredWebhookEventClaim =
  typeof fredWebhookEventClaimsTable.$inferSelect;
export type NewFredWebhookEventClaim =
  typeof fredWebhookEventClaimsTable.$inferInsert;
export type FredBuildingAlertAction =
  typeof fredBuildingAlertActionsTable.$inferSelect;
export type NewFredBuildingAlertAction =
  typeof fredBuildingAlertActionsTable.$inferInsert;
