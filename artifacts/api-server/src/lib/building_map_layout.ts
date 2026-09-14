import { z } from "zod";

export const BUILDING_OVERLAY_PREFIX = "building-overlay:";
export const BUILDING_OVERLAY_HIDDEN_PREFIX = "building-overlay-hidden:";
export const BUILDING_LEGACY_HIDDEN_PREFIX = "building-hidden:";

// Custom building markers use `CUSTOM:${encodeURIComponent(buildingName)}`.
// Keep this below the 255-character network_layout_positions.node_id limit after
// the server adds either persistence namespace prefix.
export const BUILDING_OVERLAY_CODE_MAX_LENGTH = 200;

export function buildingOverlayNodeId(code: string): string {
  return `${BUILDING_OVERLAY_PREFIX}${code}`;
}

export function buildingOverlayCodeFromNodeId(nodeId: string): string | null {
  return nodeId.startsWith(BUILDING_OVERLAY_PREFIX)
    ? nodeId.slice(BUILDING_OVERLAY_PREFIX.length)
    : null;
}

export function buildingOverlayHiddenNodeId(code: string): string {
  return `${BUILDING_OVERLAY_HIDDEN_PREFIX}${code}`;
}

export function buildingOverlayHiddenCodeFromNodeId(nodeId: string): string | null {
  return nodeId.startsWith(BUILDING_OVERLAY_HIDDEN_PREFIX)
    ? nodeId.slice(BUILDING_OVERLAY_HIDDEN_PREFIX.length)
    : null;
}

const BUILT_IN_OVERLAY_CODE_BY_BUILDING = new Map<string, string>([
  ["west campus", "WEST"],
  ["tech building a", "TA"],
  ["tech building b", "TB"],
  ["tech building d", "TD"],
  ["tech building t", "TT"],
  ["industrial technology campus", "ITC"],
  ["agriculture", "V"],
  ["cosmetology", "COS"],
  ["allied health", "CAH"],
  ["colvin family center for allied health", "CAH"],
  ["hobble", "AA"],
  ["humanities", "H"],
  ["humanities building", "H"],
  ["student union / student activities", "SU"],
  ["student union / activities", "SU"],
  ["student health center", "SHC"],
  ["student living center", "SLC"],
  ["mansions", "MAN"],
  ["student living f", "SLF"],
  ["student living g", "SLG"],
  ["student living h", "SLH"],
  ["student living j", "SLJ"],
  ["student living r", "SLR"],
  ["student living s", "SLS"],
  ["student living t", "SLT"],
  ["softball field", "SB"],
  ["baseball field", "BB"],
  ["sharp champion center", "SFCC"],
  ["sharp family champion center", "SFCC"],
]);

const BUILT_IN_BUILDING_BY_OVERLAY_CODE = new Map<string, string>([
  ["WEST", "West Campus"],
  ["TA", "Tech Building A"],
  ["TB", "Tech Building B"],
  ["TD", "Tech Building D"],
  ["TT", "Tech Building T"],
  ["ITC", "Industrial Technology Campus"],
  ["V", "Agriculture"],
  ["COS", "Cosmetology"],
  ["CAH", "Allied Health"],
  ["AA", "Hobble"],
  ["A", "Hobble"],
  ["H", "Humanities"],
  ["SA", "Student Union / Student Activities"],
  ["SU", "Student Union / Student Activities"],
  ["SW", "Student Union / Student Activities"],
  ["SHC", "Student Health Center"],
  ["SLC", "Student Living Center"],
  ["MAN", "Mansions"],
  ["SLF", "Student Living F"],
  ["SLG", "Student Living G"],
  ["SLH", "Student Living H"],
  ["SLJ", "Student Living J"],
  ["SLR", "Student Living R"],
  ["SLS", "Student Living S"],
  ["SLT", "Student Living T"],
  ["SB", "Softball Field"],
  ["BB", "Baseball Field"],
  ["SFCC", "Sharp Champion Center"],
]);

function normalizeBuildingName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function campusMapOverlayCodeForBuildingName(name: string): string {
  return BUILT_IN_OVERLAY_CODE_BY_BUILDING.get(normalizeBuildingName(name))
    ?? `CUSTOM:${encodeURIComponent(name.trim())}`;
}

