import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FredTelnyxApiError,
  FredTelnyxConfigError,
  FredTelnyxNetworkError,
  FredTelnyxResponseError,
  FredTelnyxTimeoutError,
  FredTelnyxValidationError,
  hashFredRecipient,
  loadFredTelnyxConfig,
  sendFredSms,
  sendFredSmsToConfiguredRecipients,
  type FredTelnyxConfig,
} from "./fred_telnyx";

const config: FredTelnyxConfig = {
  apiKey: "KEY-test-secret",
  recipientHashKey: "a-secure-test-key-with-at-least-32-characters",
  messagingProfileId: "4000eba1-a0c0-4563-9925-b25e842a7cb6",
  fromNumber: "+13035550100",
  recipients: ["+13035550101", "+13035550102"],
};

const input = {
  to: "+13035550101",
  text: "[FRED TEST] Alert delivery check.",
  idempotencyKey: "fred:test:2026-09-13",
  webhookUrl: "https://fred.example.edu/api/fred/alerts/telnyx/status",
  webhookFailoverUrl:
    "https://fred.example.edu/api/fred/alerts/telnyx/status/failover",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Fred Telnyx configuration", () => {
  it("loads, validates, and de-duplicates configured recipients", () => {
    const loaded = loadFredTelnyxConfig({
      FRED_TELNYX_API_KEY: config.apiKey,
      FRED_ALERT_RECIPIENT_HASH_KEY: config.recipientHashKey,
      FRED_TELNYX_MESSAGING_PROFILE_ID: config.messagingProfileId,
      FRED_TELNYX_FROM_NUMBER: config.fromNumber,
      FRED_ALERT_TO_NUMBERS: "+13035550101, +13035550102; +13035550101",
    });

    expect(loaded).toEqual(config);
  });

  it("rejects a missing secret without exposing any configured value", () => {
    expect(() =>
      loadFredTelnyxConfig({
        FRED_ALERT_RECIPIENT_HASH_KEY: config.recipientHashKey,
        FRED_TELNYX_MESSAGING_PROFILE_ID: config.messagingProfileId,
        FRED_TELNYX_FROM_NUMBER: config.fromNumber,
        FRED_ALERT_TO_NUMBERS: config.recipients.join(","),
      }),
    ).toThrowError(FredTelnyxConfigError);

    try {
      loadFredTelnyxConfig({
        FRED_ALERT_RECIPIENT_HASH_KEY: config.recipientHashKey,
        FRED_TELNYX_MESSAGING_PROFILE_ID: config.messagingProfileId,
        FRED_TELNYX_FROM_NUMBER: config.fromNumber,
        FRED_ALERT_TO_NUMBERS: config.recipients.join(","),
      });
    } catch (error) {
      expect(String(error)).not.toContain(config.fromNumber);
      expect(String(error)).not.toContain(config.recipients[0]);
    }
  });

  it("rejects using the sender as an alert destination", () => {
    expect(() =>
      loadFredTelnyxConfig({
        FRED_TELNYX_API_KEY: config.apiKey,
        FRED_ALERT_RECIPIENT_HASH_KEY: config.recipientHashKey,
        FRED_TELNYX_MESSAGING_PROFILE_ID: config.messagingProfileId,
        FRED_TELNYX_FROM_NUMBER: config.fromNumber,
        FRED_ALERT_TO_NUMBERS: config.fromNumber,
      }),
    ).toThrowError(/sender cannot also be an alert recipient/);
  });

  it("rejects an undersized recipient hash key", () => {
    expect(() =>
      loadFredTelnyxConfig({
        FRED_TELNYX_API_KEY: config.apiKey,
        FRED_ALERT_RECIPIENT_HASH_KEY: "too-short",
        FRED_TELNYX_MESSAGING_PROFILE_ID: config.messagingProfileId,
        FRED_TELNYX_FROM_NUMBER: config.fromNumber,
        FRED_ALERT_TO_NUMBERS: config.recipients.join(","),
      }),
    ).toThrowError(/at least 32 characters/);
  });

  it("uses a keyed recipient hash rather than an enumerable plain digest", () => {
    const first = hashFredRecipient(
      config.recipients[0],
      config.recipientHashKey,
    );
    const otherKey = hashFredRecipient(
      config.recipients[0],
      "a-different-test-key-with-at-least-32-characters",
    );
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(otherKey);
    expect(first).not.toContain(config.recipients[0]);
  });
});

