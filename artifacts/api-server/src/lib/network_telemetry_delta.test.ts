import { describe, expect, it } from "vitest";
import { computeTelemetryPortDelta } from "./network_telemetry_delta";

describe("telemetry snapshot delta", () => {
  it("separates operational, administrative, VLAN, added, and missing changes", () => {
    const at = new Date("2026-09-01T00:00:00Z");
    const result = computeTelemetryPortDelta(
      [
        { interfaceName: "Ethernet1/1", telemetryUpdatedAt: at, operStatus: "down", adminStatus: "up", nativeVlan: 10, description: "Desk" },
        { interfaceName: "Eth1/2", telemetryUpdatedAt: at, operStatus: "up", adminStatus: "up", nativeVlan: 20, description: "Phone" },
        { interfaceName: "Eth1/4", telemetryUpdatedAt: at, operStatus: "up", isPhysical: true },
      ],
      [
        { interfaceName: "Eth1/1", operStatus: "up", adminStatus: "up", nativeVlan: 10, description: "Desk" },
        { interfaceName: "Eth1/2", operStatus: "down", adminStatus: "down", nativeVlan: 30, description: "Phone moved" },
        { interfaceName: "Eth1/3", operStatus: "up", adminStatus: "up", nativeVlan: 40, description: "New" },
      ],
    );
    expect(result).toMatchObject({ downToUp: 1, upToDown: 1, adminChanges: 1, vlanChanges: 1, descriptionChanges: 1, portsAdded: 1, portsMissing: 1 });
  });

  it("does not call first telemetry on a config-only port a configuration change", () => {
    const result = computeTelemetryPortDelta(
      [{ interfaceName: "1/1/1", telemetryUpdatedAt: null, nativeVlan: 10, adminStatus: "up" }],
      [{ interfaceName: "1/1/1", operStatus: "up", adminStatus: "down", nativeVlan: 20, description: null }],
    );
    expect(result).toMatchObject({ portsAdded: 1, adminChanges: 0, vlanChanges: 0 });
  });
});
