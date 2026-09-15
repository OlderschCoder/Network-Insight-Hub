import { describe, expect, it } from "vitest";
import {
  buildingHealthFromConnectivity,
  designatedMainSwitchStatus,
  enabledMainSwitchIdsByBuilding,
  phoneConnectivityStatus,
  summarizeBuildingConnectivity,
  type BuildingPhoneEvidence,
} from "./building_health";

const phones = (
  online: number,
  offline: number,
  unknown = 0,
  overrides: Partial<BuildingPhoneEvidence> = {},
): BuildingPhoneEvidence => ({
  total: online + offline + unknown,
  online,
  offline,
  unknown,
  assignedOwners: online + offline + unknown,
  matchedOwners: online + offline + unknown,
  complete: unknown === 0,
  observedAt: "2026-09-14T18:00:00.000Z",
  ...overrides,
});

describe("building connectivity health", () => {
  it("is green only when every monitored switch is up", () => {
    expect(buildingHealthFromConnectivity(["up", "up"], phones(0, 2))).toBe(
      "green",
    );
    expect(
      buildingHealthFromConnectivity(["up", "unknown"], phones(2, 0)),
    ).toBe("amber");
  });

  it("is amber for any verified partial switch fault", () => {
    expect(buildingHealthFromConnectivity(["up", "down"], phones(0, 2))).toBe(
      "amber",
    );
    expect(
      buildingHealthFromConnectivity(["degraded", "up"], phones(2, 0)),
    ).toBe("amber");
    expect(buildingHealthFromConnectivity(["down", "down"])).toBe("amber");
  });

  it("is red only when the explicit main switch and complete assigned-phone evidence are down", () => {
    expect(
      buildingHealthFromConnectivity(["down", "down"], phones(0, 3), {
        mainSwitchStatus: "down",
      }),
    ).toBe("red");
    expect(buildingHealthFromConnectivity(["down", "down"], phones(0, 3))).toBe(
      "amber",
    );
    expect(
      buildingHealthFromConnectivity(["down", "down"], phones(1, 2), {
        mainSwitchStatus: "down",
      }),
    ).toBe("amber");
    expect(
      buildingHealthFromConnectivity(["down", "down"], phones(0, 2, 1), {
        mainSwitchStatus: "down",
      }),
    ).toBe("amber");
    expect(
      buildingHealthFromConnectivity(["up", "down"], phones(0, 2), {
        mainSwitchStatus: "up",
      }),
    ).toBe("amber");
    expect(
      buildingHealthFromConnectivity(["down"], phones(0, 2)),
    ).toBe("amber");
  });

  it("uses only enabled explicit anchor rows as main-switch designations", () => {
    const anchors = enabledMainSwitchIdsByBuilding(
      [
        { buildingName: "Mansions", anchorSwitchId: 176, enabled: false },
        { buildingName: "Student Living Center", anchorSwitchId: 175, enabled: true },
      ],
      (name) => name.trim().toLowerCase(),
    );

    expect(anchors.has("mansions")).toBe(false);
    expect(anchors.get("student living center")).toBe(175);
  });

  it("fails closed when two enabled rows resolve to different anchors for one building", () => {
    const anchors = enabledMainSwitchIdsByBuilding(
      [
        { buildingName: "SLC", anchorSwitchId: 175, enabled: true },
        { buildingName: "Student Living Center", anchorSwitchId: 179, enabled: true },
        { buildingName: "Legacy SLC", anchorSwitchId: 175, enabled: true },
      ],
      () => "Student Living Center",
    );

    expect(anchors.has("Student Living Center")).toBe(false);
  });

  it("does not promote a sole switch observation without an enabled designation", () => {
    const statuses = new Map([[176, "down" as const]]);

    expect(designatedMainSwitchStatus(undefined, statuses)).toBeUndefined();
    expect(designatedMainSwitchStatus(176, statuses)).toBe("down");
  });

  it("composes sole-switch map health from enabled anchor evidence only", () => {
    const statuses = new Map([[176, "down" as const]]);

    expect(
      summarizeBuildingConnectivity(["down"], phones(0, 2), undefined, statuses),
    ).toEqual({
      healthColor: "amber",
      mainSwitchConfigured: false,
      mainSwitchStatus: "unknown",
    });
    expect(
      summarizeBuildingConnectivity(["down"], phones(0, 2), 176, statuses),
    ).toEqual({
      healthColor: "red",
      mainSwitchConfigured: true,
      mainSwitchStatus: "down",
    });
  });

  it("keeps missing switch evidence unknown", () => {
    expect(buildingHealthFromConnectivity([], phones(0, 3))).toBe("unknown");
    expect(
      buildingHealthFromConnectivity(["unknown", "unknown"], phones(0, 3)),
    ).toBe("unknown");
  });

  it("can use an explicit main-switch observation when the switch list is empty", () => {
    expect(
      buildingHealthFromConnectivity([], phones(0, 3), {
        mainSwitchStatus: "down",
      }),
    ).toBe("red");
  });

  it("reduces phone evidence without treating incomplete or unknown phones as down", () => {
    expect(phoneConnectivityStatus(phones(1, 2))).toBe("up");
    expect(phoneConnectivityStatus(phones(0, 2))).toBe("down");
    expect(phoneConnectivityStatus(phones(0, 2, 1))).toBe("unknown");
    expect(
      phoneConnectivityStatus(
        phones(0, 1, 0, {
          assignedOwners: 2,
          matchedOwners: 1,
          complete: false,
        }),
      ),
    ).toBe("unknown");
    expect(phoneConnectivityStatus()).toBe("unknown");
  });
});