describe("Fred Telnyx SMS sending", () => {
  it("posts an SMS with isolated per-message status webhooks", async () => {
    const fetchImpl = vi.fn<
      (request: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              id: "40385f64-5717-4562-b3fc-2c963f66afa6",
              to: [{ status: "queued" }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await sendFredSms(input, { config, fetchImpl });

    expect(result).toEqual({
      ok: true,
      provider: "telnyx",
      providerMessageId: "40385f64-5717-4562-b3fc-2c963f66afa6",
      providerStatus: "queued",
      recipientToken: "***0101",
      idempotencyKey: input.idempotencyKey,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.telnyx.com/v2/messages");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    });
    expect(request?.headers).not.toHaveProperty("Idempotency-Key");
    expect(JSON.parse(String(request?.body))).toEqual({
      from: config.fromNumber,
      messaging_profile_id: config.messagingProfileId,
      to: input.to,
      text: input.text,
      type: "SMS",
      encoding: "auto",
      webhook_url: input.webhookUrl,
      webhook_failover_url: input.webhookFailoverUrl,
      use_profile_webhooks: false,
    });
  });

  it("uses stable recipient-scoped keys and never returns full recipients", async () => {
    const fetchImpl = vi.fn<
      (request: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async (_request, request) => {
      const body = JSON.parse(String(request?.body));
      return new Response(
        JSON.stringify({
          data: {
            id: `message-${String(body.to).slice(-4)}`,
            to: [{ status: "queued" }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const broadcast = {
      text: input.text,
      idempotencyKey: input.idempotencyKey,
      webhookUrl: input.webhookUrl,
      webhookFailoverUrl: input.webhookFailoverUrl,
    };

    const first = await sendFredSmsToConfiguredRecipients(broadcast, {
      config,
      fetchImpl,
    });
    const second = await sendFredSmsToConfiguredRecipients(broadcast, {
      config,
      fetchImpl,
    });

    expect(first.map((attempt) => attempt.idempotencyKey)).toEqual(
      second.map((attempt) => attempt.idempotencyKey),
    );
    expect(new Set(first.map((attempt) => attempt.idempotencyKey)).size).toBe(
      2,
    );
    expect(first.map((attempt) => attempt.recipientToken)).toEqual([
      "***0101",
      "***0102",
    ]);
    expect(JSON.stringify(first)).not.toContain(config.recipients[0]);
    expect(JSON.stringify(first)).not.toContain(config.recipients[1]);
  });

  it("returns a redacted, typed API error", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                code: "40300",
                title: "Invalid recipient",
                detail: `Recipient ${config.recipients[0]} rejected; key ${config.apiKey}`,
              },
            ],
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    );

    let failure: unknown;
    try {
      await sendFredSms(input, { config, fetchImpl });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(FredTelnyxApiError);
    expect(failure).toMatchObject({
      code: "api",
      httpStatus: 400,
      retryable: false,
      providerErrors: [{ code: "40300", title: "Invalid recipient" }],
    });
    expect(String(failure)).not.toContain(config.apiKey);
    expect(String(failure)).not.toContain(config.recipients[0]);
    expect(JSON.stringify(failure)).not.toContain(config.apiKey);
    expect(JSON.stringify(failure)).not.toContain(config.recipients[0]);
  });

  it("distinguishes network failures from invalid success responses", async () => {
    await expect(
      sendFredSms(input, {
        config,
        fetchImpl: vi.fn(async () => {
          throw new Error(`connection failed for ${config.recipients[0]}`);
        }),
      }),
    ).rejects.toBeInstanceOf(FredTelnyxNetworkError);

    await expect(
      sendFredSms(input, {
        config,
        fetchImpl: vi.fn(
          async () =>
            new Response(JSON.stringify({ data: {} }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        ),
      }),
    ).rejects.toBeInstanceOf(FredTelnyxResponseError);
  });

  it("aborts a request at the configured timeout", async () => {
    const fetchImpl = vi.fn(
      async (_request: string | URL | Request, request?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          request?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );

    await expect(
      sendFredSms(input, { config, fetchImpl, timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(FredTelnyxTimeoutError);
  });

  it("rejects non-HTTPS or duplicate webhook destinations before sending", async () => {
    const fetchImpl = vi.fn();

    await expect(
      sendFredSms(
        {
          ...input,
          webhookFailoverUrl: input.webhookUrl,
        },
        { config, fetchImpl },
      ),
    ).rejects.toBeInstanceOf(FredTelnyxValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an empty broadcast idempotency key before sending", async () => {
    const fetchImpl = vi.fn();

    await expect(
      sendFredSmsToConfiguredRecipients(
        {
          text: input.text,
          idempotencyKey: " ",
          webhookUrl: input.webhookUrl,
          webhookFailoverUrl: input.webhookFailoverUrl,
        },
        { config, fetchImpl },
      ),
    ).rejects.toBeInstanceOf(FredTelnyxValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
