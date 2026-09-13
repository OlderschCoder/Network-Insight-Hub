import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: {} }));

import { PostgresFredTelnyxWebhookStore } from "./fred_telnyx_webhook_store";
import type { FredTelnyxWebhookEvent } from "./fred_telnyx_webhook";

const event: FredTelnyxWebhookEvent = {
  provider: "telnyx",
  eventId: "event-audit-1",
  eventType: "message.finalized",
  providerMessageId: "message-audit-1",
  providerStatus: "delivered",
  deliveryStatus: "delivered",
  eventOccurredAt: new Date("2026-09-13T12:00:00.000Z"),
  payloadSha256: "a".repeat(64),
  providerErrorCode: null,
};

function makeDatabase(
  execute: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>,
) {
  const query = vi.fn(execute);
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect }, query, release };
}

describe("Postgres Fred Telnyx webhook store", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims, updates, and completes an event in one transaction", async () => {
    const database = makeDatabase(async (text) => {
      if (text.includes("INSERT INTO fred_webhook_event_claims")) {
        return { rows: [{ id: "claim-1" }] };
      }
      if (text.includes("FROM fred_alert_deliveries")) {
        return { rows: [{ id: "delivery-1" }] };
      }
      return { rows: [] };
    });
    const store = new PostgresFredTelnyxWebhookStore(database.pool as any);

    await expect(store.record(event)).resolves.toEqual({
      duplicate: false,
      matchedDelivery: true,
    });

    expect(database.query.mock.calls[0][0]).toBe("BEGIN");
    expect(database.query.mock.calls[1][0]).toContain("statement_timeout");
    expect(database.query.mock.calls[2][0]).toContain("lock_timeout");
    expect(database.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(database.release).toHaveBeenCalledOnce();
    const deliveryUpdate = database.query.mock.calls.find(([text]) =>
      String(text).includes("UPDATE fred_alert_deliveries"),
    );
    expect(deliveryUpdate?.[0]).toContain("newer.event_occurred_at > $4");
    expect(deliveryUpdate?.[0]).toContain(
      "WHEN status = 'accepted' AND $3 IN ('queued', 'sending') THEN 'accepted'",
    );
    expect(deliveryUpdate?.[0]).toContain(
      "WHEN status = 'sending' AND $3 = 'queued' THEN 'sending'",
    );
    expect(deliveryUpdate?.[1]).toEqual([
      "telnyx",
      "delivered",
      "delivered",
      event.eventOccurredAt,
      null,
      "message-audit-1",
      "delivery-1",
    ]);
  });

  it("acknowledges an identical processed event without updating delivery twice", async () => {
    const database = makeDatabase(async (text) => {
      if (text.includes("INSERT INTO fred_webhook_event_claims"))
        return { rows: [] };
      if (text.includes("FROM fred_webhook_event_claims")) {
        return {
          rows: [
            {
              id: "claim-1",
              payload_sha256: event.payloadSha256,
              status: "processed",
              lease_expired: false,
              delivery_id: "delivery-1",
            },
          ],
        };
      }
      return { rows: [] };
    });
    const store = new PostgresFredTelnyxWebhookStore(database.pool as any);

    await expect(store.record(event)).resolves.toEqual({
      duplicate: true,
      matchedDelivery: true,
    });
    expect(
      database.query.mock.calls.some(([text]) =>
        String(text).includes("UPDATE fred_alert_deliveries"),
      ),
    ).toBe(false);
    expect(database.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("audits a stable-data hash anomaly but still deduplicates by event id", async () => {
    const database = makeDatabase(async (text) => {
      if (text.includes("INSERT INTO fred_webhook_event_claims"))
        return { rows: [] };
      if (text.includes("FROM fred_webhook_event_claims")) {
        return {
          rows: [
            {
              id: "claim-1",
              payload_sha256: "b".repeat(64),
              status: "processed",
              lease_expired: false,
              delivery_id: "delivery-1",
            },
          ],
        };
      }
      return { rows: [] };
    });
    const store = new PostgresFredTelnyxWebhookStore(database.pool as any);

    await expect(store.record(event)).resolves.toEqual({
      duplicate: true,
      matchedDelivery: true,
    });
    const anomalyAudit = database.query.mock.calls.find(([text]) =>
      String(text).includes("event_data_hash_mismatch"),
    );
    expect(anomalyAudit?.[1]).toEqual(["claim-1"]);
    expect(database.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("durably records a retryable claim when a callback beats the sender update", async () => {
    const database = makeDatabase(async (text) => {
      if (text.includes("INSERT INTO fred_webhook_event_claims")) {
        return { rows: [{ id: "claim-early" }] };
      }
      return { rows: [] };
    });
    const store = new PostgresFredTelnyxWebhookStore(database.pool as any);

    await expect(store.record(event)).resolves.toEqual({
      duplicate: false,
      matchedDelivery: false,
      retryLater: true,
    });
    const pendingMatch = database.query.mock.calls.find(([text]) =>
      String(text).includes("delivery_match_pending"),
    );
    expect(pendingMatch?.[1]).toEqual(["claim-early"]);
    expect(database.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("reopens a processed-unmatched claim and reconciles it on retry", async () => {
    const database = makeDatabase(async (text) => {
      if (text.includes("INSERT INTO fred_webhook_event_claims")) {
        return { rows: [] };
      }
      if (text.includes("FROM fred_webhook_event_claims")) {
        return {
          rows: [
            {
              id: "claim-unmatched",
              payload_sha256: event.payloadSha256,
              status: "processed",
              lease_expired: true,
              delivery_id: null,
            },
          ],
        };
      }
      if (text.includes("claim_token = gen_random_uuid()")) {
        return { rows: [{ id: "claim-unmatched" }] };
      }
      if (text.includes("FROM fred_alert_deliveries")) {
        return { rows: [{ id: "delivery-late" }] };
      }
      return { rows: [] };
    });
    const store = new PostgresFredTelnyxWebhookStore(database.pool as any);

    await expect(store.record(event)).resolves.toEqual({
      duplicate: false,
      matchedDelivery: true,
    });
    expect(database.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("rolls back and releases the connection when persistence fails", async () => {
    let shouldFail = true;
    const database = makeDatabase(async (text) => {
      if (
        text.includes("INSERT INTO fred_webhook_event_claims") &&
        shouldFail
      ) {
        shouldFail = false;
        throw new Error("simulated database failure");
      }
      return { rows: [] };
    });
    const store = new PostgresFredTelnyxWebhookStore(database.pool as any);

    await expect(store.record(event)).rejects.toThrow(
      "simulated database failure",
    );
    expect(database.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(database.release).toHaveBeenCalledOnce();
  });
});
