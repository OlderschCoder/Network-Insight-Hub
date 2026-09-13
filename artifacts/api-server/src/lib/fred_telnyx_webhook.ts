import crypto, { type KeyObject } from "node:crypto";

const ED25519_RAW_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const DEFAULT_MAX_AGE_SECONDS = 5 * 60;

type JsonRecord = Record<string, unknown>;

export type FredDeliveryStatus =
  | "queued"
  | "sending"
  | "accepted"
  | "delivered"
  | "failed"
  | "unknown";

export interface FredTelnyxWebhookEvent {
  provider: "telnyx";
  eventId: string;
  eventType: string;
  providerMessageId: string | null;
  providerStatus: string | null;
  deliveryStatus: FredDeliveryStatus | null;
  eventOccurredAt: Date | null;
  payloadSha256: string;
  providerErrorCode: string | null;
}

export interface FredTelnyxWebhookRecordResult {
  duplicate: boolean;
  matchedDelivery: boolean;
  retryLater?: boolean;
}

export interface FredTelnyxWebhookStore {
  record(event: FredTelnyxWebhookEvent): Promise<FredTelnyxWebhookRecordResult>;
}

export interface ProcessFredTelnyxWebhookInput {
  rawBody: Buffer;
  signature: string | undefined;
  timestamp: string | undefined;
  publicKey: string | undefined;
  store: FredTelnyxWebhookStore;
  now?: Date;
  maxAgeSeconds?: number;
}

export class FredTelnyxWebhookError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, httpStatus: number, message: string) {
    super(message);
    this.name = "FredTelnyxWebhookError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as JsonRecord;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function requiredBoundedString(
  record: JsonRecord,
  key: string,
  maxLength: number,
): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new FredTelnyxWebhookError(
      "invalid_payload",
      400,
      `Telnyx event ${key} is missing or invalid`,
    );
  }
  return value;
}

function optionalBoundedString(
  record: JsonRecord,
  key: string,
  maxLength: number,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new FredTelnyxWebhookError(
      "invalid_payload",
      400,
      `Telnyx event ${key} is invalid`,
    );
  }
  return value;
}

function decodeBase64(value: string, label: string): Buffer {
  const compact = value.replace(/\s+/g, "");
  if (
    compact.length === 0 ||
    compact.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) ||
    compact.slice(0, -2).includes("=")
  ) {
    throw new FredTelnyxWebhookError(
      "invalid_signature_material",
      401,
      `${label} is not valid base64`,
    );
  }
  const padded = compact.padEnd(
    compact.length + ((4 - (compact.length % 4)) % 4),
    "=",
  );
  return Buffer.from(padded, "base64");
}

function assertEd25519Key(key: KeyObject): KeyObject {
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
    throw new Error("Configured key is not an Ed25519 public key");
  }
  return key;
}

/**
 * Telnyx exposes the Ed25519 public key in more than one convenient copy/paste
 * form. Accept PEM, DER/base64, or raw-key base64/hex while still requiring the
 * resulting key to be Ed25519.
 */
export function parseFredTelnyxPublicKey(value: string | undefined): KeyObject {
  if (!value?.trim()) {
    throw new FredTelnyxWebhookError(
      "webhook_not_configured",
      503,
      "Fred Telnyx webhook verification is not configured",
    );
  }

  try {
    const normalized = value.trim().replace(/\\n/g, "\n");
    if (normalized.includes("-----BEGIN PUBLIC KEY-----")) {
      return assertEd25519Key(crypto.createPublicKey(normalized));
    }

    const compact = normalized.replace(/\s+/g, "");
    let bytes: Buffer;
    if (/^(?:[0-9a-fA-F]{2})+$/.test(compact)) {
      bytes = Buffer.from(compact, "hex");
    } else {
      bytes = decodeBase64(compact, "Public key");
    }

    const der =
      bytes.length === ED25519_RAW_PUBLIC_KEY_BYTES
        ? Buffer.concat([ED25519_SPKI_PREFIX, bytes])
        : bytes;
    return assertEd25519Key(
      crypto.createPublicKey({ key: der, format: "der", type: "spki" }),
    );
  } catch (error) {
    if (error instanceof FredTelnyxWebhookError) {
      if (error.code === "webhook_not_configured") throw error;
    }
    throw new FredTelnyxWebhookError(
      "webhook_key_invalid",
      503,
      "Fred Telnyx webhook verification key is invalid",
    );
  }
}

function parseSignature(value: string | undefined): Buffer {
  if (!value) {
    throw new FredTelnyxWebhookError(
      "signature_missing",
      401,
      "Telnyx signature is required",
    );
  }
  const signature = decodeBase64(value, "Signature");
  if (signature.length !== ED25519_SIGNATURE_BYTES) {
    throw new FredTelnyxWebhookError(
      "signature_invalid",
      401,
      "Telnyx signature is invalid",
    );
  }
  return signature;
}

function parseAndValidateTimestamp(
  value: string | undefined,
  now: Date,
  maxAgeSeconds: number,
): string {
  if (!value || !/^\d{1,16}$/.test(value)) {
    throw new FredTelnyxWebhookError(
      "timestamp_invalid",
      401,
      "Telnyx timestamp is missing or invalid",
    );
  }
  const timestampSeconds = Number(value);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    !Number.isFinite(maxAgeSeconds) ||
    maxAgeSeconds <= 0 ||
    Math.abs(nowSeconds - timestampSeconds) > maxAgeSeconds
  ) {
    throw new FredTelnyxWebhookError(
      "timestamp_expired",
      401,
      "Telnyx timestamp is outside the allowed window",
    );
  }
  return value;
}

