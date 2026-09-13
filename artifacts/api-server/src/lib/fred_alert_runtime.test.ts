import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FRED_TEST_MESSAGE,
  formatFredAlertMessage,
  fredDeliveryBaseKey,
  loadFredAlertRuntimeConfig,
} from "./fred_alert_runtime";

const validTelnyxPublicKey = generateKeyPairSync("ed25519")
  .publicKey.export({ format: "der", type: "spki" })
  .toString("base64");

describe("Fred alert runtime configuration", () => {
  it("defaults to a disabled 30-second worker with 90-second freshness", () => {
    expect(loadFredAlertRuntimeConfig({})).toEqual({
      enabled: false,
      pollIntervalMs: 30_000,
      maxObservationAgeMs: 90_000,
      publicBaseUrl: null,
      webhookUrl: null,
      webhookFailoverUrl: null,
      emailRecipients: [],
      recipientHashKey: null,
    });
  });

  it("builds distinct HTTPS primary and failover callbacks", () => {
    const config = loadFredAlertRuntimeConfig({
      FRED_ALERT_ENABLED: "true",
      FRED_PUBLIC_BASE_URL: "https://fred.example.edu/ignored/path",
      FRED_ALERT_RECIPIENT_HASH_KEY:
        "a-secure-test-key-with-at-least-32-characters",
      FRED_TELNYX_PUBLIC_KEY: validTelnyxPublicKey,
      FRED_ALERT_EMAIL_TO: "noc@example.edu; NOC@example.edu",
    });

    expect(config.webhookUrl).toBe(
      "https://fred.example.edu/api/telnyx/fred/status",
    );
    expect(config.webhookFailoverUrl).toBe(
      "https://fred.example.edu/api/telnyx/fred/status/failover",
    );
    expect(config.webhookUrl).not.toBe(config.webhookFailoverUrl);
    expect(config.emailRecipients).toEqual(["noc@example.edu"]);
  });

  it("fails closed on an enabled worker without a public HTTPS base URL", () => {
    expect(() =>
      loadFredAlertRuntimeConfig({ FRED_ALERT_ENABLED: "true" }),
    ).toThrow(/FRED_PUBLIC_BASE_URL/);
    expect(() =>
      loadFredAlertRuntimeConfig({
        FRED_ALERT_ENABLED: "true",
        FRED_PUBLIC_BASE_URL: "http://fred.example.edu",
        FRED_ALERT_RECIPIENT_HASH_KEY:
          "a-secure-test-key-with-at-least-32-characters",
      }),
    ).toThrow(/HTTPS/);
  });

  it("rejects ambiguous alert enablement values", () => {
    for (const value of ["1", "yes", "enabled", "truthy"]) {
      expect(() =>
        loadFredAlertRuntimeConfig({ FRED_ALERT_ENABLED: value }),
      ).toThrow(/must be either true or false/);
    }
    expect(
      loadFredAlertRuntimeConfig({ FRED_ALERT_ENABLED: " FALSE " }).enabled,
    ).toBe(false);
  });

  it("fails closed when webhook signature verification is not ready", () => {
    expect(() =>
      loadFredAlertRuntimeConfig({
        FRED_ALERT_ENABLED: "true",
        FRED_PUBLIC_BASE_URL: "https://fred.example.edu",
        FRED_ALERT_RECIPIENT_HASH_KEY:
          "a-secure-test-key-with-at-least-32-characters",
      }),
    ).toThrow(/verification is not configured/);
  });

  it("rejects credentials embedded in the public callback URL", () => {
    expect(() =>
      loadFredAlertRuntimeConfig({
        FRED_PUBLIC_BASE_URL: "https://user:password@fred.example.edu",
      }),
    ).toThrow(/must not contain credentials/);
  });

  it("rejects unsafe, overflowing, and non-decimal timer values", () => {
    for (const value of ["2147484", "9007199254740993", "1e3", "30.5"]) {
      expect(() =>
        loadFredAlertRuntimeConfig({
          FRED_ALERT_POLL_INTERVAL_SECONDS: value,
        }),
      ).toThrow(/whole number|between/);
    }
  });
});

describe("Fred alert messages", () => {
  it("labels real outage and recovery transitions", () => {
    const common = {
      scope: "building" as const,
      buildingName: "Technology Center",
      targetName: "Technology Center",
      occurredAt: "2026-09-13T12:00:00.000Z",
    };
    expect(formatFredAlertMessage({ ...common, kind: "outage" })).toContain(
      "[FRED ALERT] Technology Center building is offline after 3 fresh checks",
    );
    expect(formatFredAlertMessage({ ...common, kind: "recovery" })).toContain(
      "[FRED RECOVERY] Technology Center building is back online after 2 fresh checks",
    );
  });

  it("uses a safe fixed test label and stable short delivery keys", () => {
    expect(FRED_TEST_MESSAGE).toContain("[FRED TEST]");
    expect(FRED_TEST_MESSAGE).toContain("No building outage is active");
    const first = fredDeliveryBaseKey("same-transition");
    expect(first).toBe(fredDeliveryBaseKey("same-transition"));
    expect(first).not.toBe(fredDeliveryBaseKey("other-transition"));
    expect(first.length).toBeLessThan(64);
  });
});
