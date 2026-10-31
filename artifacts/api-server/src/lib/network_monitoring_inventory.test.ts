import { describe, expect, it } from "vitest";
import { mergeMonitoringInventory } from "./network_monitoring_inventory";

describe("mergeMonitoringInventory", () => {
  it("preserves a FortiGate topology identity instead of relabeling it as a switch", () => {
    const [result] = mergeMonitoringInventory(
      [{
        id: 87,
        hostname: "westcampus-fortigate",
        building: "West Campus",
        mgmtIp: "172.25.0.1",
        model: "FortiGate-90G",
        status: "unknown",
        lastSeen: null,
        location: null,
      }],
      [{
        id: "firewall-uuid",
        hostname: "WestCampus-Fortigate",
        displayName: "WestCampus-Fortigate",
        nodeKind: "firewall",
        vendor: "Fortinet",
        model: "FortiGate-90G",
        mgmtIp: "172.25.0.1",
        building: "West Campus",
        location: "West Campus IDF",
        role: "firewall",
      }],
    );

    expect(result).toMatchObject({
      id: "firewall-uuid",
      nodeKind: "firewall",
      vendor: "Fortinet",
      role: "firewall",
      displayName: "WestCampus-Fortigate",
    });
  });

  it("retains the legacy fallback for an inventory row without a topology node", () => {
    const [result] = mergeMonitoringInventory(
      [{
        id: 5,
        hostname: "sw-example",
        building: "Hobble",
        mgmtIp: "192.0.2.5",
        model: "Aruba JL659A",
        status: "online",
        lastSeen: null,
        location: "AA 100",
      }],
      [],
    );

    expect(result).toMatchObject({ id: "5", nodeKind: "switch", vendor: "Aruba" });
  });
});
