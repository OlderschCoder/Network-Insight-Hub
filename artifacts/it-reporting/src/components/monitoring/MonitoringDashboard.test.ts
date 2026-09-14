import { describe, expect, it } from "vitest";
import { getCampusMapDisplayEntries } from "@/pages/network/buildings";
import {
  getCampusMapBuildings,
  snapshotMode,
  type MonitoringSnapshot,
} from "./MonitoringDashboard";

function snapshotWithBusinessUnknown(): MonitoringSnapshot {
  const mappedBuildings = getCampusMapDisplayEntries([]).map((entry) => ({
    name: entry.buildingName,
    nodeCount: 1,
    vlanCount: 0,
    healthColor: "green" as const,
  }));

  return {
    configured: true,
    reachable: true,
    lastUpdatedAt: "2026-09-14T12:00:00.000Z",
    overview: {
      totalDevices: 40,
      monitoredDevices: 40,
      upDevices: 40,
      degradedDevices: 0,
      downDevices: 0,
      unknownDevices: 0,
      totalBuildings: mappedBuildings.length + 1,
      healthyBuildings: mappedBuildings.length,
      degradedBuildings: 0,
      downBuildings: 0,
      unknownBuildings: 1,
      totalVlans: 0,
    },
    traffic: {
      campusBackboneLoadBps: null,
      firewallThroughputBps: null,
      firewallUploadBps: null,
      firewallDownloadBps: null,
    },
    trend: [],
    vendors: [],
    deviceKinds: [],
    alertingDevices: [],
    buildings: [
      ...mappedBuildings,
      { name: "Business", nodeCount: 0, vlanCount: 0, healthColor: "unknown" },
    ],
  };
}

describe("Monitoring campus-map visibility", () => {
  it("uses the saved layout for both the map count and overall monitoring mode", () => {
    const snapshot = snapshotWithBusinessUnknown();
    const savedLayout = {
      "CUSTOM:Business": { visible: false },
      MAN: { visible: true },
    };

    expect(
      getCampusMapBuildings(snapshot).some(({ code }) => code === "CUSTOM:Business"),
    ).toBe(true);
    expect(
      getCampusMapBuildings(snapshot, savedLayout).some(
        ({ code }) => code === "CUSTOM:Business",
      ),
    ).toBe(false);
    expect(snapshotMode(snapshot)).toBe("degraded");
    expect(snapshotMode(snapshot, savedLayout)).toBe("healthy");
  });
});
