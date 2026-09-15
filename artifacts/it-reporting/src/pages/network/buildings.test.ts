import { describe, expect, it } from "vitest";
import {
  BUILDING_HEALTH_LABELS,
  canEditCampusMap,
  getCampusMapDisplayEntries,
  mergeCampusMapLayoutRows,
  setCampusMapMarkerVisibility,
  type CampusMapBuildingHealth,
  type OverlayPosition,
} from "./buildings";

function building(name: string): CampusMapBuildingHealth {
  return { name, healthColor: "green" };
}

describe("shared Buildings and Monitoring campus-map entries", () => {
  it("uses the corroborated building-health language consistently", () => {
    expect(BUILDING_HEALTH_LABELS).toEqual({
      green: "All monitored switches online",
      amber: "One or more switch issues; full outage not confirmed",
      red: "Main switch and assigned phones offline",
      unknown: "Evidence incomplete",
    });
  });

  it("includes the Mansions marker by default", () => {
    const entries = getCampusMapDisplayEntries([
      building("Mansions"),
      building("Student Living Center"),
    ]);

    expect(entries.find(({ code }) => code === "MAN")?.match?.name).toBe(
      "Mansions",
    );
  });

  it("excludes a marker whose saved layout visibility is false", () => {
    const entries = getCampusMapDisplayEntries(
      [building("Mansions"), building("Student Living Center")],
      { MAN: { visible: false } },
    );

    expect(entries.find(({ code }) => code === "MAN")).toBeUndefined();
    expect(entries.find(({ code }) => code === "SLC")?.match?.name).toBe(
      "Student Living Center",
    );
  });

  it("gives an unlisted building a stable custom marker that can also be hidden", () => {
    const visible = getCampusMapDisplayEntries([building("Warehouse Annex")]);
    const hidden = getCampusMapDisplayEntries([building("Warehouse Annex")], {
      "CUSTOM:Warehouse%20Annex": { visible: false },
    });

    expect(visible).toContainEqual(
      expect.objectContaining({
        code: "CUSTOM:Warehouse%20Annex",
        displayCode: "WA",
      }),
    );
    expect(
      hidden.some(({ buildingName }) => buildingName === "Warehouse Annex"),
    ).toBe(false);
  });

  it("restores valid default coordinates before showing a legacy hidden custom marker", () => {
    const code = "CUSTOM:Business";
    const defaults: Record<string, OverlayPosition> = {
      [code]: { code, x: 8, y: 90, labelDx: 8, labelDy: -10, visible: true },
    };
    const hidden = mergeCampusMapLayoutRows(defaults, [
      { code, visible: false },
    ]);
    const shown = setCampusMapMarkerVisibility(hidden, defaults, code, true);

    expect(hidden[code]).toMatchObject({ x: 8, y: 90, visible: false });
    expect(shown[code]).toMatchObject({ code, x: 8, y: 90, visible: true });
    expect(
      Number.isFinite(shown[code].x) && Number.isFinite(shown[code].y),
    ).toBe(true);
  });

  it.each([
    ["Allied Health", "CAH"],
    ["Sharp Champion Center", "SFCC"],
    ["Student Union / Student Activities", "SU"],
  ])(
    "does not duplicate the preferred canonical name %s as a custom marker",
    (name, expectedCode) => {
      const entries = getCampusMapDisplayEntries([building(name)]);

      expect(
        entries.find(({ code }) => code === expectedCode)?.match?.name,
      ).toBe(name);
      expect(
        entries.some(
          ({ code }) =>
            code.startsWith("CUSTOM:") &&
            code.includes(encodeURIComponent(name)),
        ),
      ).toBe(false);
    },
  );

  it("only exposes map editing to CIO roles", () => {
    expect(canEditCampusMap("cio")).toBe(true);
    expect(canEditCampusMap("network")).toBe(false);
    expect(canEditCampusMap("support")).toBe(false);
    expect(canEditCampusMap(undefined)).toBe(false);
  });
});
