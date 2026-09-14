import { describe, expect, it } from "vitest";
import { buildNetworkInventoryAppendix, extractNetworkConfigFacts } from "./fred_architecture_inventory.js";

describe("Fred architecture inventory", () => {
  it("includes every supplied physical port and completeness counts", () => {
    const appendix = buildNetworkInventoryAppendix({ generatedAt: "2026-09-01T00:00:00Z", switches: [{ hostname: "sw1", building: "A", ipAddress: "1.1.1.1" }], nodes: [{ id: "n1", hostname: "sw1", building: "A" }], vlans: [], links: [], routing: [], phoneAssignments: [{ building: "A", count: 3 }], configFacts: [], ports: [{ nodeId: "n1", interfaceName: "1/1/1", operStatus: "up" }, { nodeId: "n1", interfaceName: "1/1/2", operStatus: "down" }] });
    expect(appendix).toContain("| Physical Port Map interfaces | 2 |");
    expect(appendix).toContain("1/1/1");
    expect(appendix).toContain("1/1/2");
    expect(appendix).toContain("| Building phone assignments | 3 |");
  });

  it("renders uncollected counters, utilization, and DOM as blank evidence", () => {
    const appendix = buildNetworkInventoryAppendix({
      generatedAt: "2026-09-14T00:00:00Z",
      switches: [{ hostname: "sw1", building: "A", ipAddress: "1.1.1.1" }],
      nodes: [{ id: "n1", hostname: "sw1", building: "A" }],
      vlans: [],
      links: [],
      routing: [],
      phoneAssignments: [],
      configFacts: [],
      ports: [{
        nodeId: "n1",
        interfaceName: "1/1/1",
        operStatus: "up",
        telemetryUpdatedAt: "2026-09-14T00:00:00Z",
      }],
    });

    const portRow = appendix
      .split("\n")
      .find((line) => line.startsWith("1/1/1 |"));
    expect(portRow).toBeDefined();
    expect(portRow).toContain("—/—");
    expect(portRow).not.toContain("0/0");
    expect(portRow).not.toMatch(/\| 0(?:\.0+)? \|/);
  });

  it("preserves zero only when the counters were actually observed", () => {
    const appendix = buildNetworkInventoryAppendix({
      generatedAt: "2026-09-14T00:00:00Z",
      switches: [{ hostname: "sw1", building: "A", ipAddress: "1.1.1.1" }],
      nodes: [{ id: "n1", hostname: "sw1", building: "A" }],
      vlans: [],
      links: [],
      routing: [],
      phoneAssignments: [],
      configFacts: [],
      ports: [{
        nodeId: "n1",
        interfaceName: "1/1/1",
        inErrors: 0,
        outErrors: 0,
        utilizationPct: 0,
        opticsStatus: "normal",
        rxPowerDbm: -4.1,
        txPowerDbm: -2.2,
      }],
    });

    const portRow = appendix
      .split("\n")
      .find((line) => line.startsWith("1/1/1 |"));
    expect(portRow).toContain("0/0");
    expect(portRow).toContain("normal");
    expect(portRow).toContain("-4.1/-2.2");
  });

  it("extracts routing facts without secret lines", () => {
    const facts = extractNetworkConfigFacts([{ deviceName: "fw", deviceType: "fortigate", createdAt: "2026-09-01", filename: "fw.conf", content: "config vdom\nset password nope\nrouter ospf\nconfig vrf" }]);
    expect(facts[0].facts).toEqual(["config vdom", "router ospf", "config vrf"]);
  });
});