function parseOccurredAt(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) {
    return null;
  }
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

function extractProviderStatus(payload: JsonRecord): string | null {
  const recipients = payload.to;
  if (Array.isArray(recipients)) {
    for (const recipient of recipients) {
      if (!isRecord(recipient)) continue;
      const status = recipient.status;
      if (
        typeof status === "string" &&
        status.length > 0 &&
        status.length <= 80
      ) {
        return status;
      }
    }
  }
  return optionalBoundedString(payload, "status", 80);
}

function extractSafeProviderErrorCode(payload: JsonRecord): string | null {
  if (!Array.isArray(payload.errors)) return null;
  for (const error of payload.errors) {
    if (!isRecord(error) || typeof error.code !== "string") continue;
    const code = error.code.trim();
    if (/^[A-Za-z0-9._-]{1,100}$/.test(code)) return code;
  }
  return null;
}

export function mapFredTelnyxDeliveryStatus(
  eventType: string,
  providerStatus: string | null,
): FredDeliveryStatus | null {
  const status = providerStatus?.trim().toLowerCase();
  if (status === "delivered") return "delivered";
  if (
    [
      "delivery_failed",
      "sending_failed",
      "failed",
      "gw_timeout",
      "expired",
    ].includes(status ?? "")
  ) {
    return "failed";
  }
  if (status === "delivery_unconfirmed" || status === "dlr_timeout") {
    return "unknown";
  }
  if (status === "queued") return "queued";
  if (status === "sending") return "sending";
  if (status === "sent" || eventType === "message.sent") return "accepted";
  if (eventType === "message.finalized") return "unknown";
  return null;
}

export function verifyAndParseFredTelnyxWebhook(input: {
  rawBody: Buffer;
  signature: string | undefined;
  timestamp: string | undefined;
  publicKey: string | undefined;
  now?: Date;
  maxAgeSeconds?: number;
}): FredTelnyxWebhookEvent {
  if (!Buffer.isBuffer(input.rawBody) || input.rawBody.length === 0) {
    throw new FredTelnyxWebhookError(
      "raw_body_missing",
      400,
      "The exact Telnyx request body is required",
    );
  }

  const now = input.now ?? new Date();
  const timestamp = parseAndValidateTimestamp(
    input.timestamp,
    now,
    input.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS,
  );
  const publicKey = parseFredTelnyxPublicKey(input.publicKey);
  const signature = parseSignature(input.signature);
  const signedPayload = Buffer.concat([
    Buffer.from(`${timestamp}|`, "utf8"),
    input.rawBody,
  ]);
  if (!crypto.verify(null, signedPayload, publicKey, signature)) {
    throw new FredTelnyxWebhookError(
      "signature_invalid",
      401,
      "Telnyx signature is invalid",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody.toString("utf8"));
  } catch {
    throw new FredTelnyxWebhookError(
      "invalid_payload",
      400,
      "Telnyx payload is not valid JSON",
    );
  }
  if (!isRecord(parsed) || !isRecord(parsed.data)) {
    throw new FredTelnyxWebhookError(
      "invalid_payload",
      400,
      "Telnyx event data is missing",
    );
  }

  const data = parsed.data;
  const eventId = requiredBoundedString(data, "id", 255);
  const eventType = requiredBoundedString(data, "event_type", 120);
  const payload = isRecord(data.payload) ? data.payload : {};
  const providerMessageId = optionalBoundedString(payload, "id", 255);
  const providerStatus = extractProviderStatus(payload);
  const eventOccurredAt = parseOccurredAt(data.occurred_at);
  if (eventType === "message.sent" || eventType === "message.finalized") {
    if (!providerMessageId) {
      throw new FredTelnyxWebhookError(
        "invalid_payload",
        400,
        "Telnyx delivery event payload.id is missing or invalid",
      );
    }
    if (!eventOccurredAt) {
      throw new FredTelnyxWebhookError(
        "invalid_payload",
        400,
        "Telnyx delivery event occurred_at is missing or invalid",
      );
    }
  }

  return {
    provider: "telnyx",
    eventId,
    eventType,
    providerMessageId,
    providerStatus,
    deliveryStatus: mapFredTelnyxDeliveryStatus(eventType, providerStatus),
    eventOccurredAt,
    payloadSha256: crypto
      .createHash("sha256")
      // Retry/failover envelopes can change top-level meta.attempt and
      // meta.delivered_to. Hash the signed, immutable event data instead.
      .update(canonicalJson(data))
      .digest("hex"),
    providerErrorCode: extractSafeProviderErrorCode(payload),
  };
}

export async function processFredTelnyxWebhook(
  input: ProcessFredTelnyxWebhookInput,
): Promise<FredTelnyxWebhookRecordResult> {
  const event = verifyAndParseFredTelnyxWebhook(input);
  const result = await input.store.record(event);
  if (result.retryLater) {
    throw new FredTelnyxWebhookError(
      "event_processing_busy",
      503,
      "Telnyx event processing should be retried",
    );
  }
  return result;
}
