import { createHmac } from "node:crypto";

const TELNYX_MESSAGES_URL = "https://api.telnyx.com/v2/messages";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_SMS_CHARACTERS = 1_600;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

type Environment = Record<string, string | undefined>;
type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type FredTelnyxConfig = {
  apiKey: string;
  recipientHashKey: string;
  messagingProfileId: string;
  fromNumber: string;
  recipients: readonly string[];
};

export type FredSmsInput = {
  to: string;
  text: string;
  /**
   * A durable, caller-owned key used to prevent a Fred incident transition from
   * being submitted more than once. Telnyx's published Send Message operation
   * does not currently accept an idempotency header, so callers must persist
   * this key before retrying an ambiguous request.
   */
  idempotencyKey: string;
  webhookUrl: string;
  webhookFailoverUrl: string;
};

export type FredSmsBroadcastInput = Omit<FredSmsInput, "to">;

export type FredSmsAccepted = {
  ok: true;
  provider: "telnyx";
  providerMessageId: string;
  providerStatus: string;
  recipientToken: string;
  idempotencyKey: string;
};

export type FredTelnyxFailure = {
  code:
    | "config"
    | "validation"
    | "timeout"
    | "network"
    | "api"
    | "response"
    | "unexpected";
  message: string;
  retryable: boolean;
  httpStatus?: number;
  providerCode?: string;
};

export type FredSmsDeliveryAttempt =
  | FredSmsAccepted
  | {
      ok: false;
      recipientToken: string;
      idempotencyKey: string;
      error: FredTelnyxFailure;
    };

export type FredTelnyxDependencies = {
  config?: FredTelnyxConfig;
  env?: Environment;
  fetchImpl?: FetchImplementation;
  timeoutMs?: number;
};

export class FredTelnyxConfigError extends Error {
  readonly code = "config" as const;
  readonly retryable = false;

  constructor(
    message: string,
    readonly variable?: string,
  ) {
    super(message);
    this.name = "FredTelnyxConfigError";
  }
}

export class FredTelnyxValidationError extends Error {
  readonly code = "validation" as const;
  readonly retryable = false;

  constructor(
    message: string,
    readonly field: keyof FredSmsInput,
  ) {
    super(message);
    this.name = "FredTelnyxValidationError";
  }
}

export class FredTelnyxTimeoutError extends Error {
  readonly code = "timeout" as const;
  readonly retryable = true;

  constructor(readonly timeoutMs: number) {
    super(`Telnyx did not respond within ${timeoutMs} ms.`);
    this.name = "FredTelnyxTimeoutError";
  }
}

export class FredTelnyxNetworkError extends Error {
  readonly code = "network" as const;
  readonly retryable = true;

  constructor() {
    super("The Telnyx request failed before a response was received.");
    this.name = "FredTelnyxNetworkError";
  }
}

export type FredTelnyxProviderError = {
  code?: string;
  title?: string;
  detail?: string;
};

export class FredTelnyxApiError extends Error {
  readonly code = "api" as const;
  readonly retryable: boolean;

  constructor(
    readonly httpStatus: number,
    readonly providerErrors: readonly FredTelnyxProviderError[],
  ) {
    const first = providerErrors[0];
    const suffix = [first?.code, first?.title, first?.detail]
      .filter(Boolean)
      .join(": ");
    super(
      `Telnyx rejected the message with HTTP ${httpStatus}${suffix ? ` (${suffix})` : ""}.`,
    );
    this.name = "FredTelnyxApiError";
    this.retryable =
      httpStatus === 408 ||
      httpStatus === 409 ||
      httpStatus === 425 ||
      httpStatus === 429 ||
      httpStatus >= 500;
  }
}

export class FredTelnyxResponseError extends Error {
  readonly code = "response" as const;
  readonly retryable = false;

  constructor(readonly httpStatus: number) {
    super("Telnyx returned an invalid success response.");
    this.name = "FredTelnyxResponseError";
  }
}

function requiredEnvironmentValue(env: Environment, variable: string): string {
  const value = env[variable]?.trim();
  if (!value) {
    throw new FredTelnyxConfigError(
      `Fred SMS is not configured: ${variable} is required.`,
      variable,
    );
  }
  return value;
}

function requireE164(value: string, variable: string): string {
  if (!E164_PATTERN.test(value)) {
    throw new FredTelnyxConfigError(
      `Fred SMS is not configured: ${variable} must be an E.164 phone number.`,
      variable,
    );
  }
  return value;
}

