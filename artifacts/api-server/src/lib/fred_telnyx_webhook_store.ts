import { pool } from "@workspace/db";
import type {
  FredTelnyxWebhookEvent,
  FredTelnyxWebhookRecordResult,
  FredTelnyxWebhookStore,
} from "./fred_telnyx_webhook";

interface FredWebhookQueryResult<Row> {
  rows: Row[];
}

interface FredWebhookClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<FredWebhookQueryResult<Row>>;
  release(): void;
}

interface FredWebhookPool {
  connect(): Promise<FredWebhookClient>;
}

interface ExistingClaimRow {
  id: string;
  payload_sha256: string;
  status: "claimed" | "processed" | "failed";
  lease_expired: boolean;
  delivery_id: string | null;
}

async function beginClaim(
  client: FredWebhookClient,
  event: FredTelnyxWebhookEvent,
): Promise<
  | { kind: "claimed"; claimId: string }
  | { kind: "duplicate"; matchedDelivery: boolean }
  | { kind: "busy" }
> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO fred_webhook_event_claims (
       provider,
       provider_event_id,
       event_type,
       provider_message_id,
       payload_sha256,
       event_occurred_at,
       status,
       claim_expires_at,
       claimed_at,
       created_at,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'claimed', now() + interval '5 minutes', now(), now(), now())
     ON CONFLICT (provider, provider_event_id) DO NOTHING
     RETURNING id`,
    [
      event.provider,
      event.eventId,
      event.eventType,
      event.providerMessageId,
      event.payloadSha256,
      event.eventOccurredAt,
    ],
  );
  if (inserted.rows[0]) {
    return { kind: "claimed", claimId: inserted.rows[0].id };
  }

  const existing = await client.query<ExistingClaimRow>(
    `SELECT id, payload_sha256, status, (claim_expires_at <= now()) AS lease_expired, delivery_id
       FROM fred_webhook_event_claims
      WHERE provider = $1 AND provider_event_id = $2
      FOR UPDATE`,
    [event.provider, event.eventId],
  );
  const claim = existing.rows[0];
  if (!claim) {
    // The unique conflict disappeared in another transaction. A provider retry
    // is safer than acknowledging an event we did not durably claim.
    return { kind: "busy" };
  }
  // Telnyx identifies duplicates by data.id. Retry metadata (for example,
  // attempt number or primary/failover destination) is excluded from the
  // stable event-data hash.
  if (claim.payload_sha256 !== event.payloadSha256) {
    await client.query(
      `UPDATE fred_webhook_event_claims
          SET last_error_code = 'event_data_hash_mismatch',
              last_error_detail_redacted = 'Authenticated duplicate event id contained different event data.',
              updated_at = now()
        WHERE id = $1`,
      [claim.id],
    );
    return { kind: "duplicate", matchedDelivery: claim.delivery_id !== null };
  }
  if (claim.status === "processed") {
    const requiresDeliveryMatch = Boolean(
      event.providerMessageId && event.deliveryStatus,
    );
    if (claim.delivery_id || !requiresDeliveryMatch) {
      return { kind: "duplicate", matchedDelivery: claim.delivery_id !== null };
    }
    // A delivery callback can beat the sender's provider-message-id update.
    // Re-open an unmatched processed claim so a provider retry can reconcile it.
  }

  if (claim.status === "claimed" && !claim.lease_expired) {
    return { kind: "busy" };
  }

  const reclaimed = await client.query<{ id: string }>(
    `UPDATE fred_webhook_event_claims
        SET status = 'claimed',
            claim_token = gen_random_uuid(),
            claim_expires_at = now() + interval '5 minutes',
            attempt_count = attempt_count + 1,
            failed_at = null,
            last_error_code = null,
            last_error_detail_redacted = null,
            claimed_at = now(),
            processed_at = null,
            updated_at = now()
      WHERE id = $1
      RETURNING id`,
    [claim.id],
  );
  return { kind: "claimed", claimId: reclaimed.rows[0]?.id ?? claim.id };
}

async function updateDelivery(
  client: FredWebhookClient,
  event: FredTelnyxWebhookEvent,
): Promise<{ deliveryId: string | null; retryLater: boolean }> {
  if (!event.providerMessageId || !event.deliveryStatus) {
    return { deliveryId: null, retryLater: false };
  }

  const effectiveAt = event.eventOccurredAt ?? new Date();
  const matched = await client.query<{ id: string }>(
    `SELECT id
       FROM fred_alert_deliveries
      WHERE provider = $1 AND provider_message_id = $2
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [event.provider, event.providerMessageId],
  );
  const deliveryId = matched.rows[0]?.id;
  if (!deliveryId) return { deliveryId: null, retryLater: true };

  await client.query(
    `UPDATE fred_alert_deliveries
        SET status = CASE
              WHEN status = 'delivered' THEN 'delivered'
              WHEN $3 = 'delivered' THEN 'delivered'
              WHEN status = 'failed' THEN 'failed'
              WHEN $3 = 'failed' THEN 'failed'
              WHEN status = 'unknown' THEN 'unknown'
              WHEN $3 = 'unknown' THEN 'unknown'
              WHEN status = 'accepted' AND $3 IN ('queued', 'sending') THEN 'accepted'
              WHEN status = 'sending' AND $3 = 'queued' THEN 'sending'
              ELSE $3
            END,
            provider_status = CASE
              WHEN status = 'delivered' AND $3 <> 'delivered' THEN provider_status
              WHEN status = 'failed' AND $3 NOT IN ('failed', 'delivered') THEN provider_status
              WHEN status = 'unknown' AND $3 NOT IN ('failed', 'delivered') THEN provider_status
              WHEN status = 'accepted' AND $3 IN ('queued', 'sending') THEN provider_status
              WHEN status = 'sending' AND $3 = 'queued' THEN provider_status
              ELSE $2
            END,
            accepted_at = CASE
              WHEN $3 IN ('accepted', 'delivered') THEN COALESCE(accepted_at, $4)
              ELSE accepted_at
            END,
            delivered_at = CASE
              WHEN $3 = 'delivered' THEN COALESCE(delivered_at, $4)
              ELSE delivered_at
            END,
            failed_at = CASE
              WHEN $3 = 'delivered' THEN null
              WHEN $3 = 'failed' AND status <> 'delivered' THEN COALESCE(failed_at, $4)
              ELSE failed_at
            END,
            provider_error_code = CASE
              WHEN $3 = 'delivered' THEN null
              WHEN $3 = 'failed' AND status <> 'delivered' THEN $5
              ELSE provider_error_code
            END,
            provider_error_title = CASE
              WHEN $3 = 'delivered' THEN null
              WHEN $3 = 'failed' AND status <> 'delivered' THEN 'Telnyx delivery failure'
              ELSE provider_error_title
            END,
            provider_error_detail_redacted = CASE
              WHEN $3 = 'delivered' THEN null
              WHEN $3 = 'failed' AND status <> 'delivered'
                THEN 'Telnyx reported a delivery failure; message content and recipient are redacted.'
              ELSE provider_error_detail_redacted
            END,
            updated_at = now()
      WHERE id = $7
        AND NOT EXISTS (
          SELECT 1
            FROM fred_webhook_event_claims newer
           WHERE newer.provider = $1
             AND newer.provider_message_id = $6
             AND newer.status = 'processed'
             AND newer.event_occurred_at IS NOT NULL
             AND newer.event_occurred_at > $4
        )`,
    [
      event.provider,
      event.providerStatus,
      event.deliveryStatus,
      effectiveAt,
      event.providerErrorCode,
      event.providerMessageId,
      deliveryId,
    ],
  );
  return { deliveryId, retryLater: false };
}

