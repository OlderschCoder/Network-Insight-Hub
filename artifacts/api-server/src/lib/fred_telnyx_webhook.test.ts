import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  FredTelnyxWebhookError,
  mapFredTelnyxDeliveryStatus,
  parseFredTelnyxPublicKey,
  processFredTelnyxWebhook,
  verifyAndParseFredTelnyxWebhook,
  type FredTelnyxWebhookStore,
} from "./fred_telnyx_webhook";

const NOW = new Date("2026-09-13T12:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));

function makeKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey,
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    publicDerBase64: publicDer.toString("base64"),
    publicRawBase64: publicDer.subarray(-32).toString("base64"),
    publicRawHex: publicDer.subarray(-32).toString("hex"),
  };
}

function makeBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      data: {
        id: "event-6c90aa3d",
        event_type: "message.finalized",
        occurred_at: "2026-09-13T11:59:58.000Z",
        payload: {
          id: "message-20052a06",
          to: [{ status: "delivered" }],
          errors: [],
        },
        ...overrides,
      },
    }),
  );
}

function sign(
  rawBody: Buffer,
  timestamp: string,
  privateKey: crypto.KeyObject,
): string {
  return crypto
    .sign(
      null,
      Buffer.concat([Buffer.from(`${timestamp}|`), rawBody]),
      privateKey,
    )
    .toString("base64");
}

