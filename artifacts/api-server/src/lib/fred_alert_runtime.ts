import { createHash } from "node:crypto";
import type { FredAlertTransition } from "./fred_building_alert_logic";
import { parseFredTelnyxPublicKey } from "./fred_telnyx_webhook";

type Environment = Record<string, string | undefined>;

export const FRED_TEST_MESSAGE =
  "[FRED TEST] Alert delivery is working. No building outage is active. Reply STOP to opt out.";

export type FredAlertRuntimeConfig = {
  enabled: boolean;
  pollIntervalMs: number;
  maxObservationAgeMs: number;
  publicBaseUrl: string | null;
  webhookUrl: string | null;
  webhookFailoverUrl: string | null;
  emailRecipients: string[];
  recipientHashKey: string | null;
};

function positiveSeconds(
  env: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]?.trim() || String(fallback);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a whole number of seconds.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be between ${minimum} and ${maximum} seconds.`,
    );
  }
  return value;
}

function explicitBoolean(
  env: Environment,
  name: string,
  fallback: boolean,
): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be either true or false.`);
}

function loadPublicUrls(env: Environment) {
  const configured = env.FRED_PUBLIC_BASE_URL?.trim();
  if (!configured) {
    return {
      publicBaseUrl: null,
      webhookUrl: null,
      webhookFailoverUrl: null,
    };
  }
  let base: URL;
  try {
    base = new URL(configured);
  } catch {
    throw new Error("FRED_PUBLIC_BASE_URL must be a valid HTTPS URL.");
  }
  if (base.protocol !== "https:") {
    throw new Error("FRED_PUBLIC_BASE_URL must use HTTPS.");
  }
  if (base.username || base.password) {
    throw new Error("FRED_PUBLIC_BASE_URL must not contain credentials.");
  }
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  return {
    publicBaseUrl: base.toString().replace(/\/$/, ""),
    webhookUrl: new URL("/api/telnyx/fred/status", base).toString(),
    webhookFailoverUrl: new URL(
      "/api/telnyx/fred/status/failover",
      base,
    ).toString(),
  };
}

export function loadFredAlertRuntimeConfig(
  env: Environment = process.env,
): FredAlertRuntimeConfig {
  const pollSeconds = positiveSeconds(
    env,
    "FRED_ALERT_POLL_INTERVAL_SECONDS",
    30,
    10,
    86_400,
  );
  const maxObservationAgeSeconds = positiveSeconds(
    env,
    "FRED_ALERT_MAX_OBSERVATION_AGE_SECONDS",
    90,
    pollSeconds,
    86_400,
  );
  const urls = loadPublicUrls(env);
  const enabled = explicitBoolean(env, "FRED_ALERT_ENABLED", false);
  const recipientHashKey = env.FRED_ALERT_RECIPIENT_HASH_KEY?.trim() || null;
  if (enabled && !urls.publicBaseUrl) {
    throw new Error(
      "FRED_PUBLIC_BASE_URL is required when FRED_ALERT_ENABLED=true.",
    );
  }
  if (enabled && (!recipientHashKey || recipientHashKey.length < 32)) {
    throw new Error(
      "FRED_ALERT_RECIPIENT_HASH_KEY must contain at least 32 characters when Fred alerts are enabled.",
    );
  }
  if (urls.publicBaseUrl) {
    // Fail closed before the worker can submit messages whose delivery events
    // this deployment is unable to authenticate.
    parseFredTelnyxPublicKey(env.FRED_TELNYX_PUBLIC_KEY);
  }

  return {
    enabled,
    pollIntervalMs: pollSeconds * 1_000,
    maxObservationAgeMs: maxObservationAgeSeconds * 1_000,
    ...urls,
    recipientHashKey,
    emailRecipients: Array.from(
      new Set(
        (env.FRED_ALERT_EMAIL_TO ?? "")
          .split(/[;,]+/)
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      ),
    ),
  };
}

export function fredDeliveryBaseKey(idempotencyKey: string): string {
  const digest = createHash("sha256")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 40);
  return `fred:${digest}`;
}

export function formatFredAlertMessage(
  transition: Pick<
    FredAlertTransition,
    "kind" | "scope" | "buildingName" | "targetName" | "occurredAt"
  > & { failureThreshold?: number; recoveryThreshold?: number },
): string {
  const subject =
    transition.scope === "building"
      ? `${transition.buildingName} building`
      : `${transition.targetName} switch at ${transition.buildingName}`;
  const when = new Date(transition.occurredAt);
  const timestamp = Number.isNaN(when.getTime())
    ? transition.occurredAt
    : when.toISOString();
  if (transition.kind === "outage") {
    const checks = transition.failureThreshold ?? 3;
    return `[FRED ALERT] ${subject} is offline after ${checks} fresh checks (${timestamp}).`;
  }
  const checks = transition.recoveryThreshold ?? 2;
  return `[FRED RECOVERY] ${subject} is back online after ${checks} fresh checks (${timestamp}).`;
}
