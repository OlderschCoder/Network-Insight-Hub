import { describe, expect, it } from "vitest";
import { diagnosticsBuildingName } from "./building_diagnostics_catalog";

describe("endpoint diagnostics building catalog", () => {
  it("excludes service scopes that are not physical buildings", () => {
    expect(diagnosticsBuildingName("Azure Connectivity (Objects)")).toBeNull();
    expect(diagnosticsBuildingName("Azure (Hybrid-VNet)")).toBeNull();
    expect(diagnosticsBuildingName("Business")).toBeNull();
    expect(diagnosticsBuildingName("Campus Wide")).toBeNull();
    expect(diagnosticsBuildingName("Maintenance")).toBeNull();
  });

  it("keeps real sites and consolidates the former Epworth location", () => {
    expect(diagnosticsBuildingName("Baseball Field")).toBe("Baseball Field");
    expect(diagnosticsBuildingName("Maintenance Building")).toBe("Maintenance Building");
    expect(diagnosticsBuildingName("Epworth ALC")).toBe("Industrial Technology Campus");
    expect(diagnosticsBuildingName("Technology B")).toBe("Tech Building B");
  });
});
