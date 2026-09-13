import { describe, expect, it } from "vitest";
import {
  createEmptyFredBuildingAlertState,
  evaluateFredBuildingAlerts,
  fredBuildingTargetKey,
  fredSwitchTargetKey,
  resolveFredSwitchObservation,
  type FredBuildingAlertState,
  type FredSwitchObservation,
} from "./fred_building_alert_logic";

const topology = [
  {
    buildingId: "tech-center",
    buildingName: "Technology Center",
    anchorSwitchId: "swa-t122.sccc.edu",
    childSwitchIds: ["sw-t122-a24.sccc.edu", "sw-t122-a48.sccc.edu"],
  },
] as const;

const config = {
  maxObservationAgeMs: 60_000,
  maxFutureSkewMs: 1_000,
  failureThreshold: 3,
  recoveryThreshold: 2,
};

function observation(
  switchId: string,
  status: FredSwitchObservation["status"],
  observedAt: string,
) {
  return {
    switchId,
    status,
    observedAt,
    source: "noc",
  } satisfies FredSwitchObservation;
}

function evaluate(
  now: string,
  observations: FredSwitchObservation[],
  previousState: FredBuildingAlertState = createEmptyFredBuildingAlertState(),
) {
  return evaluateFredBuildingAlerts({
    now,
    topology,
    observations,
    previousState,
    config,
  });
}

