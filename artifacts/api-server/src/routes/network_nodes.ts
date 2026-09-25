import { Router } from "express";
import { db, netNodesTable, netLinksTable, vlansTable, networkLayoutPositionsTable, azureVmsTable, networkSwitchesTable } from "@workspace/db";
import { eq, or, ilike, and, inArray, sql } from "drizzle-orm";
import { requireAuth, requireNetworkAdmin } from "./auth";
import { z } from "zod";
import {
  findSwitchByIdentity,
  saveNetLinkByIdentity,
  saveNetNodeByIdentity,
  saveSwitchByIdentity,
} from "../lib/network_identity";
import {
  diffFields,
  recordInventoryAudit,
  SWITCH_AUDIT_FIELDS,
  type InventoryActor,
} from "../lib/inventory";
import { pingManyViaNoc } from "../lib/noc_probe";
import {
  healthColorFromNetworkStatuses,
  mergeNetworkStatusObservations,
  resolveNetworkStatus,
  resolveNetworkStatusEvidence,
  statusFromNocProbe,
  summarizeNetworkStatusEvidence,
  type NetworkLiveStatus,
  type NetworkStatusObservation,
  type ResolvedNetworkStatus,
} from "../lib/network_status";
import { hasMaintainedBuildingAssignment } from "../lib/network_building_policy";

const router = Router();

function requestActor(req: any): InventoryActor {
  return { id: req.user?.id ?? null, name: req.user?.name ?? req.user?.email ?? null };
}

async function syncMaintainedSwitchFromNode(
  previousNode: typeof netNodesTable.$inferSelect | null,
  node: typeof netNodesTable.$inferSelect,
  req: any,
): Promise<void> {
  if (!["switch", "firewall"].includes(node.nodeKind) || !node.mgmtIp) return;

  const before = previousNode
    ? await findSwitchByIdentity({
      hostname: previousNode.hostname,
      ipAddress: previousNode.mgmtIp,
    })
    : null;
  const existing = before ?? await findSwitchByIdentity({
    hostname: node.hostname,
    ipAddress: node.mgmtIp,
  });
  const result = await saveSwitchByIdentity({
    hostname: node.hostname,
    building: getCanonicalBuildingName(node.building),
    ipAddress: node.mgmtIp,
    model: node.model,
    status: node.status,
    configFile: existing?.configFile,
    notes: node.notes,
    location: node.location,
  }, existing?.id);

  await recordInventoryAudit({
    entityType: "switch",
    entityId: result.row.id,
    entityLabel: result.row.hostname,
    action: result.action === "created" ? "create" : "update",
    source: "manual",
    actor: requestActor(req),
    changes: diffFields(existing, result.row, SWITCH_AUDIT_FIELDS),
  });
}

// ---------------------------------------------------------------------------
// InfluxDB helpers (stubbed until server is inside the SCCC network)
// ---------------------------------------------------------------------------
const INFLUX_URL   = process.env.INFLUXDB_URL;      // e.g. http://10.0.0.22:8086
const INFLUX_TOKEN = process.env.INFLUXDB_TOKEN;     // read-only token
const INFLUX_ORG   = process.env.INFLUXDB_ORG ?? "SCCC";
const INFLUX_BUCKET = process.env.INFLUXDB_BUCKET ?? "telegraf";
const BUILDING_OVERLAY_PREFIX = "building-overlay:";
const BUILDING_MASTER_PREFIX = "building-master:";
const NOC_REACHABILITY_CACHE_MS = 30_000;
const nocReachabilityCache = new Map<
  string,
  NetworkStatusObservation & { expiresAt: number }
>();
const DEFAULT_AUTHORITATIVE_BUILDINGS = [
  "Agriculture",
  "Allied Health",
  "Azure (Hybrid-VNet)",
  "Baseball Field",
  "Business",
  "Campus Wide",
  "Cosmetology",
  "Epworth ALC",
  "Hobble",
  "Humanities",
  "Industrial Technology Campus",
  "Tech Building A",
  "Tech Building B",
  "Tech Building D",
  "Tech Building T",
  "Maintenance Building",
  "Sharp Champion Center",
  "Softball Field",
  "Student Health Center",
  "Student Living Center",
  "Student Living F",
  "Student Living G",
  "Student Living H",
  "Student Living J",
  "Student Living R",
  "Student Living S",
  "Student Living T",
  "Student Union / Student Activities",
  "West Campus",
] as const;
const CAMPUS_BACKBONE_INTERFACES = [
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/20" }, // SLC1151
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/22" }, // COS109
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/24" }, // Sharp Champion Center
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/26" }, // Agriculture V201
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/28" }, // AA105
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/30" }, // Student Union
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/31" }, // Business
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/32" }, // Business redundant leg
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/35" }, // Softball
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/40" }, // Epworth
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/42" }, // Student Activities
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/44" }, // Student Health
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/45" }, // AA148 / campus edge
  { sysName: "sw-aa144-A24.sccc.edu", ifName: "Ethernet1/48" }, // AA148 redundant leg
  { sysName: "sw-aa144-A48.sccc.edu", ifName: "Ethernet1/13" }, // Humanities
  { sysName: "sw-aa144-A48.sccc.edu", ifName: "Ethernet1/14" }, // Allied Health
  { sysName: "sw-aa144-A48.sccc.edu", ifName: "Ethernet1/25" }, // Hobble A144 stack leg 1
  { sysName: "sw-aa144-A48.sccc.edu", ifName: "Ethernet1/26" }, // Hobble A144 stack leg 2
  { sysName: "sw-aa144-A48.sccc.edu", ifName: "Ethernet1/28" }, // Sharp Champion redundant leg
  { sysName: "sw-aa144-A48.sccc.edu", ifName: "Ethernet1/40" }, // Business redundant leg
  { sysName: "sw-aa144-A48.sccc.edu", ifName: "Ethernet1/45" }, // Epworth redundant leg
  { sysName: "sw-aa144-A48.sccc.edu", ifName: "Ethernet1/46" }, // Business / B101 alternate
  { sysName: "sw-aa144-A48.sccc.edu", ifName: "Ethernet1/54" }, // Hobble <-> Tech core backbone
] as const;
const FORTIGATE_WAN_SYSNAMES = [
  "FortigateA-Sccc.sccc.edu",
  "Fortigate1-Sccc",
] as const;
const FORTIGATE_WAN_IF_NAMES = ["port25", "port9"] as const;

type LiveStatus = NetworkLiveStatus;

async function getNocDeviceStatus(
  hosts: string[],
): Promise<Record<string, NetworkStatusObservation>> {
  const requested = Array.from(new Set(hosts.filter(isMonitorableHost).map(normalizeTelemetryKey)));
  if (requested.length === 0) return {};

  const now = Date.now();
  const missing = requested.filter((host) => {
    const cached = nocReachabilityCache.get(host);
    return !cached || cached.expiresAt <= now;
  });
  if (missing.length > 0) {
    try {
      const response = await pingManyViaNoc(
        missing.map((target) => ({ target })),
        { count: 1, timeoutMs: 30_000 },
      );
      const observedAt = new Date().toISOString();
      const expiresAt = Date.now() + NOC_REACHABILITY_CACHE_MS;
      for (const observation of response.results ?? []) {
        nocReachabilityCache.set(normalizeTelemetryKey(observation.target), {
          // A positive answer proves reachability. A negative result from this
          // one monitoring vantage can also mean routing, ACL, or probe-path
          // failure, so leave it unknown for other evidence to resolve.
          status: statusFromNocProbe(observation.reachable, observation.error),
          lastObservedAt: observation.reachable ? observedAt : null,
          expiresAt,
        });
      }
    } catch {
      // NOC reachability is an optional corroborating signal. Leave the
      // result unknown when the probe service itself is unavailable.
    }
  }

  return Object.fromEntries(
    requested.map((host) => {
      const cached = nocReachabilityCache.get(host);
      return [host, cached
        ? { status: cached.status, lastObservedAt: cached.lastObservedAt }
        : { status: "unknown" as const, lastObservedAt: null }];
    }),
  );
}

