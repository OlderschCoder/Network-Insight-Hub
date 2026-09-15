export type BuildingSwitchStatus = "up" | "degraded" | "down" | "unknown";
export type BuildingHealthColor = "green" | "amber" | "red" | "unknown";

export type BuildingPhoneEvidence = {
  total: number;
  online: number;
  offline: number;
  unknown: number;
  assignedOwners: number;
  matchedOwners: number;
  complete: boolean;
  observedAt: string;
};

export type BuildingHealthOptions = {
  mainSwitchStatus?: BuildingSwitchStatus;
};

export type BuildingConnectivitySummary = {
  healthColor: BuildingHealthColor;
  mainSwitchConfigured: boolean;
  mainSwitchStatus: BuildingSwitchStatus;
};

export type ExplicitBuildingAnchor<SwitchId = number> = {
  buildingName: string;
  anchorSwitchId: SwitchId;
  enabled: boolean;
};

/**
 * Return only operator-enabled anchor designations. Seeded/disabled candidates
 * are intentionally not operational evidence.
 */
export function enabledMainSwitchIdsByBuilding<SwitchId>(
  anchors: readonly ExplicitBuildingAnchor<SwitchId>[],
  canonicalizeBuildingName: (name: string) => string,
): Map<string, SwitchId> {
  const enabledAnchors = new Map<string, SwitchId>();
  const ambiguousBuildings = new Set<string>();
  for (const anchor of anchors) {
    if (anchor.enabled !== true) continue;
    const buildingName = canonicalizeBuildingName(anchor.buildingName);
    if (!buildingName) continue;
    if (ambiguousBuildings.has(buildingName)) continue;
    if (
      enabledAnchors.has(buildingName) &&
      !Object.is(enabledAnchors.get(buildingName), anchor.anchorSwitchId)
    ) {
      // Ambiguous explicit designations are not permission to pick one.
      enabledAnchors.delete(buildingName);
      ambiguousBuildings.add(buildingName);
      continue;
    }
    enabledAnchors.set(buildingName, anchor.anchorSwitchId);
  }
  return enabledAnchors;
}

/** A switch observation becomes "main" only through an enabled designation. */
export function designatedMainSwitchStatus<SwitchId, Status>(
  anchorSwitchId: SwitchId | undefined,
  switchStatusesById: ReadonlyMap<SwitchId, Status>,
): Status | undefined {
  if (anchorSwitchId === undefined) return undefined;
  return switchStatusesById.get(anchorSwitchId);
}

/** Reduce map health without ever promoting the building's only switch. */
export function summarizeBuildingConnectivity<SwitchId>(
  switchStatuses: readonly BuildingSwitchStatus[],
  phoneEvidence: BuildingPhoneEvidence | undefined,
  enabledAnchorSwitchId: SwitchId | undefined,
  switchStatusesById: ReadonlyMap<SwitchId, BuildingSwitchStatus>,
): BuildingConnectivitySummary {
  const mainSwitchStatus = designatedMainSwitchStatus(
    enabledAnchorSwitchId,
    switchStatusesById,
  );
  return {
    healthColor: buildingHealthFromConnectivity(switchStatuses, phoneEvidence, {
      mainSwitchStatus,
    }),
    mainSwitchConfigured: enabledAnchorSwitchId !== undefined,
    mainSwitchStatus: mainSwitchStatus ?? "unknown",
  };
}

/**
 * Campus building state is deliberately conservative:
 * - green requires every monitored switch to be observed up;
 * - red requires the explicit main switch and complete assigned-phone evidence down;
 * - any verified partial fault is amber;
 * - no usable switch evidence remains unknown.
 */
export function buildingHealthFromConnectivity(
  switchStatuses: readonly BuildingSwitchStatus[],
  phoneEvidence?: BuildingPhoneEvidence,
  options: BuildingHealthOptions = {},
): BuildingHealthColor {
  const mainSwitchStatus = options.mainSwitchStatus;
  const hasUsableSwitchEvidence =
    switchStatuses.some((status) => status !== "unknown") ||
    (mainSwitchStatus !== undefined && mainSwitchStatus !== "unknown");
  if (!hasUsableSwitchEvidence) return "unknown";
  if (
    switchStatuses.length > 0 &&
    switchStatuses.every((status) => status === "up") &&
    (mainSwitchStatus === undefined || mainSwitchStatus === "up")
  ) {
    return "green";
  }

  if (
    mainSwitchStatus === "down" &&
    phoneConnectivityStatus(phoneEvidence) === "down"
  ) {
    return "red";
  }

  return "amber";
}

export function phoneConnectivityStatus(
  evidence?: BuildingPhoneEvidence,
): "up" | "down" | "unknown" {
  if (!evidence || evidence.total === 0) return "unknown";
  if (evidence.online > 0) return "up";
  if (
    evidence.complete &&
    evidence.assignedOwners > 0 &&
    evidence.matchedOwners === evidence.assignedOwners &&
    evidence.unknown === 0 &&
    evidence.offline === evidence.total
  ) {
    return "down";
  }
  return "unknown";
}