export function loadFredTelnyxConfig(
  env: Environment = process.env,
): FredTelnyxConfig {
  const apiKey = requiredEnvironmentValue(env, "FRED_TELNYX_API_KEY");
  const recipientHashKey = requiredEnvironmentValue(
    env,
    "FRED_ALERT_RECIPIENT_HASH_KEY",
  );
  if (recipientHashKey.length < 32) {
    throw new FredTelnyxConfigError(
      "Fred SMS is not configured: FRED_ALERT_RECIPIENT_HASH_KEY must contain at least 32 characters.",
      "FRED_ALERT_RECIPIENT_HASH_KEY",
    );
  }
  const messagingProfileId = requiredEnvironmentValue(
    env,
    "FRED_TELNYX_MESSAGING_PROFILE_ID",
  );
  const fromNumber = requireE164(
    requiredEnvironmentValue(env, "FRED_TELNYX_FROM_NUMBER"),
    "FRED_TELNYX_FROM_NUMBER",
  );
  const recipientValue = requiredEnvironmentValue(env, "FRED_ALERT_TO_NUMBERS");
  const recipients = Array.from(
    new Set(recipientValue.split(/[\s,;]+/).map((value) => value.trim())),
  ).filter(Boolean);

  if (recipients.length === 0) {
    throw new FredTelnyxConfigError(
      "Fred SMS is not configured: FRED_ALERT_TO_NUMBERS requires at least one recipient.",
      "FRED_ALERT_TO_NUMBERS",
    );
  }
  for (const recipient of recipients) {
    requireE164(recipient, "FRED_ALERT_TO_NUMBERS");
    if (recipient === fromNumber) {
      throw new FredTelnyxConfigError(
        "Fred SMS is not configured: the sender cannot also be an alert recipient.",
        "FRED_ALERT_TO_NUMBERS",
      );
    }
  }

  return {
    apiKey,
    recipientHashKey,
    messagingProfileId,
    fromNumber,
    recipients,
  };
}

export function fredRecipientToken(phoneNumber: string): string {
  return `***${phoneNumber.slice(-4)}`;
}

export function hashFredRecipient(recipient: string, hashKey: string): string {
  return createHmac("sha256", hashKey).update(recipient).digest("hex");
}

export function fredRecipientIdempotencyKey(
  baseKey: string,
  recipient: string,
  hashKey: string,
): string {
  return `${baseKey}.${hashFredRecipient(recipient, hashKey).slice(0, 16)}`;
}

function validateHttpsUrl(value: string, field: keyof FredSmsInput): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("HTTPS is required");
    return url.toString();
  } catch {
    throw new FredTelnyxValidationError(
      `${field} must be a valid HTTPS URL.`,
      field,
    );
  }
}

function validateInput(input: FredSmsInput): FredSmsInput {
  if (!E164_PATTERN.test(input.to)) {
    throw new FredTelnyxValidationError(
      "to must be an E.164 phone number.",
      "to",
    );
  }
  const characterCount = Array.from(input.text).length;
  if (input.text.trim().length === 0 || characterCount > MAX_SMS_CHARACTERS) {
    throw new FredTelnyxValidationError(
      `text must contain between 1 and ${MAX_SMS_CHARACTERS} characters.`,
      "text",
    );
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new FredTelnyxValidationError(
      "idempotencyKey must contain between 1 and 200 characters.",
      "idempotencyKey",
    );
  }
  const webhookUrl = validateHttpsUrl(input.webhookUrl, "webhookUrl");
  const webhookFailoverUrl = validateHttpsUrl(
    input.webhookFailoverUrl,
    "webhookFailoverUrl",
  );
  if (webhookUrl === webhookFailoverUrl) {
    throw new FredTelnyxValidationError(
      "webhookFailoverUrl must be different from webhookUrl.",
      "webhookFailoverUrl",
    );
  }
  return {
    ...input,
    idempotencyKey,
    webhookUrl,
    webhookFailoverUrl,
  };
}

function boundedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new FredTelnyxConfigError(
      "Fred Telnyx timeout must be a positive number.",
    );
  }
  return Math.min(Math.floor(timeoutMs), MAX_TIMEOUT_MS);
}

function redactSensitiveText(
  value: unknown,
  config: FredTelnyxConfig,
): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  let safe = value;
  const knownSecrets = [
    config.apiKey,
    config.fromNumber,
    ...config.recipients,
  ].filter(Boolean);
  for (const secret of knownSecrets)
    safe = safe.split(secret).join("[redacted]");
  return safe
    .replace(/\+?\d[\d().\s-]{6,}\d/g, (match) =>
      match.replace(/\D/g, "").length >= 8 ? "[redacted-phone]" : match,
    )
    .slice(0, 500);
}

