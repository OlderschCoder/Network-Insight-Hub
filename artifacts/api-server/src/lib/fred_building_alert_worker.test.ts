import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock("../routes/network_nodes", () => ({
  getFredSwitchObservations: vi.fn(),
}));
vi.mock("./email", () => ({
  isEmailConfigured: vi.fn(() => false),
  sendReportEmail: vi.fn(),
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  acquireFredBuildingAlertPollLease,
  completeFredBuildingAlertPollLease,
  evaluateAndPersist,
  findFredFallbackCandidates,
  getFredAlertWorkerHealth,
  isFredTransitionDeliverySuppressed,
  markFredFallbackEmailAccepted,
  markFredQueuedSmsConfigUnavailable,
  markStaleFredEmailSubmissionsUnknown,
  markStaleFredSmsSubmissionsUnknown,
  needsFredFallbackEmail,
  prepareFredBuildingAlerts,
  validateFredEnabledAnchorTopology,
} from "./fred_building_alert_worker";

const validTelnyxPublicKey = generateKeyPairSync("ed25519")
  .publicKey.export({ format: "der", type: "spki" })
  .toString("base64");

function databaseReturning(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows }));
  return { database: { query } as any, query };
}

const anchor = {
  id: "anchor-1",
  buildingKey: "technology-center",
  buildingName: "Technology Center",
  anchorSwitchId: "1",
  anchorHostname: "swa-t122.sccc.edu",
  anchorHost: "192.0.2.10",
  failureThreshold: 3,
  recoveryThreshold: 2,
  children: [],
};

const buildingTransition = {
  kind: "outage" as const,
  scope: "building" as const,
  buildingId: "technology-center",
  buildingName: "Technology Center",
  targetId: "technology-center",
  targetName: "Technology Center",
  anchorSwitchId: "1",
  incidentId: "fred-building-technology-center-20260913120000000",
  idempotencyKey:
    "fred-alert:fred-building-technology-center-20260913120000000:outage",
  occurredAt: "2026-09-13T12:01:00.000Z",
  observationAt: "2026-09-13T12:01:00.000Z",
};

