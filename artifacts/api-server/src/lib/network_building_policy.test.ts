import { describe, expect, it } from "vitest";
import {
  hasMaintainedBuildingAssignment,
  reconcileTelemetryBuilding,
} from "./network_building_policy";

describe("network building ownership", () => {
  it("recognizes only meaningful maintained assignments", () => {
    expect(hasMaintainedBuildingAssignment("Student Living Center")).toBe(true);
    expect(hasMaintainedBuildingAssignment("Unknown")).toBe(false);
    expect(hasMaintainedBuildingAssignment("Unassigned")).toBe(false);
    expect(hasMaintainedBuildingAssignment(null)).toBe(false);
  });

  it("does not let collector metadata relocate a maintained switch", () => {
    expect(
      reconcileTelemetryBuilding(
        "Student Living Center",
        "Student Living Center",
        "Student Union / Student Activities",
      ),
    ).toEqual({
      authoritativeBuilding: "Student Living Center",
      reportedBuilding: "Student Union / Student Activities",
      maintainedBuildingConflict: false,
      buildingConflict: true,
    });
  });

  it("falls back to maintained inventory for an unassigned topology node", () => {
    expect(
      reconcileTelemetryBuilding("Unknown", "West Campus", "West Campus"),
    ).toEqual({
      authoritativeBuilding: "West Campus",
      reportedBuilding: "West Campus",
      maintainedBuildingConflict: false,
      buildingConflict: false,
    });
  });

  it("exposes conflicting maintained node and inventory assignments", () => {
    expect(
      reconcileTelemetryBuilding(
        "Student Living Center",
        "Student Union / Student Activities",
        "Student Union / Student Activities",
      ),
    ).toEqual({
      authoritativeBuilding: "Student Living Center",
      reportedBuilding: "Student Union / Student Activities",
      maintainedBuildingConflict: true,
      buildingConflict: true,
    });
  });
});
