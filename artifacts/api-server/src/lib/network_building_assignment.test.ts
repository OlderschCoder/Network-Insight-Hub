import { describe, expect, it } from "vitest";
import { selectTopologyNodesForMaintainedSwitch } from "./network_building_assignment";

const nodes = [
  { id: "correct-ip", hostname: "old-name", mgmtIp: "192.168.2.175", nodeKind: "switch", building: "Old" },
  { id: "hostname-only", hostname: "swa-slc151.sccc.edu", mgmtIp: "192.168.2.99", nodeKind: "switch", building: "Old" },
  { id: "logical", hostname: "swa-slc151", mgmtIp: "192.168.2.175", nodeKind: "svi", building: "Old" },
];

describe("maintained switch building synchronization", () => {
  it("uses management IP before a conflicting hostname", () => {
    const matches = selectTopologyNodesForMaintainedSwitch(
      nodes,
      null,
      { hostname: "swa-slc151", ipAddress: "192.168.2.175" },
    );
    expect(matches.map((node) => node.id)).toEqual(["correct-ip"]);
  });

  it("uses the previous management IP while editing an identity", () => {
    const matches = selectTopologyNodesForMaintainedSwitch(
      nodes,
      { hostname: "old-name", ipAddress: "192.168.2.175" },
      { hostname: "new-name", ipAddress: "192.168.2.176" },
    );
    expect(matches.map((node) => node.id)).toEqual(["correct-ip"]);
  });

  it("falls back to normalized hostname without touching logical nodes", () => {
    const matches = selectTopologyNodesForMaintainedSwitch(
      nodes,
      null,
      { hostname: "SWA-SLC151", ipAddress: "unknown" },
    );
    expect(matches.map((node) => node.id)).toEqual(["hostname-only"]);
  });
});
