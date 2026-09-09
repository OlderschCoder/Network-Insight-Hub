import { describe, expect, it } from "vitest";
import { getCampusMapDisplayEntries, type CampusMapBuildingHealth } from "./buildings";

function building(
  name: string,
  displayOnCampusMap = true,
): CampusMapBuildingHealth {
  return { name, healthColor: "green", displayOnCampusMap };
}

describe("campus map building display entries", () => {
  it("honors a known building's hidden-map setting", () => {
    const entries = getCampusMapDisplayEntries([
      building("Student Activities", false),
      building("Student Union"),
    ]);

    expect(entries.find(({ code }) => code === "SA")).toBeUndefined();
    expect(entries.find(({ code }) => code === "SU")?.match?.name).toBe("Student Union");
  });

  it("keeps custom buildings visible with a stable custom entry", () => {
    const entries = getCampusMapDisplayEntries([
      building("Warehouse Annex"),
    ]);

    expect(entries).toContainEqual(expect.objectContaining({
      code: "CUSTOM:Warehouse%20Annex",
      buildingName: "Warehouse Annex",
      displayCode: "WA",
      match: expect.objectContaining({ name: "Warehouse Annex" }),
    }));
  });

  it("does not emit a custom entry for a hidden custom building", () => {
    const entries = getCampusMapDisplayEntries([
      building("Warehouse Annex", false),
    ]);

    expect(entries.some(({ buildingName }) => buildingName === "Warehouse Annex")).toBe(false);
  });
});