export function campusMapBuildingNameForOverlayCode(code: string): string | null {
  const builtIn = BUILT_IN_BUILDING_BY_OVERLAY_CODE.get(code);
  if (builtIn) return builtIn;
  if (!code.startsWith("CUSTOM:")) return null;
  try {
    return decodeURIComponent(code.slice("CUSTOM:".length));
  } catch {
    return null;
  }
}

export function buildingLegacyHiddenNodeId(buildingName: string): string {
  return `${BUILDING_LEGACY_HIDDEN_PREFIX}${encodeURIComponent(buildingName.trim())}`;
}

export function buildingNameFromLegacyHiddenNodeId(nodeId: string): string | null {
  if (!nodeId.startsWith(BUILDING_LEGACY_HIDDEN_PREFIX)) return null;
  try {
    return decodeURIComponent(nodeId.slice(BUILDING_LEGACY_HIDDEN_PREFIX.length));
  } catch {
    return null;
  }
}

export function buildingVisibilityMetadataNodeIds(code: string): string[] {
  const buildingName = campusMapBuildingNameForOverlayCode(code);
  return [
    buildingOverlayHiddenNodeId(code),
    ...(buildingName ? [buildingLegacyHiddenNodeId(buildingName)] : []),
  ];
}

export interface BuildingVisibilityMutation {
  nodeIdsToDelete: string[];
  hiddenCodesToInsert: string[];
}

export function getBuildingVisibilityMutation(
  positions: Array<{ code: string; visible?: boolean }>,
): BuildingVisibilityMutation {
  const explicitPositions = positions.filter(
    (position): position is { code: string; visible: boolean } =>
      typeof position.visible === "boolean",
  );
  return {
    nodeIdsToDelete: Array.from(new Set(
      explicitPositions.flatMap((position) => buildingVisibilityMetadataNodeIds(position.code)),
    )),
    hiddenCodesToInsert: explicitPositions
      .filter((position) => !position.visible)
      .map((position) => position.code),
  };
}

export interface StoredBuildingMapLayoutRow {
  nodeId: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  updatedAt: Date;
}

export function serializeBuildingMapLayoutRows(rows: StoredBuildingMapLayoutRow[]) {
  const hiddenByCode = new Map<string, Date>();
  for (const row of rows) {
    const currentCode = buildingOverlayHiddenCodeFromNodeId(row.nodeId);
    if (currentCode) hiddenByCode.set(currentCode, row.updatedAt);

    const legacyName = buildingNameFromLegacyHiddenNodeId(row.nodeId);
    if (legacyName) hiddenByCode.set(campusMapOverlayCodeForBuildingName(legacyName), row.updatedAt);
  }

  const positions = rows.flatMap((row) => {
    const code = buildingOverlayCodeFromNodeId(row.nodeId);
    if (!code) return [];
    return [{
      code,
      x: row.x,
      y: row.y,
      labelDx: row.width,
      labelDy: row.height,
      visible: !hiddenByCode.has(code),
      updatedAt: row.updatedAt.toISOString(),
    }];
  });
  const positionCodes = new Set(positions.map((row) => row.code));
  const visibilityOnlyRows = Array.from(hiddenByCode)
    .filter(([code]) => !positionCodes.has(code))
    .map(([code, updatedAt]) => ({
      code,
      visible: false as const,
      updatedAt: updatedAt.toISOString(),
    }));

  return [...positions, ...visibilityOnlyRows];
}

const buildingOverlayPositionSchema = z.object({
  code: z.string().trim().min(1).max(BUILDING_OVERLAY_CODE_MAX_LENGTH),
  x: z.number().finite().min(0).max(100),
  y: z.number().finite().min(0).max(100),
  labelDx: z.number().finite().min(-400).max(400).optional().nullable(),
  labelDy: z.number().finite().min(-400).max(400).optional().nullable(),
  // Omission is intentionally distinct from true: an older cached client must
  // not erase visibility metadata it does not know how to represent.
  visible: z.boolean().optional(),
});

export const buildingOverlayPutSchema = z.object({
  positions: z.array(buildingOverlayPositionSchema).min(1).max(100),
});

export const buildingOverlayDeleteSchema = z.object({
  codes: z
    .array(z.string().trim().min(1).max(BUILDING_OVERLAY_CODE_MAX_LENGTH))
    .optional(),
});
