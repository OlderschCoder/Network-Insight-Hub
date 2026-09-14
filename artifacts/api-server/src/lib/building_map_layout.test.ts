import { describe, expect, it } from "vitest";
import {
  BUILDING_OVERLAY_CODE_MAX_LENGTH,
  buildingLegacyHiddenNodeId,
  buildingNameFromLegacyHiddenNodeId,
  buildingOverlayCodeFromNodeId,
  buildingOverlayDeleteSchema,
  buildingOverlayHiddenCodeFromNodeId,
  buildingOverlayHiddenNodeId,
  buildingOverlayNodeId,
  buildingOverlayPutSchema,
  buildingVisibilityMetadataNodeIds,
  campusMapBuildingNameForOverlayCode,
  campusMapOverlayCodeForBuildingName,
  getBuildingVisibilityMutation,
  serializeBuildingMapLayoutRows,
} from "./building_map_layout";

describe("building map layout validation", () => {
  it("accepts URL-encoded custom building markers used by the campus map", () => {
    const result = buildingOverlayPutSchema.safeParse({
      positions: [
        {
          code: "CUSTOM:Azure%20(Hybrid-VNet)",
          x: 8,
          y: 90,
          labelDx: 8,
          labelDy: -10,
        },
        {
          code: "CUSTOM:Maintenance%20Building",
          x: 32,
          y: 90,
          labelDx: 8,
          labelDy: -10,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("uses the same custom-code limit when deleting saved markers", () => {
    expect(
      buildingOverlayDeleteSchema.safeParse({
        codes: ["CUSTOM:Maintenance%20Building"],
      }).success,
    ).toBe(true);
  });

  it("persists explicit visibility and keeps omission distinct for legacy clients", () => {
    const hidden = buildingOverlayPutSchema.parse({
      positions: [{ code: "MANS", x: 76, y: 32, visible: false }],
    });
    const legacy = buildingOverlayPutSchema.parse({
      positions: [{ code: "SLC", x: 81.2, y: 31 }],
    });

    expect(hidden.positions[0].visible).toBe(false);
    expect(legacy.positions[0].visible).toBeUndefined();
  });

  it("does not modify hidden metadata for an old payload that omits visibility", () => {
    expect(getBuildingVisibilityMutation([
      { code: "MAN" },
      { code: "CUSTOM:Business" },
    ])).toEqual({
      nodeIdsToDelete: [],
      hiddenCodesToInsert: [],
    });

    expect(getBuildingVisibilityMutation([
      { code: "MAN", visible: true },
      { code: "CUSTOM:Business", visible: false },
    ])).toEqual({
      nodeIdsToDelete: [
        "building-overlay-hidden:MAN",
        "building-hidden:Mansions",
        "building-overlay-hidden:CUSTOM:Business",
        "building-hidden:Business",
      ],
      hiddenCodesToInsert: ["CUSTOM:Business"],
    });
  });

  it("uses separate storage-safe identities for position and hidden metadata", () => {
    const code = "CUSTOM:Maintenance%20Building";
    const positionId = buildingOverlayNodeId(code);
    const hiddenId = buildingOverlayHiddenNodeId(code);

    expect(positionId).not.toBe(hiddenId);
    expect(buildingOverlayCodeFromNodeId(positionId)).toBe(code);
    expect(buildingOverlayCodeFromNodeId(hiddenId)).toBeNull();
    expect(buildingOverlayHiddenCodeFromNodeId(hiddenId)).toBe(code);
    expect(positionId.length).toBeLessThanOrEqual(255);
    expect(hiddenId.length).toBeLessThanOrEqual(255);
  });

  it("translates legacy hidden-building rows into current overlay codes", () => {
    expect(campusMapOverlayCodeForBuildingName("Mansions")).toBe("MAN");
    expect(campusMapOverlayCodeForBuildingName("Business")).toBe("CUSTOM:Business");
    expect(campusMapBuildingNameForOverlayCode("MAN")).toBe("Mansions");
    expect(campusMapBuildingNameForOverlayCode("CUSTOM:Warehouse%20Annex")).toBe("Warehouse Annex");
    expect(buildingNameFromLegacyHiddenNodeId("building-hidden:Mansions")).toBe("Mansions");
    expect(buildingLegacyHiddenNodeId("Warehouse Annex")).toBe("building-hidden:Warehouse%20Annex");
  });

  it("serializes legacy hidden names through the canonical map-layout response", () => {
    const observedAt = new Date("2026-09-14T12:00:00.000Z");
    const rows = serializeBuildingMapLayoutRows([
      { nodeId: buildingOverlayNodeId("MAN"), x: 19.6, y: 32, width: 8, height: -10, updatedAt: observedAt },
      { nodeId: "building-hidden:Mansions", x: 0, y: 0, width: null, height: null, updatedAt: observedAt },
      { nodeId: "building-hidden:Business", x: 0, y: 0, width: null, height: null, updatedAt: observedAt },
    ]);

    expect(rows).toContainEqual(expect.objectContaining({ code: "MAN", visible: false, x: 19.6, y: 32 }));
    expect(rows).toContainEqual({
      code: "CUSTOM:Business",
      visible: false,
      updatedAt: observedAt.toISOString(),
    });
  });

  it("removes both current and legacy visibility identities when showing a marker", () => {
    expect(buildingVisibilityMetadataNodeIds("MAN")).toEqual([
      "building-overlay-hidden:MAN",
      "building-hidden:Mansions",
    ]);
    expect(buildingVisibilityMetadataNodeIds("CUSTOM:Business")).toEqual([
      "building-overlay-hidden:CUSTOM:Business",
      "building-hidden:Business",
    ]);
  });

  it("rejects identifiers that exceed the bounded persistence contract", () => {
    const code = "X".repeat(BUILDING_OVERLAY_CODE_MAX_LENGTH + 1);

    expect(
      buildingOverlayPutSchema.safeParse({
        positions: [{ code, x: 50, y: 50 }],
      }).success,
    ).toBe(false);
    expect(buildingOverlayDeleteSchema.safeParse({ codes: [code] }).success).toBe(false);
  });
});