describe("Fred building alert evaluation", () => {
  it("uses only the explicit anchor to determine building health", () => {
    let state = createEmptyFredBuildingAlertState();
    for (const at of [
      "2026-09-13T12:00:00Z",
      "2026-09-13T12:00:30Z",
      "2026-09-13T12:01:00Z",
    ]) {
      const result = evaluate(
        at,
        [observation("sw-t122-a24.sccc.edu", "down", at)],
        state,
      );
      state = result.state;
    }

    expect(state.targets[fredBuildingTargetKey("tech-center")]).toMatchObject({
      phase: "normal",
      consecutiveFreshDowns: 0,
    });
    expect(
      state.targets[fredSwitchTargetKey("tech-center", "sw-t122-a24.sccc.edu")],
    ).toMatchObject({
      phase: "outage",
    });
  });

  it("prefers a fresh NOC down over a stale Influx up", () => {
    const resolved = resolveFredSwitchObservation({
      switchId: "swa-t122.sccc.edu",
      now: "2026-09-13T12:00:00Z",
      config,
      observations: [
        observation("swa-t122.sccc.edu", "down", "2026-09-13T11:59:45Z"),
        {
          switchId: "swa-t122.sccc.edu",
          status: "up",
          observedAt: "2026-09-13T11:55:00Z",
          source: "influx",
        },
      ],
    });

    expect(resolved).toMatchObject({
      status: "down",
      reason: "fresh",
      sources: ["noc"],
    });

    const bothFresh = resolveFredSwitchObservation({
      switchId: "swa-t122.sccc.edu",
      now: "2026-09-13T12:00:00Z",
      config,
      observations: [
        observation("swa-t122.sccc.edu", "down", "2026-09-13T11:59:45Z"),
        {
          switchId: "swa-t122.sccc.edu",
          status: "up",
          observedAt: "2026-09-13T11:59:55Z",
          source: "influx",
        },
      ],
    });
    expect(bothFresh).toMatchObject({
      status: "down",
      reason: "fresh",
      sources: ["noc"],
    });

    const onlyInfluxFresh = resolveFredSwitchObservation({
      switchId: "swa-t122.sccc.edu",
      now: "2026-09-13T12:00:00Z",
      config,
      observations: [
        observation("swa-t122.sccc.edu", "down", "2026-09-13T11:55:00Z"),
        {
          switchId: "swa-t122.sccc.edu",
          status: "up",
          observedAt: "2026-09-13T11:59:55Z",
          source: "influx",
        },
      ],
    });
    expect(onlyInfluxFresh).toMatchObject({
      status: "up",
      reason: "fresh",
      sources: ["influx"],
    });
  });

  it("falls through from a fresh unknown NOC probe to fresh Influx evidence", () => {
    const resolved = resolveFredSwitchObservation({
      switchId: "swa-t122.sccc.edu",
      now: "2026-09-13T12:00:00Z",
      config,
      observations: [
        observation("swa-t122.sccc.edu", "unknown", "2026-09-13T12:00:00Z"),
        {
          switchId: "swa-t122.sccc.edu",
          status: "down",
          observedAt: "2026-09-13T11:59:55Z",
          source: "influx",
        },
      ],
    });

    expect(resolved).toMatchObject({
      status: "down",
      reason: "fresh",
      sources: ["influx"],
    });
  });

  it("keeps conflicting fresh NOC results unknown instead of falling through", () => {
    const resolved = resolveFredSwitchObservation({
      switchId: "swa-t122.sccc.edu",
      now: "2026-09-13T12:00:00Z",
      config,
      observations: [
        observation("swa-t122.sccc.edu", "up", "2026-09-13T12:00:00Z"),
        observation("swa-t122.sccc.edu", "down", "2026-09-13T12:00:00Z"),
        {
          switchId: "swa-t122.sccc.edu",
          status: "up",
          observedAt: "2026-09-13T11:59:55Z",
          source: "influx",
        },
      ],
    });

    expect(resolved).toMatchObject({
      status: "unknown",
      reason: "conflicting",
      sources: ["noc"],
    });
  });

  it("treats missing, stale, future, and explicitly unknown anchor data as unknown rather than down", () => {
    const cases: Array<[string, FredSwitchObservation[]]> = [
      ["missing", []],
      [
        "stale",
        [observation("swa-t122.sccc.edu", "down", "2026-09-13T11:58:00Z")],
      ],
      [
        "future",
        [observation("swa-t122.sccc.edu", "down", "2026-09-13T12:01:00Z")],
      ],
      [
        "reported_unknown",
        [observation("swa-t122.sccc.edu", "unknown", "2026-09-13T12:00:00Z")],
      ],
    ];

    for (const [expectedReason, observations] of cases) {
      const result = evaluate("2026-09-13T12:00:00Z", observations);
      expect(result.evaluations[0]).toMatchObject({
        effectiveStatus: "unknown",
        reason: expectedReason,
        phase: "normal",
        consecutiveFreshDowns: 0,
      });
      expect(result.transitions).toEqual([]);
    }
  });

  it("requires three distinct fresh downs and emits one stable outage transition", () => {
    let state = createEmptyFredBuildingAlertState();
    let outageResult: ReturnType<typeof evaluate> | undefined;

    for (const at of [
      "2026-09-13T12:00:00Z",
      "2026-09-13T12:00:30Z",
      "2026-09-13T12:01:00Z",
    ]) {
      const result = evaluate(
        at,
        [observation("swa-t122.sccc.edu", "down", at)],
        state,
      );
      state = result.state;
      outageResult = result;
    }

    expect(outageResult?.transitions).toHaveLength(1);
    const outage = outageResult!.transitions[0];
    expect(outage).toMatchObject({
      kind: "outage",
      scope: "building",
      buildingId: "tech-center",
    });
    expect(outage.incidentId).toContain("20260913120000000");
    expect(outage.idempotencyKey).toBe(
      `fred-alert:${outage.incidentId}:outage`,
    );

    const repeated = evaluate(
      "2026-09-13T12:01:30Z",
      [observation("swa-t122.sccc.edu", "down", "2026-09-13T12:01:00Z")],
      state,
    );
    expect(repeated.transitions).toEqual([]);
    expect(repeated.evaluations[0].reason).toBe("already_processed");

    const later = evaluate(
      "2026-09-13T12:01:30Z",
      [observation("swa-t122.sccc.edu", "down", "2026-09-13T12:01:30Z")],
      repeated.state,
    );
    expect(later.transitions).toEqual([]);
    expect(
      later.state.targets[fredBuildingTargetKey("tech-center")]
        .activeIncidentId,
    ).toBe(outage.incidentId);
  });

  it("keeps lossy-slug target identities collision-resistant and stable", () => {
    const collidingTopology = [
      {
        buildingId: "a-b",
        buildingName: "Building A-B",
        anchorSwitchId: "anchor-one",
        childSwitchIds: [],
      },
      {
        buildingId: "a_b",
        buildingName: "Building A underscore B",
        anchorSwitchId: "anchor-two",
        childSwitchIds: [],
      },
    ];
    let state = createEmptyFredBuildingAlertState();
    let transitions: ReturnType<
      typeof evaluateFredBuildingAlerts
    >["transitions"] = [];
    for (const at of [
      "2026-09-13T12:00:00Z",
      "2026-09-13T12:00:30Z",
      "2026-09-13T12:01:00Z",
    ]) {
      const result = evaluateFredBuildingAlerts({
        now: at,
        topology: collidingTopology,
        observations: [
          observation("anchor-one", "down", at),
          observation("anchor-two", "down", at),
        ],
        previousState: state,
        config,
      });
      state = result.state;
      transitions = result.transitions;
    }

    expect(transitions).toHaveLength(2);
    expect(new Set(transitions.map((item) => item.incidentId)).size).toBe(2);

    const replay = evaluateFredBuildingAlerts({
      now: "2026-09-13T12:01:00Z",
      topology: collidingTopology,
      observations: [
        observation("anchor-one", "down", "2026-09-13T12:01:00Z"),
        observation("anchor-two", "down", "2026-09-13T12:01:00Z"),
      ],
      previousState: createEmptyFredBuildingAlertState(),
      config: { ...config, failureThreshold: 1 },
    });
    const replayAgain = evaluateFredBuildingAlerts({
      now: "2026-09-13T12:01:00Z",
      topology: collidingTopology,
      observations: [
        observation("anchor-one", "down", "2026-09-13T12:01:00Z"),
        observation("anchor-two", "down", "2026-09-13T12:01:00Z"),
      ],
      previousState: createEmptyFredBuildingAlertState(),
      config: { ...config, failureThreshold: 1 },
    });
    expect(replayAgain.transitions).toEqual(replay.transitions);
  });

  it("starts a new failure sequence after a long observation gap", () => {
    const first = evaluate("2026-09-13T12:00:00Z", [
      observation("swa-t122.sccc.edu", "down", "2026-09-13T12:00:00Z"),
    ]);
    const second = evaluate(
      "2026-09-13T12:00:30Z",
      [observation("swa-t122.sccc.edu", "down", "2026-09-13T12:00:30Z")],
      first.state,
    );
    const afterGap = evaluate(
      "2026-09-13T12:02:31Z",
      [observation("swa-t122.sccc.edu", "down", "2026-09-13T12:02:31Z")],
      second.state,
    );

    expect(afterGap.transitions).toEqual([]);
    expect(afterGap.evaluations[0]).toMatchObject({
      reason: "fresh",
      consecutiveFreshDowns: 1,
    });
    expect(
      afterGap.state.targets[fredBuildingTargetKey("tech-center")]
        .downSequenceStartedAt,
    ).toBe("2026-09-13T12:02:31.000Z");
  });

  it("lets a quick opposite observation break a consecutive failure sequence", () => {
    const firstDown = evaluate("2026-09-13T12:00:00Z", [
      observation("swa-t122.sccc.edu", "down", "2026-09-13T12:00:00Z"),
    ]);
    const quickUp = evaluate(
      "2026-09-13T12:00:05Z",
      [observation("swa-t122.sccc.edu", "up", "2026-09-13T12:00:05Z")],
      firstDown.state,
    );
    const nextDown = evaluate(
      "2026-09-13T12:00:30Z",
      [observation("swa-t122.sccc.edu", "down", "2026-09-13T12:00:30Z")],
      quickUp.state,
    );

    expect(nextDown.transitions).toEqual([]);
    expect(nextDown.evaluations[0]).toMatchObject({
      consecutiveFreshDowns: 1,
      consecutiveFreshUps: 0,
    });
  });

  it("replays deterministically and recovers once after two distinct fresh ups", () => {
    let state = createEmptyFredBuildingAlertState();
    let outageId = "";
    for (const at of [
      "2026-09-13T12:00:00Z",
      "2026-09-13T12:00:30Z",
      "2026-09-13T12:01:00Z",
    ]) {
      const result = evaluate(
        at,
        [observation("swa-t122.sccc.edu", "down", at)],
        state,
      );
      state = result.state;
      outageId = result.transitions[0]?.incidentId ?? outageId;
    }

    const firstUpInput = [
      observation("swa-t122.sccc.edu", "up", "2026-09-13T12:01:30Z"),
    ];
    const firstUp = evaluate("2026-09-13T12:01:30Z", firstUpInput, state);
    const replay = evaluate("2026-09-13T12:01:30Z", firstUpInput, state);
    expect(replay).toEqual(firstUp);
    expect(firstUp.transitions).toEqual([]);

    const recovery = evaluate(
      "2026-09-13T12:02:00Z",
      [observation("swa-t122.sccc.edu", "up", "2026-09-13T12:02:00Z")],
      firstUp.state,
    );
    expect(recovery.transitions).toHaveLength(1);
    expect(recovery.transitions[0]).toMatchObject({
      kind: "recovery",
      incidentId: outageId,
      idempotencyKey: `fred-alert:${outageId}:recovery`,
    });

    const repeatedUp = evaluate(
      "2026-09-13T12:02:30Z",
      [observation("swa-t122.sccc.edu", "up", "2026-09-13T12:02:30Z")],
      recovery.state,
    );
    expect(repeatedUp.transitions).toEqual([]);
  });

  it("starts a new recovery sequence after a long observation gap", () => {
    let state = createEmptyFredBuildingAlertState();
    for (const at of [
      "2026-09-13T12:00:00Z",
      "2026-09-13T12:00:30Z",
      "2026-09-13T12:01:00Z",
    ]) {
      state = evaluate(
        at,
        [observation("swa-t122.sccc.edu", "down", at)],
        state,
      ).state;
    }

    const firstUp = evaluate(
      "2026-09-13T12:01:30Z",
      [observation("swa-t122.sccc.edu", "up", "2026-09-13T12:01:30Z")],
      state,
    );
    const afterGap = evaluate(
      "2026-09-13T12:03:31Z",
      [observation("swa-t122.sccc.edu", "up", "2026-09-13T12:03:31Z")],
      firstUp.state,
    );

    expect(afterGap.transitions).toEqual([]);
    expect(afterGap.evaluations[0]).toMatchObject({
      phase: "outage",
      consecutiveFreshUps: 1,
    });
    const recovery = evaluate(
      "2026-09-13T12:04:01Z",
      [observation("swa-t122.sccc.edu", "up", "2026-09-13T12:04:01Z")],
      afterGap.state,
    );
    expect(recovery.transitions).toHaveLength(1);
    expect(recovery.transitions[0].kind).toBe("recovery");
  });

  it("suppresses child-switch outages while the building anchor is in outage", () => {
    let state = createEmptyFredBuildingAlertState();
    let result: ReturnType<typeof evaluate> | undefined;

    for (const at of [
      "2026-09-13T12:00:00Z",
      "2026-09-13T12:00:30Z",
      "2026-09-13T12:01:00Z",
    ]) {
      result = evaluate(
        at,
        [
          observation("swa-t122.sccc.edu", "down", at),
          observation("sw-t122-a24.sccc.edu", "down", at),
          observation("sw-t122-a48.sccc.edu", "down", at),
        ],
        state,
      );
      state = result.state;
    }

    expect(result?.transitions).toHaveLength(1);
    expect(result?.transitions[0]).toMatchObject({
      scope: "building",
      kind: "outage",
    });
    expect(result?.suppressedSwitchIds).toEqual([
      "sw-t122-a24.sccc.edu",
      "sw-t122-a48.sccc.edu",
    ]);
    expect(
      state.targets[fredSwitchTargetKey("tech-center", "sw-t122-a24.sccc.edu")],
    ).toMatchObject({
      phase: "normal",
      consecutiveFreshDowns: 0,
    });

    const stillDown = evaluate(
      "2026-09-13T12:01:30Z",
      [
        observation("swa-t122.sccc.edu", "down", "2026-09-13T12:01:30Z"),
        observation("sw-t122-a24.sccc.edu", "down", "2026-09-13T12:01:30Z"),
      ],
      state,
    );
    expect(stillDown.transitions).toEqual([]);
    expect(
      stillDown.evaluations.find((item) => item.scope === "switch"),
    ).toMatchObject({
      effectiveStatus: "unknown",
      reason: "building_outage",
      suppressed: true,
    });
  });

  it("fails closed when topology does not provide a valid explicit anchor", () => {
    expect(() =>
      evaluateFredBuildingAlerts({
        now: "2026-09-13T12:00:00Z",
        topology: [
          {
            buildingId: "tech-center",
            buildingName: "Technology Center",
            anchorSwitchId: "",
            childSwitchIds: [],
          },
        ],
        observations: [],
      }),
    ).toThrow(/explicit anchorSwitchId/);
  });
});