describe("Fred worker startup health", () => {
  it("reports disabled when alerting is explicitly off", () => {
    expect(
      prepareFredBuildingAlerts({ FRED_ALERT_ENABLED: "false" }).enabled,
    ).toBe(false);
    expect(getFredAlertWorkerHealth()).toEqual({
      state: "disabled",
      lastSuccessAt: null,
      lastErrorAt: null,
      errorCode: null,
    });
  });

  it("reports starting only after all enabled configuration validates", () => {
    const runtime = prepareFredBuildingAlerts({
      FRED_ALERT_ENABLED: "true",
      FRED_PUBLIC_BASE_URL: "https://fred.example.edu",
      FRED_TELNYX_PUBLIC_KEY: validTelnyxPublicKey,
      FRED_TELNYX_API_KEY: "test-api-key",
      FRED_TELNYX_MESSAGING_PROFILE_ID: "profile-test",
      FRED_TELNYX_FROM_NUMBER: "+15555550100",
      FRED_ALERT_TO_NUMBERS: "+15555550101",
      FRED_ALERT_RECIPIENT_HASH_KEY:
        "a-secure-test-key-with-at-least-32-characters",
    });

    expect(runtime.enabled).toBe(true);
    expect(getFredAlertWorkerHealth()).toMatchObject({
      state: "starting",
      errorCode: null,
    });
  });

  it("fails startup and exposes only a generic health code", () => {
    expect(() =>
      prepareFredBuildingAlerts({ FRED_ALERT_ENABLED: "true" }),
    ).toThrow(/FRED_PUBLIC_BASE_URL/);
    expect(getFredAlertWorkerHealth()).toMatchObject({
      state: "degraded",
      lastSuccessAt: null,
      errorCode: "configuration_invalid",
    });
    expect(getFredAlertWorkerHealth().lastErrorAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  });
});

describe("Fred durable poll lease", () => {
  it("claims with an expiry longer than one poll and an expired-row gate", async () => {
    const query = vi.fn(async (_text: string, values?: unknown[]) => ({
      rows: [{ lease_token: values?.[1] }],
    }));

    const lease = await acquireFredBuildingAlertPollLease(30_000, {
      query,
    } as any);

    expect(lease).toMatchObject({ pollIntervalMs: 30_000 });
    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain(
      "fred_building_alert_poll_leases.leased_until <= clock_timestamp()",
    );
    expect(sql).toContain(
      "leased_until = clock_timestamp() + ($3::bigint * interval '1 millisecond')",
    );
    expect(sql).not.toContain("leased_until = excluded.leased_until");
    expect(Number(values?.[2])).toBeGreaterThanOrEqual(30_000);
  });

  it("fails closed when another replica holds the lease", async () => {
    const { database } = databaseReturning([]);
    await expect(
      acquireFredBuildingAlertPollLease(30_000, database),
    ).resolves.toBeNull();
  });

  it("does not shorten a completed lease below its poll interval", async () => {
    const token = "00000000-0000-4000-8000-000000000001";
    const { database, query } = databaseReturning([{ lease_token: token }]);
    await expect(
      completeFredBuildingAlertPollLease(
        { token, pollIntervalMs: 30_000 },
        database,
      ),
    ).resolves.toBe(true);
    expect(query.mock.calls[0][0]).toContain(
      "acquired_at + ($3::bigint * interval '1 millisecond')",
    );
    expect(query.mock.calls[0][1]?.[2]).toBe(30_000);
  });

  it("does not let a stale owner complete a replacement lease", async () => {
    const { database } = databaseReturning([]);
    await expect(
      completeFredBuildingAlertPollLease(
        {
          token: "00000000-0000-4000-8000-000000000001",
          pollIntervalMs: 30_000,
        },
        database,
      ),
    ).resolves.toBe(false);
  });

  it("fails closed when the transaction advisory lock is unavailable", async () => {
    const token = "00000000-0000-4000-8000-000000000001";
    const responses = [
      { rows: [] },
      { rows: [{ lease_token: token }] },
      { rows: [{ locked: false }] },
      { rows: [] },
    ];
    const query = vi.fn(async (_text: string, _values?: unknown[]) =>
      responses.shift(),
    );
    const release = vi.fn();

    await expect(
      evaluateAndPersist(
        [],
        [],
        {} as any,
        null,
        { token, pollIntervalMs: 30_000 },
        { connect: async () => ({ query, release }) as any },
      ),
    ).resolves.toBeNull();

    expect(String(query.mock.calls[2]?.[0])).toContain(
      "pg_try_advisory_xact_lock",
    );
    expect(query.mock.calls[3]?.[0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("Fred delivery policy", () => {
  it("gates building and child delivery without changing evaluator input", () => {
    expect(
      isFredTransitionDeliverySuppressed(
        anchor,
        buildingTransition,
        new Set(["building:technology-center"]),
      ),
    ).toBe(true);

    expect(
      isFredTransitionDeliverySuppressed(
        anchor,
        {
          ...buildingTransition,
          scope: "switch",
          targetId: "24",
          targetName: "sw-t122-a24.sccc.edu",
        },
        new Set(["switch:24"]),
      ),
    ).toBe(true);

    expect(
      isFredTransitionDeliverySuppressed(
        anchor,
        buildingTransition,
        new Set(["switch:24"]),
      ),
    ).toBe(false);
  });
});

describe("Fred enabled topology validation", () => {
  it("accepts unique building and switch ownership", () => {
    expect(() =>
      validateFredEnabledAnchorTopology([
        anchor,
        {
          ...anchor,
          id: "anchor-2",
          buildingKey: "student-union",
          buildingName: "Student Union",
          anchorSwitchId: "2",
          children: [
            {
              switchId: "3",
              hostname: "sw-su-a24.sccc.edu",
              host: "192.0.2.12",
            },
          ],
        },
      ]),
    ).not.toThrow();
  });

  it.each([
    [
      "building key",
      { ...anchor, id: "anchor-2", anchorSwitchId: "2" },
      /duplicate building key/,
    ],
    [
      "normalized building name",
      {
        ...anchor,
        id: "anchor-2",
        buildingKey: "technology-center-2",
        buildingName: " TECHNOLOGY CENTER ",
        anchorSwitchId: "2",
      },
      /duplicate building name/,
    ],
    [
      "shared switch",
      {
        ...anchor,
        id: "anchor-2",
        buildingKey: "student-union",
        buildingName: "Student Union",
        anchorSwitchId: "2",
        children: [
          {
            switchId: "1",
            hostname: "duplicate.sccc.edu",
            host: "192.0.2.10",
          },
        ],
      },
      /assigns switch 1 more than once/,
    ],
  ])(
    "rejects a duplicate %s across enabled anchors",
    (_name, duplicate, error) => {
      expect(() =>
        validateFredEnabledAnchorTopology([anchor, duplicate]),
      ).toThrow(error);
    },
  );
});

describe("Fred fallback reconciliation", () => {
  it.each([
    ["missing SMS", [], true],
    ["failed SMS", ["failed"], true],
    ["ambiguous SMS", ["unknown"], true],
    ["queued SMS", ["queued"], false],
    ["sending SMS", ["sending"], false],
    ["accepted SMS", ["accepted"], false],
    ["delivered SMS", ["delivered"], false],
  ])("selects %s correctly", (_name, smsStatuses, expected) => {
    expect(
      needsFredFallbackEmail({
        hasEmailFallback: false,
        deliverySuppressed: false,
        smsStatuses,
      }),
    ).toBe(expected);
  });

  it("excludes an existing email attempt and a suppression-policy audit", () => {
    expect(
      needsFredFallbackEmail({
        hasEmailFallback: true,
        deliverySuppressed: false,
        smsStatuses: ["failed"],
      }),
    ).toBe(false);
    expect(
      needsFredFallbackEmail({
        hasEmailFallback: false,
        deliverySuppressed: true,
        smsStatuses: [],
      }),
    ).toBe(false);
  });

  it("queries outage and recovery history with idempotency guards", async () => {
    const { database, query } = databaseReturning([
      { incident_id: "incident-1", transition_kind: "outage" },
      { incident_id: "incident-1", transition_kind: "recovery" },
    ]);
    await expect(findFredFallbackCandidates(database)).resolves.toEqual([
      { incidentId: "incident-1", transitionKind: "outage" },
      { incidentId: "incident-1", transitionKind: "recovery" },
    ]);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("email_delivery.channel = 'email'");
    expect(sql).toContain("policy_delivery.provider = 'fred_policy'");
    expect(sql).toContain("sms_delivery.status IN ('failed', 'unknown')");
  });

  it("marks only stale in-flight SMS as ambiguous", async () => {
    const { database, query } = databaseReturning([]);
    await markStaleFredSmsSubmissionsUnknown(database);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("SET status = 'unknown'");
    expect(sql).toContain("AND status = 'sending'");
    expect(sql).toContain("attempted_at < now() - interval '2 minutes'");
  });

  it("fails only never-submitted queued SMS when Telnyx config is unavailable", async () => {
    const { database, query } = databaseReturning([]);
    await markFredQueuedSmsConfigUnavailable(database);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("SET status = 'failed'");
    expect(sql).toContain("error_code = 'config_unavailable'");
    expect(sql).toContain("AND status = 'queued'");
    expect(sql).not.toContain("AND status = 'sending'");
    expect(sql).not.toContain("AND status = 'accepted'");
  });

  it("audits stale in-flight SMTP without automatically resending it", async () => {
    const { database, query } = databaseReturning([]);
    await markStaleFredEmailSubmissionsUnknown(database);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("SET status = 'unknown'");
    expect(sql).toContain("AND provider = 'smtp'");
    expect(sql).toContain("AND status = 'sending'");
    expect(sql).toContain("attempted_at < now() - interval '2 minutes'");
  });

  it("records SMTP acceptance without claiming mailbox delivery", async () => {
    const { database, query } = databaseReturning([]);
    await markFredFallbackEmailAccepted("delivery-1", database);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("SET status = 'accepted'");
    expect(sql).toContain("provider_status = 'accepted'");
    expect(sql).not.toContain("delivered_at");
    expect(sql).not.toContain("status = 'delivered'");
  });
});
