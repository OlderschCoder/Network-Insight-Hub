const UNASSIGNED_BUILDING_VALUES = new Set([
  "",
  "unknown",
  "unknown building",
  "unassigned",
]);

const normalized = (value: string | null | undefined) =>
  String(value ?? "").trim().toLowerCase();

/** Heuristics may only classify records that do not already have an owner. */
export function hasMaintainedBuildingAssignment(
  building: string | null | undefined,
): boolean {
  return !UNASSIGNED_BUILDING_VALUES.has(normalized(building));
}

/**
 * Collector metadata is evidence, not authority over asset ownership. Prefer
 * the maintained topology node and then maintained inventory; expose a
 * collector disagreement for review without changing either record.
 */
export function reconcileTelemetryBuilding(
  nodeBuilding: string | null | undefined,
  inventoryBuilding: string | null | undefined,
  reportedBuilding: string | null | undefined,
) {
  const maintainedNodeBuilding = hasMaintainedBuildingAssignment(nodeBuilding)
    ? nodeBuilding!.trim()
    : null;
  const maintainedInventoryBuilding = hasMaintainedBuildingAssignment(inventoryBuilding)
    ? inventoryBuilding!.trim()
    : null;
  const authoritativeBuilding = maintainedNodeBuilding ?? maintainedInventoryBuilding;
  const reported = reportedBuilding?.trim() || null;
  return {
    authoritativeBuilding,
    reportedBuilding: reported,
    maintainedBuildingConflict: Boolean(
      maintainedNodeBuilding &&
      maintainedInventoryBuilding &&
      normalized(maintainedNodeBuilding) !== normalized(maintainedInventoryBuilding),
    ),
    buildingConflict: Boolean(
      authoritativeBuilding &&
      reported &&
      normalized(authoritativeBuilding) !== normalized(reported),
    ),
  };
}