function toFluxStringArray(values: readonly string[]) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function toFluxInterfaceFilter(
  pairs: ReadonlyArray<{ sysName: string; ifName: string }>,
) {
  return pairs
    .map(({ sysName, ifName }) => `(r.sysName == ${JSON.stringify(sysName)} and r.ifName == ${JSON.stringify(ifName)})`)
    .join(" or ");
}

async function queryInflux(flux: string): Promise<string | null> {
  if (!INFLUX_URL || !INFLUX_TOKEN) return null;
  try {
    const res = await fetch(`${INFLUX_URL}/api/v2/query?org=${encodeURIComponent(INFLUX_ORG)}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${INFLUX_TOKEN}`,
        "Content-Type": "application/vnd.flux",
        Accept: "application/csv",
      },
      body: flux,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Parse InfluxDB CSV response into array of objects */
function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] ?? "").trim(); });
    return obj;
  });
}

function normalizeTelemetryKey(value: string): string {
  return value.trim().toLowerCase();
}

async function isInfluxReachable(): Promise<boolean> {
  if (!INFLUX_URL || !INFLUX_TOKEN) return false;
  try {
    const response = await fetch(`${INFLUX_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function isMonitorableHost(value: string | null | undefined): value is string {
  if (!value) return false;
  const key = normalizeTelemetryKey(value);
  return !!key && !["unknown", "n/a", "na", "none", "null", "tbd", "pending"].includes(key);
}

function normalizeBuildingKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function getCanonicalBuildingName(rawBuilding: string | null | undefined): string {
  const original = rawBuilding?.trim();
  if (!original) return "Unknown Building";

  const key = normalizeBuildingKey(original);
  const exactMatches: Record<string, string> = {
    "academic arts": "Hobble",
    "academic arts 144": "Hobble",
    "academic arts 161": "Hobble",
    "agriculture v201": "Agriculture",
    "allied health": "Allied Health",
    "baseball field pressbox": "Baseball Field",
    "campus wide": "Campus Wide",
    "canoys wide": "Campus Wide",
    "cio office aa151": "Hobble",
    "cosmetology cos109": "Cosmetology",
    "epworth alc building": "Epworth ALC",
    "main campus": "Hobble",
    "sharp center": "Sharp Champion Center",
    "softball": "Softball Field",
    "student union": "Student Union / Student Activities",
    "student union gym 208 sugymcam": "Student Union / Student Activities",
    "student living center slc151": "Student Living Center",
    "student living f": "Student Living F",
    "student living g": "Student Living G",
    "student living h": "Student Living H",
    "student living j": "Student Living J",
    "student living r": "Student Living R",
    "student living s": "Student Living S",
    "student living t": "Student Living T",
    "student life ab": "Student Living Center",
    "student life de": "Student Living Center",
    "swa slab": "Student Living Center",
    "swa slcde": "Student Living Center",
    "student living slg": "Student Living G",
    "student living slh": "Student Living H",
    "student living slj": "Student Living J",
    "student living slr": "Student Living R",
    "student living sls": "Student Living S",
    "student living slt": "Student Living T",
    "tech ta107": "Tech Building A",
    "tech tt103": "Tech Building T",
    "tech t122 mgmt": "Tech Building T",
    "tech t122 svi": "Tech Building T",
    "tech b141": "Tech Building B",
    "tech d201": "Tech Building D",
    "tech core 3": "Industrial Technology Campus",
    "tech core 4": "Industrial Technology Campus",
    "tech building": "Industrial Technology Campus",
    "tech building a": "Tech Building A",
    "tech building b": "Tech Building B",
    "tech building d": "Tech Building D",
    "tech building f": "Student Living F",
    "tech building t": "Tech Building T",
    "technology": "Industrial Technology Campus",
    "technology a": "Tech Building A",
    "technology b": "Tech Building B",
    "technology d": "Tech Building D",
    "technology t": "Tech Building T",
    "west campus": "West Campus",
  };
  if (exactMatches[key]) return exactMatches[key];

  if (key.includes("azure connectivity")) return "Azure Connectivity (Objects)";
  if (key.includes("azure")) return "Azure (Hybrid-VNet)";
  if (key.includes("student health")) return "Student Health Center";
  if (key.includes("student living") || key.includes("student life") || key.includes("tech dorm") || /^sl[ghjrst]\b/.test(key)) {
    return "Student Living Center";
  }
  if (key.includes("student union") || key.includes("student activities") || key.includes("sports & activities")) {
    return "Student Union / Student Activities";
  }
  if (key.includes("sharp champion") || key.includes("sharp family champion") || key.includes("sharp center")) {
    return "Sharp Champion Center";
  }
  if (key.includes("allied health") || key.includes("colvin family center")) return "Allied Health";
  if (key.includes("agriculture")) return "Agriculture";
  if (key.includes("cosmetology")) return "Cosmetology";
  if (key.includes("humanities")) return "Humanities";
  if (key.includes("maintenance")) return "Maintenance Building";
  if (key.includes("baseball")) return "Baseball Field";
  if (key.includes("softball")) return "Softball Field";
  if (key.includes("epworth")) return "Epworth ALC";
  if (key.includes("hobble")) return "Hobble";
  if (
    key.includes("aa105") ||
    key.includes("aa151") ||
    key.includes("a161") ||
    key.includes("aa 105") ||
    key.includes("aa 151") ||
    key.includes("a 144") ||
    key.includes("aa 144") ||
    key.includes("fortigate firewall") ||
    key.includes("nexus core 1") ||
    key.includes("nexus core 2")
  ) {
    return "Hobble";
  }
  if (
    key.includes("industrial tech") ||
    key.includes("industrial technology campus") ||
    key.startsWith("tech ") ||
    key === "technology" ||
    key.startsWith("technology ")
  ) {
    return "Industrial Technology Campus";
  }

  return original;
}

function getBuildingMonitorHosts(_buildingName: string, fallbackHosts: string[]): string[] {
  // Building assignments belong to maintained inventory. Hard-coded targets
  // had drifted and made summary and detail views evaluate different devices.
  return Array.from(new Set(fallbackHosts.filter(Boolean)));
}

function mapAzureVmStatus(status: string | null | undefined): LiveStatus {
  const key = (status ?? "").trim().toLowerCase();
  if (!key) return "unknown";
  if (key === "running") return "up";
  if (["starting", "stopping", "updating", "restarting", "creating"].includes(key)) return "degraded";
  if (["stopped", "deallocated", "deleted", "failed"].includes(key)) return "down";
  return "unknown";
}

async function getAzureHybridVmEvidence(): Promise<NetworkStatusObservation> {
  const rows = await db
    .select({
      status: azureVmsTable.status,
      source: azureVmsTable.source,
      updatedAt: azureVmsTable.updatedAt,
    })
    .from(azureVmsTable)
    .where(ilike(azureVmsTable.name, "mfs0"));

  if (rows.length === 0) return { status: "unknown", lastObservedAt: null };

  const preferred = [...rows].sort((a, b) => {
    const sourceDiff = Number(b.source === "azure") - Number(a.source === "azure");
    if (sourceDiff !== 0) return sourceDiff;
    return (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0);
  })[0];

  return {
    status: mapAzureVmStatus(preferred.status),
    lastObservedAt: preferred.updatedAt?.toISOString() ?? null,
  };
}

async function getAzureHybridVmStatus(): Promise<LiveStatus> {
  return (await getAzureHybridVmEvidence()).status;
}

const healthColorFromStatuses = healthColorFromNetworkStatuses;

type BuildingCategory = "campus-building" | "remote-site" | "cloud" | "connectivity";
type MonitoringStrategy = "switch-probe" | "control-plane" | "none";

function getBuildingClassification(
  buildingName: string,
): { category: BuildingCategory; monitoringStrategy: MonitoringStrategy } {
  switch (buildingName) {
    case "Azure (Hybrid-VNet)":
      return { category: "cloud", monitoringStrategy: "control-plane" };
    case "Azure Connectivity (Objects)":
      return { category: "connectivity", monitoringStrategy: "control-plane" };
    case "West Campus":
    case "Epworth ALC":
      return { category: "remote-site", monitoringStrategy: "switch-probe" };
    default:
      return { category: "campus-building", monitoringStrategy: "switch-probe" };
  }
}

function isConnectivityObjectNode(
  node: { hostname: string | null; displayName?: string | null; nodeKind?: string | null },
  canonicalBuilding: string,
): boolean {
  if (canonicalBuilding === "Azure Connectivity (Objects)") return true;

  const nodeKind = (node.nodeKind ?? "").trim().toLowerCase();
  const fingerprint = normalizeBuildingKey(
    [node.hostname ?? "", node.displayName ?? "", canonicalBuilding].filter(Boolean).join(" "),
  );

  if (canonicalBuilding === "Azure (Hybrid-VNet)") {
    return nodeKind === "router" || nodeKind === "isp" || fingerprint.includes("gateway");
  }

  return false;
}

function overlayNodeId(code: string): string {
  return `${BUILDING_OVERLAY_PREFIX}${code}`;
}

function overlayCodeFromNodeId(nodeId: string): string | null {
  return nodeId.startsWith(BUILDING_OVERLAY_PREFIX)
    ? nodeId.slice(BUILDING_OVERLAY_PREFIX.length)
    : null;
}

function explicitBuildingNodeId(name: string): string {
  return `${BUILDING_MASTER_PREFIX}${encodeURIComponent(name.trim())}`;
}

function explicitBuildingNameFromNodeId(nodeId: string): string | null {
  if (!nodeId.startsWith(BUILDING_MASTER_PREFIX)) return null;
  try {
    return decodeURIComponent(nodeId.slice(BUILDING_MASTER_PREFIX.length));
  } catch {
    return nodeId.slice(BUILDING_MASTER_PREFIX.length);
  }
}

async function listExplicitBuildings(): Promise<string[]> {
  const rows = await db.select().from(networkLayoutPositionsTable);
  return rows
    .map((row) => explicitBuildingNameFromNodeId(row.nodeId))
    .filter((value): value is string => !!value)
    .sort((a, b) => a.localeCompare(b));
}

async function listAuthoritativeBuildings(): Promise<string[]> {
  const explicitBuildings = await listExplicitBuildings();
  const canonicalBuildings = Array.from(
    new Set(
      [...DEFAULT_AUTHORITATIVE_BUILDINGS, ...explicitBuildings]
        .map((name) => String(name).trim())
        .filter((name) => !!name),
    ),
  ).sort((a, b) => a.localeCompare(b));
  return canonicalBuildings;
}

function getAssignedBuildingName(building: string | null | undefined, location?: string | null, hostname?: string | null): string {
  // A maintained building assignment is authoritative. Hostname/location
  // heuristics are only a discovery fallback for unassigned legacy records;
  // they must never relocate an already assigned asset.
  if (hasMaintainedBuildingAssignment(building)) {
    return getCanonicalBuildingName(building);
  }

  const hint = normalizeBuildingKey(`${location ?? ""} ${hostname ?? ""}`);
  if (/\btech core\b/.test(hint)) return "Industrial Technology Campus";
  const lettered: Array<[RegExp, string]> = [
    [/\b(?:slg|student living g)\b/, "Student Living G"],
    [/\b(?:slh|dorm h|building h)\b/, "Student Living H"],
    [/\b(?:slj|dorms? j|building j)\b/, "Student Living J"],
    [/\b(?:slr|dorm r|building r)\b/, "Student Living R"],
    [/\b(?:sls|student living s)\b/, "Student Living S"],
    [/\b(?:slt|student living t)\b/, "Student Living T"],
    [/\b(?:ta107|tech ta|technology a)\b/, "Tech Building A"],
    [/\b(?:tb141|tech b141|technology b)\b/, "Tech Building B"],
    [/\b(?:td201|tech d201|technology d)\b/, "Tech Building D"],
    [/\b(?:slf|student living f|building f)\b/, "Student Living F"],
    [/\b(?:tt103|t122|technology t)\b/, "Tech Building T"],
  ];
  for (const [pattern, assigned] of lettered) if (pattern.test(hint)) return assigned;
  return getCanonicalBuildingName(building);
}

async function getBuildingMapLayoutPositions() {
  const rows = await db.select().from(networkLayoutPositionsTable);
  return rows
    .map((row) => {
      const code = overlayCodeFromNodeId(row.nodeId);
      if (!code) return null;
      return {
        code,
        x: row.x,
        y: row.y,
        labelDx: row.width ?? null,
        labelDy: row.height ?? null,
        updatedAt: row.updatedAt.toISOString(),
      };
    })
    .filter(Boolean);
}

export async function getBuildingSummaries() {
  const [nodeRows, switchRows, vlanRows, azureHybridEvidence] = await Promise.all([
    db.select({
      building: netNodesTable.building,
      mgmtIp: netNodesTable.mgmtIp,
      hostname: netNodesTable.hostname,
      status: netNodesTable.status,
      location: netNodesTable.location,
      nodeKind: netNodesTable.nodeKind,
    }).from(netNodesTable),
    db.select({
      building: networkSwitchesTable.building,
      mgmtIp: networkSwitchesTable.ipAddress,
      hostname: networkSwitchesTable.hostname,
      status: networkSwitchesTable.status,
      lastSeen: networkSwitchesTable.lastSeen,
      location: networkSwitchesTable.location,
    }).from(networkSwitchesTable),
    db.select({ building: vlansTable.building }).from(vlansTable),
    getAzureHybridVmEvidence(),
  ]);
  const liveStatusEvidence = await getDeviceStatusEvidence(
    switchRows
      .map((row) => row.mgmtIp)
      .filter(isMonitorableHost),
  );
  const authoritativeBuildings = await listAuthoritativeBuildings();
  const authoritativeBuildingSet = new Set(authoritativeBuildings);

  const nodeMap: Record<string, number> = {};
  const deviceMap: Record<string, number> = {};
  const connectivityObjectMap: Record<string, number> = {};
  const vlanMap: Record<string, number> = {};
  const buildingStatusEvidence: Record<string, ResolvedNetworkStatus[]> = {};

  for (const node of nodeRows) {
    const canonical = getAssignedBuildingName(node.building, node.location, node.hostname);
    if (!authoritativeBuildingSet.has(canonical)) continue;
    const isNonSwitchEndpoint = ["svi", "patch_panel", "isp", "endpoint"].includes(node.nodeKind)
      || /\b(?:SVI|Boiler Room)\b/i.test(node.location ?? "");
    if (isNonSwitchEndpoint) {
      connectivityObjectMap[canonical] = (connectivityObjectMap[canonical] ?? 0) + 1;
      continue;
    }
    nodeMap[canonical] = (nodeMap[canonical] ?? 0) + 1;
    deviceMap[canonical] = (deviceMap[canonical] ?? 0) + 1;
  }

  // Building counts come from the authoritative topology nodes, while current
  // health comes only from the explicitly monitored switch inventory. A
  // topology-only node with no Influx target must not turn a building red.
  for (const node of switchRows) {
    const canonical = getAssignedBuildingName(node.building, node.location, node.hostname);
    if (!authoritativeBuildingSet.has(canonical)) continue;
    if (!buildingStatusEvidence[canonical]) buildingStatusEvidence[canonical] = [];
    const observed = node.mgmtIp
      ? liveStatusEvidence[normalizeTelemetryKey(node.mgmtIp)]
      : undefined;
    buildingStatusEvidence[canonical].push(resolveNetworkStatusEvidence(
      observed?.status,
      observed?.lastObservedAt,
      node.status,
      node.lastSeen,
    ));
  }

  for (const vlan of vlanRows) {
    const canonical = getCanonicalBuildingName(vlan.building);
    if (!authoritativeBuildingSet.has(canonical)) continue;
    vlanMap[canonical] = (vlanMap[canonical] ?? 0) + 1;
  }

  return authoritativeBuildings.map((name) => {
    const classification = getBuildingClassification(name);
    const evidence = name === "Azure (Hybrid-VNet)"
      ? [resolveNetworkStatusEvidence(
        undefined,
        null,
        azureHybridEvidence.status,
        azureHybridEvidence.lastObservedAt,
      )]
      : (buildingStatusEvidence[name] ?? []);
    const statuses = evidence.map((item) => item.status);
    const healthColor = healthColorFromStatuses(statuses);
    const evidenceSummary = summarizeNetworkStatusEvidence(evidence);

    return {
      name,
      nodeCount: nodeMap[name] ?? 0,
      deviceCount: deviceMap[name] ?? 0,
      connectivityObjectCount: connectivityObjectMap[name] ?? 0,
      vlanCount: vlanMap[name] ?? 0,
      healthColor,
      ...evidenceSummary,
      influxConfigured: !!(INFLUX_URL && INFLUX_TOKEN),
      category: classification.category,
      monitoringStrategy: classification.monitoringStrategy,
    };
  });
}

/** Returns observed status with its collection time; missing telemetry remains unknown. */
async function getDeviceStatusEvidence(
  hosts: string[],
): Promise<Record<string, NetworkStatusObservation>> {
  const [heartbeat, nocStatus] = await Promise.all([
    getDeviceHeartbeat(hosts),
    getNocDeviceStatus(hosts),
  ]);
  const requested = Array.from(new Set(hosts.filter(isMonitorableHost).map(normalizeTelemetryKey)));
  return Object.fromEntries(
    requested.map((host) => [host, mergeNetworkStatusObservations(
      heartbeat[host]
        ? {
          status: heartbeat[host].status,
          lastObservedAt: heartbeat[host].lastSeen,
        }
        : undefined,
      nocStatus[host],
    )]),
  );
}

/** Compatibility view for callers that only need the resolved observation. */
async function getDeviceStatus(hosts: string[]): Promise<Record<string, LiveStatus>> {
  const evidence = await getDeviceStatusEvidence(hosts);
  return Object.fromEntries(
    Object.entries(evidence).map(([host, observation]) => [host, observation.status]),
  );
}

async function getDeviceHeartbeat(hosts: string[]): Promise<Record<string, { status: LiveStatus; lastSeen: string | null }>> {
  if (!INFLUX_URL || !INFLUX_TOKEN || hosts.length === 0) return {};

  const requested = new Set(hosts.map(normalizeTelemetryKey));
  const flux = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -30m)
  |> filter(fn: (r) =>
    (r._measurement == "snmp" and r._field == "sysUpTime") or
    (r._measurement == "ping" and r._field == "percent_packet_loss")
  )
  |> last()
  |> keep(columns: ["_time", "_measurement", "_field", "_value", "source", "sysName"])
`;
  const csv = await queryInflux(flux);
  if (!csv) return {};

  const rows = parseCsv(csv);
  const result: Record<string, { status: LiveStatus; lastSeen: string | null }> = Object.fromEntries(
    Array.from(requested).map((host) => [host, { status: "unknown" as const, lastSeen: null }]),
  );

  for (const row of rows) {
    const seenAt = row._time ? new Date(row._time) : null;
    if (!seenAt || Number.isNaN(seenAt.getTime())) continue;

    const iso = seenAt.toISOString();
    const loss = Number.parseFloat(row._value ?? "");
    const observedStatus: LiveStatus = row._measurement === "ping"
      ? (Number.isFinite(loss) ? (loss >= 100 ? "down" : loss > 0 ? "degraded" : "up") : "unknown")
      : "up";
    const candidates = [row.source ?? "", row.sysName ?? ""]
      .map(normalizeTelemetryKey)
      .filter(Boolean);

    for (const candidate of candidates) {
      if (requested.has(candidate)) {
        const prior = result[candidate];
        const priorTime = prior.lastSeen ? new Date(prior.lastSeen).getTime() : -1;
        const seenTime = seenAt.getTime();
        if (seenTime > priorTime || (seenTime === priorTime && observedStatus === "up")) {
          result[candidate] = { status: observedStatus, lastSeen: iso };
        }
      }
    }
  }

  return result;
}

async function getPingTrend(hours = 6): Promise<Array<{ time: string; averageResponseMs: number | null; percentPacketLoss: number | null }>> {
  if (!INFLUX_URL || !INFLUX_TOKEN) return [];

  const flux = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -${hours}h)
  |> filter(fn: (r) => r._measurement == "ping")
  |> filter(fn: (r) => r._field == "average_response_ms" or r._field == "percent_packet_loss")
  |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_field", "_value"])
`;
  const csv = await queryInflux(flux);
  if (!csv) return [];

  const rows = parseCsv(csv);
  const byTime = new Map<string, { time: string; averageResponseMs: number | null; percentPacketLoss: number | null }>();

  for (const row of rows) {
    const time = row._time;
    if (!time) continue;
    const bucket = byTime.get(time) ?? {
      time,
      averageResponseMs: null,
      percentPacketLoss: null,
    };
    const value = Number.parseFloat(row._value ?? "");
    if (!Number.isFinite(value)) continue;
    if (row._field === "average_response_ms") bucket.averageResponseMs = Number(value.toFixed(2));
    if (row._field === "percent_packet_loss") bucket.percentPacketLoss = Number(value.toFixed(2));
    byTime.set(time, bucket);
  }

  return Array.from(byTime.values()).sort((a, b) => a.time.localeCompare(b.time));
}

async function getLatestBpsFromFlux(flux: string): Promise<number | null> {
  const csv = await queryInflux(flux);
  if (!csv) return null;

  const rows = parseCsv(csv);
  const values = rows
    .map((row) => Number.parseFloat(row._value ?? ""))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) return null;
  return values[values.length - 1] ?? null;
}

async function getCampusBackboneLoadBps(): Promise<number | null> {
  if (!INFLUX_URL || !INFLUX_TOKEN) return null;

  const flux = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -10m)
  |> filter(fn: (r) => r._measurement == "interface")
  |> filter(fn: (r) => ${toFluxInterfaceFilter(CAMPUS_BACKBONE_INTERFACES)})
  |> filter(fn: (r) => r._field == "ifHCInOctets" or r._field == "ifHCOutOctets")
  |> aggregateWindow(every: 1m, fn: last, createEmpty: false)
  |> derivative(unit: 1s, nonNegative: true)
  |> map(fn: (r) => ({ r with _value: float(v: r._value) * 8.0 }))
  |> group(columns: ["_time"])
  |> sum(column: "_value")
  |> keep(columns: ["_time","_value"])
  |> last()
`;
  return getLatestBpsFromFlux(flux);
}

async function getFirewallThroughputBps(): Promise<{ totalBps: number | null; uploadBps: number | null; downloadBps: number | null }> {
  if (!INFLUX_URL || !INFLUX_TOKEN) {
    return { totalBps: null, uploadBps: null, downloadBps: null };
  }

  const flux = `
wanSysNames = ${toFluxStringArray(FORTIGATE_WAN_SYSNAMES)}
wanIfNames = ${toFluxStringArray(FORTIGATE_WAN_IF_NAMES)}

from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -10m)
  |> filter(fn: (r) => r._measurement == "interface")
  |> filter(fn: (r) => contains(value: r.sysName, set: wanSysNames) or r.source == "192.168.1.1")
  |> filter(fn: (r) => exists r.ifName and contains(value: r.ifName, set: wanIfNames))
  |> filter(fn: (r) => r._field == "ifHCInOctets" or r._field == "ifHCOutOctets")
  |> derivative(unit: 1s, nonNegative: true)
  |> map(fn: (r) => ({ r with _value: float(v: r._value) * 8.0 }))
  |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_field", "_value", "ifName", "sysName"])
  |> group(columns: ["sysName", "ifName", "_field"])
  |> last()
`;

  const csv = await queryInflux(flux);
  if (!csv) {
    return { totalBps: null, uploadBps: null, downloadBps: null };
  }

  const rows = parseCsv(csv);
  let uploadBps = 0;
  let downloadBps = 0;

  for (const row of rows) {
    const value = Number.parseFloat(row._value ?? "");
    if (!Number.isFinite(value)) continue;
    if (row._field === "ifHCOutOctets") uploadBps += value;
    if (row._field === "ifHCInOctets") downloadBps += value;
  }

  const normalizedUpload = uploadBps > 0 ? uploadBps : null;
  const normalizedDownload = downloadBps > 0 ? downloadBps : null;

  return {
    uploadBps: normalizedUpload,
    downloadBps: normalizedDownload,
    totalBps: ((normalizedUpload ?? 0) + (normalizedDownload ?? 0)) || null,
  };
}

export async function getMonitoringSnapshot(publicMode = false) {
  const [switchRows, vlans, buildings, azureHybridStatus] = await Promise.all([
    db.select({
      id: networkSwitchesTable.id,
      hostname: networkSwitchesTable.hostname,
      building: networkSwitchesTable.building,
      mgmtIp: networkSwitchesTable.ipAddress,
      model: networkSwitchesTable.model,
      status: networkSwitchesTable.status,
      lastSeen: networkSwitchesTable.lastSeen,
      location: networkSwitchesTable.location,
    }).from(networkSwitchesTable),
    db.select({ id: vlansTable.id, building: vlansTable.building }).from(vlansTable),
    getBuildingSummaries(),
    getAzureHybridVmStatus(),
  ]);
  const nodes = switchRows.map((node) => {
    const fingerprint = normalizeTelemetryKey(`${node.hostname} ${node.location ?? ""}`);
    const nodeKind = !node.model && /(?:^|[\s_-])svi(?:$|[\s_-])/.test(fingerprint)
      ? "svi"
      : /\bboiler room\b/.test(fingerprint) && !node.model
        ? "endpoint"
        : "switch";
    return {
      ...node,
      displayName: node.hostname,
      nodeKind,
      vendor: node.model?.split(/\s+/)[0] ?? null,
      role: nodeKind === "svi" ? "svi" : null as string | null,
    };
  });

  const heartbeatHosts = nodes
    .map((node) => node.mgmtIp)
    .filter(isMonitorableHost);
  const [influxReachable, trend, combinedEvidence] = await Promise.all([
    isInfluxReachable(),
    getPingTrend(6),
    getDeviceStatusEvidence(heartbeatHosts),
  ]);

  const [campusBackboneLoadBps, firewallThroughput] = await Promise.all([
    getCampusBackboneLoadBps(),
    getFirewallThroughputBps(),
  ]);

  const nodesWithStatus = nodes.map((node) => {
    const inventoryClass = "building-device";
    const observed = node.mgmtIp
      ? combinedEvidence[normalizeTelemetryKey(node.mgmtIp)]
      : undefined;
    const resolved = resolveNetworkStatusEvidence(
      observed?.status,
      observed?.lastObservedAt,
      node.status,
      node.lastSeen,
    );
    return {
      ...node,
      canonicalBuilding: getAssignedBuildingName(node.building, node.location, node.hostname),
      inventoryClass,
      liveStatus: resolved.status,
      statusSource: resolved.source,
      lastSeen: resolved.lastObservedAt,
    };
  });

  const fallbackBuildings = buildings.length > 0 ? buildings : [...DEFAULT_AUTHORITATIVE_BUILDINGS].map((name) => {
    const classification = getBuildingClassification(name);
    const nodeCount = nodesWithStatus.filter((node) => node.canonicalBuilding === name && node.inventoryClass !== "connectivity-object").length;
    const vlanCount = vlans.filter((vlan) => getCanonicalBuildingName(vlan.building) === name).length;
    const statuses = name === "Azure (Hybrid-VNet)"
      ? [azureHybridStatus]
      : getBuildingMonitorHosts(
        name,
        nodesWithStatus
          .filter((node) => node.canonicalBuilding === name)
          .map((node) => node.mgmtIp)
          .filter(isMonitorableHost),
      ).map((host) => combinedEvidence[normalizeTelemetryKey(host)]?.status ?? "unknown");

    const evidence = nodesWithStatus
      .filter((node) => node.canonicalBuilding === name)
      .map((node) => ({
        status: node.liveStatus,
        source: node.statusSource,
        lastObservedAt: node.lastSeen,
      }));

    return {
      name,
      nodeCount,
      vlanCount,
      healthColor: healthColorFromStatuses(statuses),
      ...summarizeNetworkStatusEvidence(evidence),
      category: classification.category,
      monitoringStrategy: classification.monitoringStrategy,
    };
  });

  const countedNodes = nodesWithStatus.filter((node) => node.inventoryClass !== "connectivity-object");

  const statusTotals = { up: 0, degraded: 0, down: 0, unknown: 0 };
  for (const node of countedNodes) statusTotals[node.liveStatus] += 1;

  const buildingTotals = { green: 0, amber: 0, red: 0, unknown: 0 };
  for (const building of fallbackBuildings) buildingTotals[building.healthColor] += 1;

  const vendors = Array.from(
    countedNodes.reduce((map, node) => {
      const key = (node.vendor || "Unknown").trim() || "Unknown";
      const entry = map.get(key) ?? { vendor: key, total: 0, up: 0, degraded: 0, down: 0, unknown: 0 };
      entry.total += 1;
      entry[node.liveStatus] += 1;
      map.set(key, entry);
      return map;
    }, new Map<string, { vendor: string; total: number; up: number; degraded: number; down: number; unknown: number }>()),
  )
    .map(([, value]) => value)
    .sort((a, b) => b.total - a.total);

  const deviceKinds = Array.from(
    countedNodes.reduce((map, node) => {
      const key = node.nodeKind || "other";
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  )
    .map(([kind, total]) => ({ kind, total }))
    .sort((a, b) => b.total - a.total);

  const alertingDevices = countedNodes
    .filter((node) => node.liveStatus !== "up")
    .sort((a, b) => {
      const rank = { down: 0, degraded: 1, unknown: 2, up: 3 };
      const diff = rank[a.liveStatus] - rank[b.liveStatus];
      if (diff !== 0) return diff;
      return a.canonicalBuilding.localeCompare(b.canonicalBuilding) || a.hostname.localeCompare(b.hostname);
    })
    .slice(0, publicMode ? 0 : 12)
    .map((node) => ({
      id: node.id,
      hostname: node.hostname,
      displayName: node.displayName,
      building: node.canonicalBuilding,
      vendor: node.vendor,
      role: node.role,
      kind: node.nodeKind,
      liveStatus: node.liveStatus,
      lastSeen: node.lastSeen,
    }));

  const lastUpdatedAt = [
    ...trend.map((point) => point.time),
    ...nodesWithStatus.map((node) => node.lastSeen).filter(Boolean) as string[],
  ].sort().at(-1) ?? null;

  return {
    configured: !!(INFLUX_URL && INFLUX_TOKEN),
    reachable: influxReachable,
    lastUpdatedAt,
    overview: {
      totalDevices: countedNodes.length,
      monitoredDevices: countedNodes.length,
      upDevices: statusTotals.up,
      degradedDevices: statusTotals.degraded,
      downDevices: statusTotals.down,
      unknownDevices: statusTotals.unknown,
      totalBuildings: fallbackBuildings.length,
      healthyBuildings: buildingTotals.green,
      degradedBuildings: buildingTotals.amber,
      downBuildings: buildingTotals.red,
      unknownBuildings: buildingTotals.unknown,
      totalVlans: vlans.length,
    },
    traffic: {
      campusBackboneLoadBps,
      firewallThroughputBps: firewallThroughput.totalBps,
      firewallUploadBps: firewallThroughput.uploadBps,
      firewallDownloadBps: firewallThroughput.downloadBps,
    },
    trend,
    vendors,
    deviceKinds,
    buildings: fallbackBuildings.map((building) => ({
      name: building.name,
      nodeCount: building.nodeCount,
      vlanCount: building.vlanCount,
      healthColor: building.healthColor,
      observedCount: building.observedCount,
      fallbackCount: building.fallbackCount,
      unknownCount: building.unknownCount,
      lastObservedAt: building.lastObservedAt,
      category: building.category,
      monitoringStrategy: building.monitoringStrategy,
    })),
    alertingDevices,
  };
}

// ---------------------------------------------------------------------------
// NET NODES – CRUD
// ---------------------------------------------------------------------------

const nodeInsertSchema = z.object({
  hostname:    z.string().min(1).max(80),
  displayName: z.string().min(1).max(120),
  nodeKind:    z.enum(["switch", "firewall", "router", "server", "svi", "patch_panel", "isp", "other"]),
  vendor:      z.string().max(20).optional(),
  model:       z.string().max(80).optional(),
  mgmtIp:      z.string().max(45).optional(),
  building:    z.string().min(1).max(80),
  location:    z.string().max(120).optional(),
  role:        z.enum(["core", "distribution", "access", "edge", "firewall", "controller", "svi"]),
  function:    z.string().max(30).optional(),
  criticality: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  tags:        z.array(z.string()).optional(),
  status:      z.enum(["online", "offline", "unknown"]).optional(),
  notes:       z.string().optional(),
});

const nodePatchSchema = nodeInsertSchema.partial();

/** GET /network/nodes – list all nodes, optionally filtered */
router.get("/nodes", requireAuth, async (req: any, res) => {
  const { q, building, kind, role } = req.query;
  const conds: any[] = [];
  if (q) {
    conds.push(or(
      ilike(netNodesTable.hostname, `%${q}%`),
      ilike(netNodesTable.displayName, `%${q}%`),
      ilike(netNodesTable.building, `%${q}%`),
      ilike(netNodesTable.mgmtIp, `%${q}%`),
    ));
  }
  if (building) conds.push(ilike(netNodesTable.building, `%${building}%`));
  if (kind)     conds.push(eq(netNodesTable.nodeKind, kind as string));
  if (role)     conds.push(eq(netNodesTable.role, role as string));

  const nodes = conds.length
    ? await db.select().from(netNodesTable).where(and(...conds)).orderBy(netNodesTable.building, netNodesTable.hostname)
    : await db.select().from(netNodesTable).orderBy(netNodesTable.building, netNodesTable.hostname);

  return res.json(nodes);
});

/** POST /network/nodes – create a node */
router.post("/nodes", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = nodeInsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const result = await saveNetNodeByIdentity(parsed.data);
  await syncMaintainedSwitchFromNode(null, result.row, req);
  return res.status(result.action === "created" ? 201 : 200).json(result.row);
});

/** GET /network/nodes/:id – node detail with links */
router.get("/nodes/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const [node] = await db.select().from(netNodesTable).where(eq(netNodesTable.id, id));
  if (!node) return res.status(404).json({ error: "Not found" });

  // All links where this node is either endpoint
  const links = await db.select().from(netLinksTable).where(
    or(eq(netLinksTable.aNodeId, id), eq(netLinksTable.bNodeId, id))
  );

  // Resolve peer node details
  const peerIds = [...new Set(links.flatMap((l) =>
    [l.aNodeId === id ? l.bNodeId : l.aNodeId]
  ))];
  const peers = peerIds.length
    ? await db.select({
        id: netNodesTable.id,
        hostname: netNodesTable.hostname,
        displayName: netNodesTable.displayName,
        building: netNodesTable.building,
        mgmtIp: netNodesTable.mgmtIp,
        nodeKind: netNodesTable.nodeKind,
        role: netNodesTable.role,
      }).from(netNodesTable).where(
        or(...peerIds.map((pid) => eq(netNodesTable.id, pid)))
      )
    : [];

  const peerMap = Object.fromEntries(peers.map((p) => [p.id, p]));

  const enrichedLinks = links.map((l) => ({
    ...l,
    localPort:  l.aNodeId === id ? l.aPort : l.bPort,
    remotePort: l.aNodeId === id ? l.bPort : l.aPort,
    peerNode:   peerMap[l.aNodeId === id ? l.bNodeId : l.aNodeId] ?? null,
    direction:  l.aNodeId === id ? "a" : "b",
  }));

  // Live status from InfluxDB (best-effort)
  let liveStatus: "up" | "degraded" | "down" | "unknown" = "unknown";
  if (node.mgmtIp) {
    const [statuses, inventory] = await Promise.all([
      getDeviceStatus([node.mgmtIp, node.hostname]),
      findSwitchByIdentity({ hostname: node.hostname, ipAddress: node.mgmtIp }),
    ]);
    liveStatus = resolveNetworkStatus(
      statuses[normalizeTelemetryKey(node.mgmtIp ?? "")] ??
        statuses[normalizeTelemetryKey(node.hostname)],
      inventory?.status ?? node.status,
      inventory?.lastSeen,
    );
  }

  return res.json({ ...node, links: enrichedLinks, liveStatus });
});

/** PATCH /network/nodes/:id – update node fields */
router.patch("/nodes/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const { id } = req.params;
  const parsed = nodePatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const [existing] = await db.select().from(netNodesTable).where(eq(netNodesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const result = await saveNetNodeByIdentity({
    hostname: parsed.data.hostname ?? existing.hostname,
    displayName: parsed.data.displayName ?? existing.displayName,
    nodeKind: parsed.data.nodeKind ?? existing.nodeKind,
    vendor: parsed.data.vendor ?? existing.vendor,
    model: parsed.data.model ?? existing.model,
    mgmtIp: parsed.data.mgmtIp ?? existing.mgmtIp,
    building: parsed.data.building ?? existing.building,
    location: parsed.data.location ?? existing.location,
    role: parsed.data.role ?? existing.role,
    function: parsed.data.function ?? existing.function,
    criticality: parsed.data.criticality ?? existing.criticality,
    tags: parsed.data.tags ?? existing.tags,
    status: parsed.data.status ?? existing.status,
    notes: parsed.data.notes ?? existing.notes,
  }, id);
  await syncMaintainedSwitchFromNode(existing, result.row, req);
  return res.json(result.row);
});

/** DELETE /network/nodes/:id */
router.delete("/nodes/:id", requireAuth, requireNetworkAdmin, async (req, res) => {
  const { id } = req.params;
  const [node] = await db.select().from(netNodesTable).where(eq(netNodesTable.id, id));
  if (!node) return res.status(404).json({ error: "Not found" });
  const inventory = ["switch", "firewall"].includes(node.nodeKind)
    ? await findSwitchByIdentity({ hostname: node.hostname, ipAddress: node.mgmtIp })
    : null;
  if (inventory) {
    return res.status(409).json({
      error: "This is a maintained physical asset. Retire or remove its switch inventory record before deleting its topology node.",
      switchId: inventory.id,
    });
  }
  await db.delete(netNodesTable).where(eq(netNodesTable.id, id));
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// NET LINKS – CRUD
// ---------------------------------------------------------------------------

const linkInsertSchema = z.object({
  aNodeId:         z.string().uuid(),
  aPort:           z.string().min(1).max(40),
  bNodeId:         z.string().uuid(),
  bPort:           z.string().min(1).max(40),
  linkKind:        z.enum(["fiber", "dac", "copper", "wireless", "vpn", "virtual", "unknown"]),
  speedMbps:       z.number().int().positive().optional(),
  portMode:        z.enum(["trunk", "access", "routed", "peerlink", "heartbeat", "unknown"]).optional(),
  nativeVlan:      z.number().int().optional(),
  allowedVlans:    z.array(z.number().int()).optional(),
  portchannel:     z.string().max(20).optional(),
  lldpPeerHostname: z.string().max(80).optional(),
  lldpPeerMgmtIp:  z.string().max(45).optional(),
  confidence:      z.enum(["confirmed_lldp", "confirmed_cdp", "confirmed_manual", "inferred", "stale"]),
  lastVerifiedAt:  z.string().datetime(),
  evidenceRef:     z.string().max(200).optional(),
  notes:           z.string().optional(),
});

const linkPatchSchema = linkInsertSchema.partial().omit({ aNodeId: true, bNodeId: true });

/** POST /network/nodes/:id/links – add a link from this node */
router.post("/nodes/:id/links", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const { id } = req.params;
  const parsed = linkInsertSchema.safeParse({ ...req.body, aNodeId: req.body.aNodeId ?? id });
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const result = await saveNetLinkByIdentity(parsed.data);
  return res.status(result.action === "created" ? 201 : 200).json(result.row);
});

/** PATCH /network/links/:id – update a link */
router.patch("/links/:id", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const { id } = req.params;
  const parsed = linkPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const [existing] = await db.select().from(netLinksTable).where(eq(netLinksTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const result = await saveNetLinkByIdentity({
    aNodeId: existing.aNodeId,
    aPort: parsed.data.aPort ?? existing.aPort,
    bNodeId: existing.bNodeId,
    bPort: parsed.data.bPort ?? existing.bPort,
    linkKind: parsed.data.linkKind ?? existing.linkKind,
    speedMbps: parsed.data.speedMbps ?? existing.speedMbps,
    portMode: parsed.data.portMode ?? existing.portMode,
    nativeVlan: parsed.data.nativeVlan ?? existing.nativeVlan,
    allowedVlans: parsed.data.allowedVlans ?? existing.allowedVlans,
    portchannel: parsed.data.portchannel ?? existing.portchannel,
    lldpPeerHostname: parsed.data.lldpPeerHostname ?? existing.lldpPeerHostname,
    lldpPeerMgmtIp: parsed.data.lldpPeerMgmtIp ?? existing.lldpPeerMgmtIp,
    confidence: parsed.data.confidence ?? existing.confidence,
    lastVerifiedAt: parsed.data.lastVerifiedAt ?? existing.lastVerifiedAt,
    evidenceRef: parsed.data.evidenceRef ?? existing.evidenceRef,
    notes: parsed.data.notes ?? existing.notes,
  }, id);
  return res.json(result.row);
});

/** DELETE /network/links/:id */
router.delete("/links/:id", requireAuth, requireNetworkAdmin, async (req, res) => {
  const { id } = req.params;
  await db.delete(netLinksTable).where(eq(netLinksTable.id, id));
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// BUILDINGS – summary + detail
// ---------------------------------------------------------------------------

const buildingOverlayPutSchema = z.object({
  positions: z.array(z.object({
    code: z.string().trim().min(1).max(20),
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
    labelDx: z.number().finite().min(-400).max(400).optional().nullable(),
    labelDy: z.number().finite().min(-400).max(400).optional().nullable(),
  })).min(1).max(100),
});

router.get("/public/buildings/map-layout", async (_req, res) => {
  return res.json(await getBuildingMapLayoutPositions());
});

router.get("/public/buildings", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(await getBuildingSummaries());
});

router.get("/public/monitoring/summary", async (_req, res) => {
  return res.json(await getMonitoringSnapshot(true));
});

router.get("/buildings/map-layout", requireAuth, async (_req, res) => {
  return res.json(await getBuildingMapLayoutPositions());
});

router.put("/buildings/map-layout", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = buildingOverlayPutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  }

  const now = new Date();
  const userId = req.user?.id ?? null;
  const values = parsed.data.positions.map((position) => ({
    nodeId: overlayNodeId(position.code),
    x: position.x,
    y: position.y,
    width: position.labelDx ?? null,
    height: position.labelDy ?? null,
    updatedAt: now,
    updatedBy: userId,
  }));

  await db
    .insert(networkLayoutPositionsTable)
    .values(values)
    .onConflictDoUpdate({
      target: networkLayoutPositionsTable.nodeId,
      set: {
        x: sql`excluded.x`,
        y: sql`excluded.y`,
        width: sql`excluded.width`,
        height: sql`excluded.height`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    });

  return res.json({ saved: values.length });
});

router.delete("/buildings/map-layout", requireAuth, requireNetworkAdmin, async (req, res) => {
  const parsed = z.object({
    codes: z.array(z.string().trim().min(1).max(20)).optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  }

  const codes = parsed.data.codes ?? [];
  if (codes.length > 0) {
    await db
      .delete(networkLayoutPositionsTable)
      .where(inArray(networkLayoutPositionsTable.nodeId, codes.map(overlayNodeId)));
    return res.json({ ok: true, removed: codes.length });
  }

  const rows = await db.select().from(networkLayoutPositionsTable);
  const ids = rows
    .map((row) => row.nodeId)
    .filter((nodeId) => nodeId.startsWith(BUILDING_OVERLAY_PREFIX));

  if (ids.length > 0) {
    await db.delete(networkLayoutPositionsTable).where(inArray(networkLayoutPositionsTable.nodeId, ids));
  }
  return res.json({ ok: true, removed: ids.length });
});

router.post("/buildings", requireAuth, requireNetworkAdmin, async (req: any, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  }

  const name = parsed.data.name;
  await db
    .insert(networkLayoutPositionsTable)
    .values({
      nodeId: explicitBuildingNodeId(name),
      x: 0,
      y: 0,
      width: null,
      height: null,
      updatedAt: new Date(),
      updatedBy: req.user?.id ?? null,
    })
    .onConflictDoNothing();

  return res.status(201).json({ name });
});

/** GET /network/buildings – all buildings with node/vlan counts + live status */
router.get("/buildings", requireAuth, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(await getBuildingSummaries());
});

/** PATCH /network/buildings/:name – authoritative rename across devices and VLANs */
router.patch("/buildings/:name", requireAuth, requireNetworkAdmin, async (req, res) => {
  const currentName = decodeURIComponent(req.params.name).trim();
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
  const newName = parsed.data.name;
  const currentExplicitId = explicitBuildingNodeId(currentName);
  const newExplicitId = explicitBuildingNodeId(newName);
  const switchesBefore = await db
    .select()
    .from(networkSwitchesTable)
    .where(ilike(networkSwitchesTable.building, currentName));

  const switchesAfter = await db.transaction(async (tx) => {
    await tx.update(netNodesTable).set({ building: newName, updatedAt: new Date() }).where(ilike(netNodesTable.building, currentName));
    const renamedSwitches = await tx
      .update(networkSwitchesTable)
      .set({ building: newName, updatedAt: new Date() })
      .where(ilike(networkSwitchesTable.building, currentName))
      .returning();
    await tx.update(vlansTable).set({ building: newName }).where(ilike(vlansTable.building, currentName));
    const [existingExplicit] = await tx
      .select()
      .from(networkLayoutPositionsTable)
      .where(eq(networkLayoutPositionsTable.nodeId, currentExplicitId));
    if (existingExplicit) {
      await tx
        .insert(networkLayoutPositionsTable)
        .values({
          ...existingExplicit,
          nodeId: newExplicitId,
          updatedAt: new Date(),
          updatedBy: null,
        })
        .onConflictDoNothing();
      await tx.delete(networkLayoutPositionsTable).where(eq(networkLayoutPositionsTable.nodeId, currentExplicitId));
    }
    return renamedSwitches;
  });

  for (const renamed of switchesAfter) {
    const before = switchesBefore.find((candidate) => candidate.id === renamed.id) ?? null;
    await recordInventoryAudit({
      entityType: "switch",
      entityId: renamed.id,
      entityLabel: renamed.hostname,
      action: "update",
      source: "manual",
      actor: requestActor(req),
      changes: diffFields(before, renamed, SWITCH_AUDIT_FIELDS),
    });
  }

  return res.json({ oldName: currentName, name: newName });
});

router.delete("/buildings/:name", requireAuth, requireNetworkAdmin, async (req, res) => {
  const rawName = decodeURIComponent(req.params.name).trim();
  const canonicalName = getCanonicalBuildingName(rawName);
  const [allNodes, allVlans] = await Promise.all([
    db.select({ building: netNodesTable.building }).from(netNodesTable),
    db.select({ building: vlansTable.building }).from(vlansTable),
  ]);
  const nodeCount = allNodes.filter((node) => getCanonicalBuildingName(node.building) === canonicalName).length;
  const vlanCount = allVlans.filter((vlan) => getCanonicalBuildingName(vlan.building) === canonicalName).length;

  if (nodeCount > 0 || vlanCount > 0) {
    return res.status(409).json({
      error: "BUILDING_NOT_EMPTY",
      message: "Move or delete the switches and VLANs in this building before removing it.",
      nodeCount,
      vlanCount,
    });
  }

  await db.delete(networkLayoutPositionsTable).where(eq(networkLayoutPositionsTable.nodeId, explicitBuildingNodeId(rawName)));
  return res.json({ ok: true, name: rawName });
});
/** GET /network/buildings/:name – all nodes, vlans, and live status for a building */
router.get("/buildings/:name", requireAuth, async (req, res) => {
  const name = decodeURIComponent(req.params.name).trim();
  const authoritativeBuildings = await listAuthoritativeBuildings();
  const canonicalName = authoritativeBuildings.includes(name) ? name : getCanonicalBuildingName(name);

  const [allNodes, allVlans, allSwitches, azureHybridStatus] = await Promise.all([
    db.select().from(netNodesTable).orderBy(netNodesTable.building, netNodesTable.role, netNodesTable.hostname),
    db.select().from(vlansTable).orderBy(vlansTable.building, vlansTable.vlanId),
    db.select().from(networkSwitchesTable),
    getAzureHybridVmStatus(),
  ]);

  const nodes = allNodes.filter((node) => getAssignedBuildingName(node.building, node.location, node.hostname) === canonicalName);
  const vlans = allVlans.filter((vlan) => getCanonicalBuildingName(vlan.building) === canonicalName);

  // Links for all nodes in this building
  const nodeIds = nodes.map((n) => n.id);
  const links = nodeIds.length
    ? await db.select().from(netLinksTable).where(
        or(
          ...nodeIds.map((id) => eq(netLinksTable.aNodeId, id)),
          ...nodeIds.map((id) => eq(netLinksTable.bNodeId, id)),
        )
      )
    : [];

  // Live status
  const hosts = getBuildingMonitorHosts(
    canonicalName,
    nodes.map((n) => n.mgmtIp).filter(isMonitorableHost),
  );
  const classification = getBuildingClassification(canonicalName);
  const liveStatusEvidence = hosts.length ? await getDeviceStatusEvidence(hosts) : {};
  const monitoredHosts = new Set(hosts.map(normalizeTelemetryKey));

  const nodesWithStatus = nodes.map((n) => {
    const inventory = allSwitches.find((candidate) =>
      (n.mgmtIp && candidate.ipAddress === n.mgmtIp) ||
      normalizeTelemetryKey(candidate.hostname) === normalizeTelemetryKey(n.hostname),
    );
    const observed = isMonitorableHost(n.mgmtIp) && monitoredHosts.has(normalizeTelemetryKey(n.mgmtIp))
      ? liveStatusEvidence[normalizeTelemetryKey(n.mgmtIp)]
      : undefined;
    const resolved = resolveNetworkStatusEvidence(
      observed?.status,
      observed?.lastObservedAt,
      inventory?.status ?? n.status,
      inventory?.lastSeen,
    );
    return {
      ...n,
      inventoryClass: isConnectivityObjectNode(n, canonicalName) ? "connectivity-object" : "building-device",
      liveStatus: resolved.status,
      statusSource: resolved.source,
      lastObservedAt: resolved.lastObservedAt,
    };
  });

  const statuses = canonicalName === "Azure (Hybrid-VNet)"
    ? [azureHybridStatus]
    : nodesWithStatus
      .filter((node) => node.inventoryClass !== "connectivity-object")
      .map((node) => node.liveStatus);
  const healthColor = healthColorFromStatuses(statuses);
  const evidenceSummary = summarizeNetworkStatusEvidence(
    nodesWithStatus
      .filter((node) => node.inventoryClass !== "connectivity-object")
      .map((node) => ({
        status: node.liveStatus,
        source: node.statusSource,
        lastObservedAt: node.lastObservedAt,
      })),
  );

  return res.json({
    name: canonicalName,
    building: canonicalName,
    nodes: nodesWithStatus,
    vlans,
    links,
    healthColor,
    ...evidenceSummary,
    influxConfigured: !!(INFLUX_URL && INFLUX_TOKEN),
    category: classification.category,
    monitoringStrategy: classification.monitoringStrategy,
  });
});

router.get("/monitoring/summary", requireAuth, async (_req, res) => {
  return res.json(await getMonitoringSnapshot(false));
});

// ---------------------------------------------------------------------------
// INFLUX – device status (stub/live)
// ---------------------------------------------------------------------------

/** GET /network/influx/status – overall device health from InfluxDB */
router.get("/influx/status", requireAuth, async (_req, res) => {
  if (!INFLUX_URL || !INFLUX_TOKEN) {
    return res.json({
      configured: false,
      message: "Set INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG env vars to enable live status",
      devices: [],
    });
  }

  const flux = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -10m)
  |> filter(fn: (r) => r._measurement == "ping")
  |> filter(fn: (r) => r._field == "percent_packet_loss")
  |> last()
  |> keep(columns: ["source", "_value", "_time"])
`;
  const csv = await queryInflux(flux);
  if (!csv) {
    return res.json({ configured: true, reachable: false, devices: [] });
  }

  const rows = parseCsv(csv);
  const devices = rows.map((r) => {
    const loss = parseFloat(r._value ?? "100");
    return {
      host: r.source,
      packetLoss: loss,
      status: loss === 0 ? "up" : loss < 50 ? "degraded" : "down",
      lastSeen: r._time,
    };
  });

  return res.json({ configured: true, reachable: true, devices });
});

/** GET /network/influx/device/:host – single device detail from InfluxDB */
router.get("/influx/device/:host", requireAuth, async (req, res) => {
  const host = req.params.host;
  if (!INFLUX_URL || !INFLUX_TOKEN) {
    return res.json({ configured: false, host, metrics: null });
  }

  const flux = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -15m)
  |> filter(fn: (r) => r.source == "${host}" or r.agent_host == "${host}")
  |> filter(fn: (r) =>
      r._field == "percent_packet_loss" or
      r._field == "average_response_ms" or
      r._field == "uptime" or
      r._field == "ifOperStatus"
  )
  |> last()
  |> keep(columns: ["_measurement", "_field", "_value", "ifName", "_time"])
`;
  const csv = await queryInflux(flux);
  if (!csv) return res.json({ configured: true, reachable: false, host, metrics: null });

  const rows = parseCsv(csv);
  const metrics: Record<string, any> = {};
  const interfaces: Record<string, any> = {};

  for (const r of rows) {
    if (r._measurement === "ping") {
      metrics[r._field] = r._value;
    } else if (r._measurement === "interface" && r.ifName) {
      if (!interfaces[r.ifName]) interfaces[r.ifName] = {};
      interfaces[r.ifName][r._field] = r._value;
    } else {
      metrics[r._field] = r._value;
    }
  }

  return res.json({ configured: true, reachable: true, host, metrics, interfaces, lastPolled: new Date().toISOString() });
});

export default router;