function providerErrorsFrom(
  value: unknown,
  config: FredTelnyxConfig,
): FredTelnyxProviderError[] {
  if (!value || typeof value !== "object") return [];
  const errors = (value as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 10).map((error) => {
    const record =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : {};
    return {
      code: redactSensitiveText(record.code, config),
      title: redactSensitiveText(record.title, config),
      detail: redactSensitiveText(record.detail, config),
    };
  });
}

function acceptedMessageFrom(
  value: unknown,
): { id: string; status: string } | null {
  if (!value || typeof value !== "object") return null;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const record = data as { id?: unknown; to?: unknown };
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  const firstRecipient = Array.isArray(record.to) ? record.to[0] : undefined;
  const status =
    firstRecipient &&
    typeof firstRecipient === "object" &&
    typeof (firstRecipient as { status?: unknown }).status === "string"
      ? String((firstRecipient as { status: string }).status)
      : "accepted";
  return { id: record.id, status };
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function sendFredSms(
  rawInput: FredSmsInput,
  dependencies: FredTelnyxDependencies = {},
): Promise<FredSmsAccepted> {
  const config =
    dependencies.config ??
    loadFredTelnyxConfig(dependencies.env ?? process.env);
  const input = validateInput(rawInput);
  if (!config.recipients.includes(input.to)) {
    throw new FredTelnyxValidationError(
      "to is not one of Fred's configured alert recipients.",
      "to",
    );
  }
  const timeoutMs = boundedTimeout(dependencies.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;

  let response: Response;
  let payload: unknown;
  try {
    response = await fetchImpl(TELNYX_MESSAGES_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.fromNumber,
        messaging_profile_id: config.messagingProfileId,
        to: input.to,
        text: input.text,
        type: "SMS",
        encoding: "auto",
        webhook_url: input.webhookUrl,
        webhook_failover_url: input.webhookFailoverUrl,
        // Keep Fred status events isolated from any profile-level consumer.
        use_profile_webhooks: false,
      }),
      signal: controller.signal,
    });
    payload = await responseJson(response);
    if (controller.signal.aborted) {
      throw new FredTelnyxTimeoutError(timeoutMs);
    }
  } catch {
    if (controller.signal.aborted) {
      throw new FredTelnyxTimeoutError(timeoutMs);
    }
    throw new FredTelnyxNetworkError();
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new FredTelnyxApiError(
      response.status,
      providerErrorsFrom(payload, config),
    );
  }
  const accepted = acceptedMessageFrom(payload);
  if (!accepted) throw new FredTelnyxResponseError(response.status);

  return {
    ok: true,
    provider: "telnyx",
    providerMessageId: accepted.id,
    providerStatus: accepted.status,
    recipientToken: fredRecipientToken(input.to),
    idempotencyKey: input.idempotencyKey,
  };
}

export function describeFredTelnyxError(error: unknown): FredTelnyxFailure {
  if (
    error instanceof FredTelnyxConfigError ||
    error instanceof FredTelnyxValidationError ||
    error instanceof FredTelnyxTimeoutError ||
    error instanceof FredTelnyxNetworkError ||
    error instanceof FredTelnyxResponseError
  ) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error instanceof FredTelnyxResponseError
        ? { httpStatus: error.httpStatus }
        : {}),
    };
  }
  if (error instanceof FredTelnyxApiError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      httpStatus: error.httpStatus,
      ...(error.providerErrors[0]?.code
        ? { providerCode: error.providerErrors[0].code }
        : {}),
    };
  }
  return {
    code: "unexpected",
    message: "An unexpected Fred SMS error occurred.",
    retryable: false,
  };
}

export async function sendFredSmsToConfiguredRecipients(
  input: FredSmsBroadcastInput,
  dependencies: FredTelnyxDependencies = {},
): Promise<FredSmsDeliveryAttempt[]> {
  const config =
    dependencies.config ??
    loadFredTelnyxConfig(dependencies.env ?? process.env);
  const baseKey = input.idempotencyKey.trim();
  if (!baseKey || baseKey.length > 183) {
    throw new FredTelnyxValidationError(
      "idempotencyKey must contain between 1 and 183 characters for a broadcast.",
      "idempotencyKey",
    );
  }
  return Promise.all(
    config.recipients.map(async (recipient) => {
      const idempotencyKey = fredRecipientIdempotencyKey(
        baseKey,
        recipient,
        config.recipientHashKey,
      );
      try {
        return await sendFredSms(
          { ...input, to: recipient, idempotencyKey },
          { ...dependencies, config },
        );
      } catch (error) {
        return {
          ok: false as const,
          recipientToken: fredRecipientToken(recipient),
          idempotencyKey,
          error: describeFredTelnyxError(error),
        };
      }
    }),
  );
}
