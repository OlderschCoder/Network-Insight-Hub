import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTHORITATIVE_BUILDINGS,
  getAssignedBuildingName,
  getCanonicalBuildingName,
} from "./building_assignment";

describe("Mansions building assignment", () => {
  it("keeps Mansions in the authoritative building list", () => {
    expect(DEFAULT_AUTHORITATIVE_BUILDINGS).toContain("Mansions");
    expect(getCanonicalBuildingName("Mansions")).toBe("Mansions");
  });

  it.each([
    ["SWA-SLAB", "Student Living A&B"],
    ["SWA-SLCDE", "Student Living C&D"],
  ])("assigns %s telemetry to Mansions", (hostname, location) => {
    expect(getAssignedBuildingName("Student Living Center", location, hostname)).toBe("Mansions");
  });

  it("does not absorb the Student Living Center switch", () => {
    expect(getAssignedBuildingName("Student Living Center", "SLC151", "SWA-SLC151")).toBe(
      "Student Living Center",
    );
  });
});
