import { describe, expect, it } from "vitest";
import { topologyNodeMatchesSwitch } from "./network_retirement_policy";

describe("network asset retirement identity", () => {
  it("uses an authoritative management IP even when display names differ", () => {
    expect(
      topologyNodeMatchesSwitch(
        { hostname: "maintained-name", ipAddress: "192.168.2.200" },
        { hostname: "collector-name", mgmtIp: "192.168.2.200" },
      ),
    ).toBe(true);
  });

  it("does not delete a same-name node that has a different authoritative IP", () => {
    expect(
      topologyNodeMatchesSwitch(
        { hostname: "swa-su121", ipAddress: "192.168.2.200" },
        { hostname: "SWA-SU121.sccc.edu", mgmtIp: "192.168.2.201" },
      ),
    ).toBe(false);
  });

  it("falls back to normalized hostname when one side has no authoritative IP", () => {
    expect(
      topologyNodeMatchesSwitch(
        { hostname: "SWA-SU121.sccc.edu", ipAddress: "unknown" },
        { hostname: "swa-su121", mgmtIp: null },
      ),
    ).toBe(true);
  });
});
