import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  DEFAULT_AUTHORITATIVE_BUILDINGS,
  getAuthoritativeBuildingName,
} from "./building_assignment";
import type { BuildingPhoneEvidence } from "./building_health";
import { logger } from "./logger";
import {
  fetchAllWebexDevices,
  isWebexSupportConfigured,
} from "./webex_support";

const PHONE_EVIDENCE_CACHE_MS = 20_000;
const PHONE_EVIDENCE_FAILURE_CACHE_MS = 5_000;
type PhoneBuildingAssignment = {
  webex_person_id: string;
  building: string;
};

let cachedEvidence: {
  expiresAt: number;
  values: Map<string, BuildingPhoneEvidence>;
} | null = null;
let evidenceRefreshInFlight: Promise<Map<string, BuildingPhoneEvidence>> | null =
  null;

function resultRows<T>(result: any): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result?.rows ?? []) as T[];
}

function normalizedPhoneStatus(
  value: unknown,
): "online" | "offline" | "unknown" {
  const status = String(value ?? "unknown")
    .trim()
    .toLowerCase();
  if (status === "connected" || status === "online") return "online";
  if (status === "disconnected" || status === "offline") return "offline";
  return "unknown";
}

/** Software clients are deliberately excluded: only physical calling hardware corroborates an outage. */
export function isPhysicalPhoneLikeDevice(
  device: Record<string, unknown>,
): boolean {
  const identity = [
    device.product,
    device.type,
    device.model,
    device.displayName,
    device.name,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!identity) return false;
  if (
    /\b(?:webex app|desktop client|browser client|mobile app|softphone)\b/.test(
      identity,
    )
  ) {
    return false;
  }
  return /(ip phone|desk phone|conference phone|\bphone\b|\bmpp\b|\bata\b|\bdect\b|\bvg[34]\b|\bcp[- ]?\d|(?:^|\D)(?:68|78|79|88|98)\d{2}(?:\D|$))/.test(
    identity,
  );
}

/** Red evidence is possible only when every assigned owner has known physical-phone data. */
export function collectBuildingPhoneEvidence(
  assignmentRows: readonly PhoneBuildingAssignment[],
  devices: readonly Record<string, unknown>[],
  observedAt: string,
  sourceComplete: boolean,
): Map<string, BuildingPhoneEvidence> {
  const ownerBuildings = new Map<string, Set<string>>();
  const ownersByBuilding = new Map<string, Set<string>>();

  for (const row of assignmentRows) {
    const ownerId = String(row.webex_person_id ?? "").trim();
    const rawBuilding = String(row.building ?? "").trim();
    if (!ownerId || !rawBuilding) continue;
    const building = getAuthoritativeBuildingName(
      rawBuilding,
      DEFAULT_AUTHORITATIVE_BUILDINGS,
    );
    const buildings = ownerBuildings.get(ownerId) ?? new Set<string>();
    buildings.add(building);
    ownerBuildings.set(ownerId, buildings);
    const owners = ownersByBuilding.get(building) ?? new Set<string>();
    owners.add(ownerId);
    ownersByBuilding.set(building, owners);
  }

  const values = new Map<string, BuildingPhoneEvidence>();
  const matchedByBuilding = new Map<string, Set<string>>();
  const ambiguousBuildings = new Set<string>();
  for (const [building, owners] of ownersByBuilding) {
    values.set(building, {
      total: 0,
      online: 0,
      offline: 0,
      unknown: 0,
      assignedOwners: owners.size,
      matchedOwners: 0,
      complete: false,
      observedAt,
    });
  }

  for (const device of devices) {
    if (!isPhysicalPhoneLikeDevice(device)) continue;
    const ownerIds = Array.from(
      new Set(
        [device.personId, device.workspaceId]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean),
      ),
    ).filter((ownerId) => ownerBuildings.has(ownerId));
    if (ownerIds.length === 0) continue;

    const candidateBuildings = new Set(
      ownerIds.flatMap((ownerId) =>
        Array.from(ownerBuildings.get(ownerId) ?? []),
      ),
    );
    if (ownerIds.length !== 1 || candidateBuildings.size !== 1) {
      for (const building of candidateBuildings)
        ambiguousBuildings.add(building);
      continue;
    }

    const ownerId = ownerIds[0];
    const building = candidateBuildings.values().next().value as string;
    const evidence = values.get(building);
    if (!evidence) continue;
    const matchedOwners = matchedByBuilding.get(building) ?? new Set<string>();
    matchedOwners.add(ownerId);
    matchedByBuilding.set(building, matchedOwners);

    const status = normalizedPhoneStatus(
      device.connectionStatus ?? device.status,
    );
    evidence.total += 1;
    evidence[status] += 1;
  }

  for (const [building, evidence] of values) {
    evidence.matchedOwners = matchedByBuilding.get(building)?.size ?? 0;
    evidence.complete = Boolean(
      sourceComplete &&
      !ambiguousBuildings.has(building) &&
      evidence.assignedOwners > 0 &&
      evidence.matchedOwners === evidence.assignedOwners &&
      evidence.total > 0 &&
      evidence.unknown === 0,
    );
  }
  return values;
}

async function refreshBuildingPhoneEvidence(): Promise<
  Map<string, BuildingPhoneEvidence>
> {
  try {
    const assignmentResult = await db.execute(sql`
      SELECT "webex_person_id", "building"
        FROM "phone_building_assignments"
    `);
    const assignmentRows =
      resultRows<PhoneBuildingAssignment>(assignmentResult);
    const observedAt = new Date().toISOString();
    if (assignmentRows.length === 0) {
      const values = new Map<string, BuildingPhoneEvidence>();
      cachedEvidence = {
        values,
        expiresAt: Date.now() + PHONE_EVIDENCE_CACHE_MS,
      };
      return values;
    }

    if (!isWebexSupportConfigured()) {
      const values = collectBuildingPhoneEvidence(
        assignmentRows,
        [],
        observedAt,
        false,
      );
      cachedEvidence = {
        values,
        expiresAt: Date.now() + PHONE_EVIDENCE_FAILURE_CACHE_MS,
      };
      return values;
    }

    const collection = await fetchAllWebexDevices();
    const values = collectBuildingPhoneEvidence(
      assignmentRows,
      collection.devices,
      observedAt,
      collection.complete,
    );
    if (!collection.complete) {
      logger.warn("Building phone evidence is incomplete");
    }
    cachedEvidence = {
      values,
      expiresAt:
        Date.now() +
        (collection.complete
          ? PHONE_EVIDENCE_CACHE_MS
          : PHONE_EVIDENCE_FAILURE_CACHE_MS),
    };
    return values;
  } catch (error) {
    logger.warn({ err: error }, "Building phone evidence is unavailable");
    const values = new Map<string, BuildingPhoneEvidence>();
    cachedEvidence = {
      values,
      expiresAt: Date.now() + PHONE_EVIDENCE_FAILURE_CACHE_MS,
    };
    return values;
  }
}

export async function getBuildingPhoneEvidence(): Promise<
  Map<string, BuildingPhoneEvidence>
> {
  if (cachedEvidence && cachedEvidence.expiresAt > Date.now()) {
    return cachedEvidence.values;
  }
  if (evidenceRefreshInFlight) return evidenceRefreshInFlight;

  const refresh = refreshBuildingPhoneEvidence();
  evidenceRefreshInFlight = refresh;
  try {
    return await refresh;
  } finally {
    if (evidenceRefreshInFlight === refresh) evidenceRefreshInFlight = null;
  }
}