export class PostgresFredTelnyxWebhookStore implements FredTelnyxWebhookStore {
  constructor(private readonly databasePool: FredWebhookPool = pool) {}

  async record(
    event: FredTelnyxWebhookEvent,
  ): Promise<FredTelnyxWebhookRecordResult> {
    const client = await this.databasePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '1200ms'");
      await client.query("SET LOCAL lock_timeout = '750ms'");
      const claim = await beginClaim(client, event);
      if (claim.kind === "duplicate") {
        await client.query("COMMIT");
        return { duplicate: true, matchedDelivery: claim.matchedDelivery };
      }
      if (claim.kind === "busy") {
        await client.query("ROLLBACK");
        return { duplicate: false, matchedDelivery: false, retryLater: true };
      }

      const delivery = await updateDelivery(client, event);
      if (delivery.retryLater) {
        // The callback can beat the sender's provider_message_id update. Keep
        // durable, redacted evidence while returning a non-2xx so Telnyx
        // retries. A failed claim is immediately reclaimable on the next try.
        await client.query(
          `UPDATE fred_webhook_event_claims
              SET status = 'failed',
                  failed_at = now(),
                  claim_expires_at = now(),
                  last_error_code = 'delivery_match_pending',
                  last_error_detail_redacted = 'Provider message is not linked to a Fred delivery yet.',
                  updated_at = now()
            WHERE id = $1`,
          [claim.claimId],
        );
        await client.query("COMMIT");
        return { duplicate: false, matchedDelivery: false, retryLater: true };
      }
      await client.query(
        `UPDATE fred_webhook_event_claims
            SET status = 'processed',
                delivery_id = $2,
                processed_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [claim.claimId, delivery.deliveryId],
      );
      await client.query("COMMIT");
      return {
        duplicate: false,
        matchedDelivery: delivery.deliveryId !== null,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original database error is more useful to the caller. Neither is
        // logged here because query errors can contain request-bound values.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export const fredTelnyxWebhookStore = new PostgresFredTelnyxWebhookStore();