function expectWebhookError(
  fn: () => unknown,
  code: string,
  httpStatus: number,
) {
  try {
    fn();
    throw new Error("Expected webhook validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(FredTelnyxWebhookError);
    expect((error as FredTelnyxWebhookError).code).toBe(code);
    expect((error as FredTelnyxWebhookError).httpStatus).toBe(httpStatus);
  }
}

describe("Fred Telnyx webhook signature verification", () => {
  it.each([
    "publicPem",
    "publicDerBase64",
    "publicRawBase64",
    "publicRawHex",
  ] as const)(
    "accepts a valid exact-body signature with the %s key format",
    (keyFormat) => {
      const keys = makeKeys();
      const rawBody = makeBody();
      const event = verifyAndParseFredTelnyxWebhook({
        rawBody,
        signature: sign(rawBody, TIMESTAMP, keys.privateKey),
        timestamp: TIMESTAMP,
        publicKey: keys[keyFormat],
        now: NOW,
      });

      expect(event).toMatchObject({
        provider: "telnyx",
        eventId: "event-6c90aa3d",
        eventType: "message.finalized",
        providerMessageId: "message-20052a06",
        providerStatus: "delivered",
        deliveryStatus: "delivered",
      });
      expect(event.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it("rejects even a harmless byte-level body change after signing", () => {
    const keys = makeKeys();
    const signedBody = makeBody();
    const changedBody = Buffer.from(`${signedBody.toString("utf8")}\n`);

    expectWebhookError(
      () =>
        verifyAndParseFredTelnyxWebhook({
          rawBody: changedBody,
          signature: sign(signedBody, TIMESTAMP, keys.privateKey),
          timestamp: TIMESTAMP,
          publicKey: keys.publicPem,
          now: NOW,
        }),
      "signature_invalid",
      401,
    );
  });

  it("keeps the event-data hash stable across retry and failover metadata", () => {
    const keys = makeKeys();
    const data = JSON.parse(makeBody().toString("utf8")).data;
    const primaryBody = Buffer.from(
      JSON.stringify({
        data,
        meta: { attempt: 1, delivered_to: "https://fred.example/status" },
      }),
    );
    const failoverBody = Buffer.from(
      JSON.stringify({
        meta: { delivered_to: "https://fred.example/failover", attempt: 4 },
        data,
      }),
    );

    const primary = verifyAndParseFredTelnyxWebhook({
      rawBody: primaryBody,
      signature: sign(primaryBody, TIMESTAMP, keys.privateKey),
      timestamp: TIMESTAMP,
      publicKey: keys.publicPem,
      now: NOW,
    });
    const failover = verifyAndParseFredTelnyxWebhook({
      rawBody: failoverBody,
      signature: sign(failoverBody, TIMESTAMP, keys.privateKey),
      timestamp: TIMESTAMP,
      publicKey: keys.publicPem,
      now: NOW,
    });

    expect(failover.payloadSha256).toBe(primary.payloadSha256);
  });

  it.each([
    [String(Number(TIMESTAMP) - 301), "old"],
    [String(Number(TIMESTAMP) + 301), "future"],
  ])(
    "rejects a %s timestamp outside the five-minute replay window",
    (timestamp) => {
      const keys = makeKeys();
      const rawBody = makeBody();

      expectWebhookError(
        () =>
          verifyAndParseFredTelnyxWebhook({
            rawBody,
            signature: sign(rawBody, timestamp, keys.privateKey),
            timestamp,
            publicKey: keys.publicPem,
            now: NOW,
          }),
        "timestamp_expired",
        401,
      );
    },
  );

  it("treats a missing or malformed configured public key as unavailable", () => {
    expectWebhookError(
      () => parseFredTelnyxPublicKey(undefined),
      "webhook_not_configured",
      503,
    );
    expectWebhookError(
      () => parseFredTelnyxPublicKey("not-a-key"),
      "webhook_key_invalid",
      503,
    );
  });

  it("rejects a signed delivery event without a provider message id", () => {
    const keys = makeKeys();
    const rawBody = makeBody({ payload: { to: [{ status: "delivered" }] } });

    expectWebhookError(
      () =>
        verifyAndParseFredTelnyxWebhook({
          rawBody,
          signature: sign(rawBody, TIMESTAMP, keys.privateKey),
          timestamp: TIMESTAMP,
          publicKey: keys.publicPem,
          now: NOW,
        }),
      "invalid_payload",
      400,
    );
  });
});

describe("Fred Telnyx webhook processing", () => {
  it("passes only normalized audit metadata to durable storage", async () => {
    const keys = makeKeys();
    const rawBody = makeBody({
      payload: {
        id: "message-20052a06",
        to: [{ phone_number: "+13035550199", status: "delivery_failed" }],
        text: "private alert text",
        errors: [
          {
            code: "40017",
            title: "Delivery failed",
            detail: "private provider detail",
          },
        ],
      },
    });
    const record = vi
      .fn()
      .mockResolvedValue({ duplicate: false, matchedDelivery: true });
    const store: FredTelnyxWebhookStore = { record };

    await expect(
      processFredTelnyxWebhook({
        rawBody,
        signature: sign(rawBody, TIMESTAMP, keys.privateKey),
        timestamp: TIMESTAMP,
        publicKey: keys.publicPem,
        store,
        now: NOW,
      }),
    ).resolves.toEqual({ duplicate: false, matchedDelivery: true });

    expect(record).toHaveBeenCalledTimes(1);
    const stored = record.mock.calls[0][0];
    expect(stored).toMatchObject({
      providerMessageId: "message-20052a06",
      deliveryStatus: "failed",
      providerErrorCode: "40017",
    });
    expect(JSON.stringify(stored)).not.toContain("+13035550199");
    expect(JSON.stringify(stored)).not.toContain("private alert text");
    expect(JSON.stringify(stored)).not.toContain("private provider detail");
  });

  it("surfaces an active event claim as a retry-safe error", async () => {
    const keys = makeKeys();
    const rawBody = makeBody();
    const base = {
      rawBody,
      signature: sign(rawBody, TIMESTAMP, keys.privateKey),
      timestamp: TIMESTAMP,
      publicKey: keys.publicPem,
      now: NOW,
    };

    await expect(
      processFredTelnyxWebhook({
        ...base,
        store: {
          record: async () => ({
            duplicate: false,
            matchedDelivery: false,
            retryLater: true,
          }),
        },
      }),
    ).rejects.toMatchObject({ code: "event_processing_busy", httpStatus: 503 });
  });

  it("maps Telnyx lifecycle states without treating unconfirmed delivery as success", () => {
    expect(mapFredTelnyxDeliveryStatus("message.queued", "queued")).toBe(
      "queued",
    );
    expect(mapFredTelnyxDeliveryStatus("message.sending", "sending")).toBe(
      "sending",
    );
    expect(mapFredTelnyxDeliveryStatus("message.sent", null)).toBe("accepted");
    expect(mapFredTelnyxDeliveryStatus("message.finalized", "delivered")).toBe(
      "delivered",
    );
    expect(
      mapFredTelnyxDeliveryStatus("message.finalized", "delivery_failed"),
    ).toBe("failed");
    expect(
      mapFredTelnyxDeliveryStatus("message.finalized", "delivery_unconfirmed"),
    ).toBe("unknown");
    expect(mapFredTelnyxDeliveryStatus("message.finalized", "failed")).toBe(
      "failed",
    );
    expect(mapFredTelnyxDeliveryStatus("message.finalized", "gw_timeout")).toBe(
      "failed",
    );
    expect(
      mapFredTelnyxDeliveryStatus("message.finalized", "dlr_timeout"),
    ).toBe("unknown");
    expect(
      mapFredTelnyxDeliveryStatus("message.finalized", "future_status"),
    ).toBe("unknown");
  });
});
