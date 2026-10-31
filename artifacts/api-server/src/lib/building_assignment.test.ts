import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTHORITATIVE_BUILDINGS,
  getAssignedBuildingName,
  getCanonicalBuildingName,
} from "./building_assignment";

describe("student building assignments", () => {
  it("keeps Student Union and Student Activities distinct", () => {
    expect(getCanonicalBuildingName("Student Union")).toBe("Student Union");
    expect(getCanonicalBuildingName("Student Activities")).toBe("Student Activities");
    expect(DEFAULT_AUTHORITATIVE_BUILDINGS).toContain("Student Union");
    expect(DEFAULT_AUTHORITATIVE_BUILDINGS).toContain("Student Activities");
    expect(DEFAULT_AUTHORITATIVE_BUILDINGS).not.toContain("Student Union / Student Activities");
  });

  it.each([
    ["sw-sa208", "Student Activities"],
    ["SUGymCam", "Student Activities"],
    ["sw-sa208-replay", "Student Activities"],
    ["swa-su121", "Student Union"],
    ["SW-Cafe", "Student Union"],
  ])("assigns %s to %s", (hostname, expected) => {
    expect(getAssignedBuildingName("Student Union / Student Activities", null, hostname)).toBe(expected);
  });

  it("honors a later explicit move instead of pinning a switch by hostname", () => {
    expect(getAssignedBuildingName("West Campus", null, "sugymcam")).toBe("West Campus");
  });

  it("keeps the legacy combined label identifiable until its records are migrated", () => {
    expect(getCanonicalBuildingName("Student Union / Student Activities")).toBe(
      "Student Union / Student Activities",
    );
  });

  it("keeps the user-managed Mansions building authoritative", () => {
    expect(DEFAULT_AUTHORITATIVE_BUILDINGS).toContain("Mansions");
    expect(getAssignedBuildingName("Mansions", "Student Living AB", "SWA-SLAB")).toBe("Mansions");
    expect(getAssignedBuildingName("Mansions", "Student Living DE", "SWA-SLCDE")).toBe("Mansions");
  });
});
