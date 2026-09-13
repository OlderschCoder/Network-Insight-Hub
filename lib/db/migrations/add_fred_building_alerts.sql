BEGIN;

CREATE TABLE IF NOT EXISTS fred_building_alert_poll_leases (
  lease_name VARCHAR(80) PRIMARY KEY,
  lease_token UUID NOT NULL,
  leased_until TIMESTAMPTZ NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fred_building_alert_poll_leases_expiry_idx
  ON fred_building_alert_poll_leases (leased_until);

COMMENT ON TABLE fred_building_alert_poll_leases IS
  'Durable cross-replica leases. A monitoring lease remains held for at least one configured poll interval.';

CREATE TABLE IF NOT EXISTS fred_building_anchors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_key VARCHAR(160) NOT NULL,
  building_name VARCHAR(255) NOT NULL,
  anchor_switch_id INTEGER NOT NULL REFERENCES network_switches(id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  failure_threshold INTEGER NOT NULL DEFAULT 3,
  recovery_threshold INTEGER NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fred_building_anchors_failure_threshold_ck CHECK (failure_threshold > 0),
  CONSTRAINT fred_building_anchors_recovery_threshold_ck CHECK (recovery_threshold > 0),
  CONSTRAINT fred_building_anchors_building_key_normalized_ck
    CHECK (building_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT fred_building_anchors_building_name_nonempty_ck
    CHECK (BTRIM(building_name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS fred_building_anchors_building_key_uq
  ON fred_building_anchors (building_key);
CREATE UNIQUE INDEX IF NOT EXISTS fred_building_anchors_building_name_normalized_uq
  ON fred_building_anchors (LOWER(BTRIM(building_name)));
CREATE UNIQUE INDEX IF NOT EXISTS fred_building_anchors_anchor_switch_uq
  ON fred_building_anchors (anchor_switch_id);

CREATE TABLE IF NOT EXISTS fred_building_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_anchor_id UUID NOT NULL REFERENCES fred_building_anchors(id) ON DELETE RESTRICT,
  scope VARCHAR(20) NOT NULL,
  target_id VARCHAR(160) NOT NULL,
  target_name VARCHAR(255) NOT NULL,
  anchor_switch_id INTEGER NOT NULL REFERENCES network_switches(id) ON DELETE RESTRICT,
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  outage_idempotency_key VARCHAR(255) NOT NULL,
  recovery_idempotency_key VARCHAR(255),
  opened_at TIMESTAMPTZ NOT NULL,
  opened_observation_at TIMESTAMPTZ NOT NULL,
  last_observed_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  recovery_observation_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acknowledgement_note TEXT,
  assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fred_building_incidents_scope_ck CHECK (scope IN ('building', 'switch')),
  CONSTRAINT fred_building_incidents_status_ck
    CHECK (status IN ('open', 'acknowledged', 'resolved'))
);

CREATE UNIQUE INDEX IF NOT EXISTS fred_building_incidents_outage_idempotency_uq
  ON fred_building_incidents (outage_idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS fred_building_incidents_recovery_idempotency_uq
  ON fred_building_incidents (recovery_idempotency_key)
  WHERE recovery_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fred_building_incidents_one_active_target_uq
  ON fred_building_incidents (building_anchor_id, scope, target_id)
  WHERE status IN ('open', 'acknowledged');
CREATE INDEX IF NOT EXISTS fred_building_incidents_anchor_status_idx
  ON fred_building_incidents (building_anchor_id, status);
CREATE INDEX IF NOT EXISTS fred_building_incidents_target_idx
  ON fred_building_incidents (scope, target_id);

CREATE TABLE IF NOT EXISTS fred_building_alert_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_anchor_id UUID NOT NULL REFERENCES fred_building_anchors(id) ON DELETE RESTRICT,
  scope VARCHAR(20) NOT NULL,
  target_id VARCHAR(160) NOT NULL,
  target_name VARCHAR(255) NOT NULL,
  phase VARCHAR(20) NOT NULL DEFAULT 'normal',
  last_observed_status VARCHAR(40) NOT NULL DEFAULT 'unknown',
  consecutive_fresh_downs INTEGER NOT NULL DEFAULT 0,
  consecutive_fresh_ups INTEGER NOT NULL DEFAULT 0,
  down_sequence_started_at TIMESTAMPTZ,
  active_incident_id UUID REFERENCES fred_building_incidents(id) ON DELETE SET NULL,
  last_processed_observation_at TIMESTAMPTZ,
  last_transition_at TIMESTAMPTZ,
  state_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fred_building_alert_states_scope_ck CHECK (scope IN ('building', 'switch')),
  CONSTRAINT fred_building_alert_states_phase_ck CHECK (phase IN ('normal', 'outage')),
  CONSTRAINT fred_building_alert_states_fresh_downs_ck CHECK (consecutive_fresh_downs >= 0),
  CONSTRAINT fred_building_alert_states_fresh_ups_ck CHECK (consecutive_fresh_ups >= 0),
  CONSTRAINT fred_building_alert_states_state_version_ck CHECK (state_version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS fred_building_alert_states_target_uq
  ON fred_building_alert_states (building_anchor_id, scope, target_id);
CREATE INDEX IF NOT EXISTS fred_building_alert_states_active_incident_idx
  ON fred_building_alert_states (active_incident_id);

CREATE TABLE IF NOT EXISTS fred_building_alert_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_anchor_id UUID NOT NULL REFERENCES fred_building_anchors(id) ON DELETE RESTRICT,
  scope VARCHAR(20) NOT NULL,
  target_id VARCHAR(160) NOT NULL,
  kind VARCHAR(24) NOT NULL,
  reason TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(255) NOT NULL,
  revoked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  revoked_by_name VARCHAR(255),
  idempotency_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fred_building_alert_suppressions_scope_ck CHECK (scope IN ('building', 'switch')),
  CONSTRAINT fred_building_alert_suppressions_kind_ck CHECK (kind IN ('mute', 'maintenance')),
  CONSTRAINT fred_building_alert_suppressions_window_ck
    CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS fred_building_alert_suppressions_idempotency_uq
  ON fred_building_alert_suppressions (idempotency_key);
CREATE INDEX IF NOT EXISTS fred_building_alert_suppressions_active_idx
  ON fred_building_alert_suppressions (
    building_anchor_id,
    scope,
    target_id,
    starts_at,
    ends_at
  );

CREATE TABLE IF NOT EXISTS fred_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES fred_building_incidents(id) ON DELETE RESTRICT,
  transition_kind VARCHAR(32) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  recipient_hash VARCHAR(128) NOT NULL,
  recipient_last4 VARCHAR(4),
  idempotency_key VARCHAR(255) NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  provider_message_id VARCHAR(255),
  provider_status VARCHAR(80),
  provider_http_status INTEGER,
  duration_ms INTEGER,
  error_code VARCHAR(100),
  error_message_redacted TEXT,
  retryable BOOLEAN,
  provider_error_code VARCHAR(100),
  provider_error_title VARCHAR(255),
  provider_error_detail_redacted TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempted_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fred_alert_deliveries_transition_kind_ck
    CHECK (transition_kind IN ('outage', 'recovery', 'escalation', 'unknown_warning', 'test')),
  CONSTRAINT fred_alert_deliveries_channel_ck CHECK (channel IN ('sms', 'voice', 'email')),
  CONSTRAINT fred_alert_deliveries_attempt_ck CHECK (attempt_number > 0),
  CONSTRAINT fred_alert_deliveries_status_ck
    CHECK (status IN ('queued', 'sending', 'accepted', 'delivered', 'failed', 'unknown')),
  CONSTRAINT fred_alert_deliveries_recipient_hash_ck
    CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT fred_alert_deliveries_recipient_last4_ck
    CHECK (recipient_last4 IS NULL OR recipient_last4 ~ '^[0-9]{4}$'),
  CONSTRAINT fred_alert_deliveries_http_status_ck
    CHECK (provider_http_status IS NULL OR provider_http_status BETWEEN 100 AND 599),
  CONSTRAINT fred_alert_deliveries_duration_ck CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS fred_alert_deliveries_idempotency_uq
  ON fred_alert_deliveries (idempotency_key);
CREATE INDEX IF NOT EXISTS fred_alert_deliveries_incident_idx
  ON fred_alert_deliveries (incident_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS fred_alert_deliveries_provider_message_uq
  ON fred_alert_deliveries (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMENT ON COLUMN fred_alert_deliveries.recipient_hash IS
  'HMAC-SHA-256 of the normalized recipient using a separate service secret. Never store the full phone number.';
COMMENT ON COLUMN fred_alert_deliveries.recipient_last4 IS
  'Optional final four digits for operator correlation. Never store the full phone number.';
COMMENT ON COLUMN fred_alert_deliveries.provider_error_detail_redacted IS
  'Provider detail after removing phone numbers, credentials, and other sensitive values.';
COMMENT ON COLUMN fred_alert_deliveries.error_message_redacted IS
  'Application error message after removing phone numbers, credentials, and other sensitive values.';

CREATE TABLE IF NOT EXISTS fred_webhook_event_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(40) NOT NULL,
  provider_event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  provider_message_id VARCHAR(255),
  delivery_id UUID REFERENCES fred_alert_deliveries(id) ON DELETE SET NULL,
  payload_sha256 VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'claimed',
  claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
  claim_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  event_occurred_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_error_code VARCHAR(100),
  last_error_detail_redacted TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fred_webhook_event_claims_status_ck
    CHECK (status IN ('claimed', 'processed', 'failed')),
  CONSTRAINT fred_webhook_event_claims_attempt_ck CHECK (attempt_count > 0),
  CONSTRAINT fred_webhook_event_claims_payload_hash_ck
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS fred_webhook_event_claims_provider_event_uq
  ON fred_webhook_event_claims (provider, provider_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS fred_webhook_event_claims_claim_token_uq
  ON fred_webhook_event_claims (claim_token);
CREATE INDEX IF NOT EXISTS fred_webhook_event_claims_status_lease_idx
  ON fred_webhook_event_claims (status, claim_expires_at);
CREATE INDEX IF NOT EXISTS fred_webhook_event_claims_provider_message_idx
  ON fred_webhook_event_claims (provider, provider_message_id);

COMMENT ON COLUMN fred_webhook_event_claims.payload_sha256 IS
  'SHA-256 of canonical authenticated event data; the raw payload is intentionally not persisted.';
COMMENT ON COLUMN fred_webhook_event_claims.last_error_detail_redacted IS
  'Error detail after removing phone numbers, credentials, and other sensitive values.';

CREATE TABLE IF NOT EXISTS fred_building_alert_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_anchor_id UUID NOT NULL REFERENCES fred_building_anchors(id) ON DELETE RESTRICT,
  incident_id UUID REFERENCES fred_building_incidents(id) ON DELETE RESTRICT,
  action VARCHAR(32) NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name VARCHAR(255) NOT NULL,
  reason TEXT,
  idempotency_key VARCHAR(255) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fred_building_alert_actions_action_ck
    CHECK (
      action IN (
        'acknowledge',
        'assign',
        'mute',
        'unmute',
        'maintenance_start',
        'maintenance_end',
        'resolve',
        'reopen'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS fred_building_alert_actions_idempotency_uq
  ON fred_building_alert_actions (idempotency_key);
CREATE INDEX IF NOT EXISTS fred_building_alert_actions_anchor_created_idx
  ON fred_building_alert_actions (building_anchor_id, created_at);
CREATE INDEX IF NOT EXISTS fred_building_alert_actions_incident_idx
  ON fred_building_alert_actions (incident_id, created_at);

COMMIT;
