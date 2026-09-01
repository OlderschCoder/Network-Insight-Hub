import { describe, expect, it } from "vitest";
import { buildArchitectureProjection } from "./fred_architecture_store";

describe("Fred normalized architecture projection", () => {
  it("projects assets, ports, buildings, and relationships without losing structured attributes", () => {
    const result = buildArchitectureProjection({
      generatedAt: "2026-09-01T01:00:00.000Z",
      inventory: {
        buildingCoverage: [{ building: "Allied Health", ports: 48 }],
        switches: [{ hostname: "CAH", building: "Allied Health", ipAddress: "192.168.2.216" }],
        nodes: [{ id: "node-1", hostname: "CAH", displayName: "Allied Health", building: "Allied Health" }],
        vlans: [{ vlanId: 20, name: "Voice", building: "Allied Health" }],
        ports: [{ id: "port-1", nodeId: "node-1", name: "1/1/1", operStatus: "up" }],
        links: [{ id: "link-1", aNodeId: "node-1", zNodeId: "core-1", aPort: "1/1/48", zPort: "Eth1/1" }],
      },
      cloud: { azureResources: [{ id: "vm-1", name: "app-server2", type: "virtualMachine" }] },
      operations: { processes: [], projects: [] },
    });

    expect(result.entities.map((row) => row.entity_type)).toEqual(expect.arrayContaining(["building", "switch", "network_node", "vlan", "port", "network_link", "azure_resource"]));
    expect(result.entities.find((row) => row.entity_type === "port")?.attributes).toMatchObject({ operStatus: "up" });
    expect(result.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationship_type: "building_contains", from_key: "Allied Health", to_key: "CAH" }),
      expect.objectContaining({ relationship_type: "node_has_port", from_key: "node-1", to_key: "node-1:1/1/1" }),
      expect.objectContaining({ relationship_type: "network_link", from_key: "node-1", to_key: "core-1" }),
    ]));
  });

  it("deduplicates records that share the same type and natural key", () => {
    const result = buildArchitectureProjection({
      generatedAt: "2026-09-01T01:00:00.000Z",
      inventory: { phoneAssignments: [{ building: "Hobble", count: 2 }, { building: "Hobble", count: 3 }] },
    });
    expect(result.entities.filter((row) => row.entity_type === "phone_building" && row.natural_key === "Hobble")).toHaveLength(1);
  });
});
