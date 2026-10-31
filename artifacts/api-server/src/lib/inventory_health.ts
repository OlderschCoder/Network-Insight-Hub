// Pure, DB-free helpers that analyze the network inventory for data-quality
// problems: inconsistent building/switch naming, stale switches, and coverage
// gaps between switches and VLANs. Kept side-effect-free so they are trivial to
// unit test and safe to call from any route.

export interface HealthSwitch {
  id: number;
  hostname: string;
  building: string | null;
  status: string | null;
  lastSeen: Date | string | null;
  updatedAt: Date | string | null;
}

export interface HealthVlan {
  id: number;
  vlanId: number;
  name: string | null;
  building: string | null;
}

// ---- Building-name normalization ------------------------------------------

// Canonical key used to decide whether two building labels refer to the same
// place. Lower-cases, collapses whitespace, and strips a trailing parenthetical
// code (e.g. "Agriculture (V201)" and "Agriculture" share the key "agriculture").
export function buildingKey(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .replace(/\([^)]*\)/g, " ") // drop parenthetical codes anywhere
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pickCanonical(variants: Map<string, number>): string {
  // Most frequently used spelling wins; ties break toward the longer, more
  // descriptive label (it usually carries the building code).
  let best = "";
  let bestCount = -1;
  for (const [name, count] of variants) {
    if (count > bestCount || (count === bestCount && name.length > best.length)) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

export interface BuildingNamingIssue {
  key: string;
  canonical: string;
  variants: { name: string; switches: number; vlans: number }[];
}

export function analyzeBuildingNaming(
  switches: HealthSwitch[],
  vlans: HealthVlan[],
): BuildingNamingIssue[] {
  // key -> raw name -> { switches, vlans }
  const groups = new Map<string, Map<string, { switches: number; vlans: number }>>();

  const bump = (raw: string | null, kind: "switches" | "vlans") => {
    const name = (raw ?? "").trim();
    if (!name) return;
    const key = buildingKey(name);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, new Map());
    const variants = groups.get(key)!;
    if (!variants.has(name)) variants.set(name, { switches: 0, vlans: 0 });
    variants.get(name)![kind] += 1;
  };

  for (const s of switches) bump(s.building, "switches");
  for (const v of vlans) bump(v.building, "vlans");

  const issues: BuildingNamingIssue[] = [];
  for (const [key, variants] of groups) {
    if (variants.size < 2) continue; // consistent — only one spelling
    const counts = new Map<string, number>();
    for (const [name, c] of variants) counts.set(name, c.switches + c.vlans);
    issues.push({
      key,
      canonical: pickCanonical(counts),
      variants: Array.from(variants.entries())
        .map(([name, c]) => ({ name, switches: c.switches, vlans: c.vlans }))
        .sort((a, b) => b.switches + b.vlans - (a.switches + a.vlans)),
    });
  }
  return issues.sort((a, b) => a.canonical.localeCompare(b.canonical));
}

// ---- Switch-name convention checks ----------------------------------------

// Structural fingerprint of a hostname: letter runs -> "A", digit runs -> "#",
// separators preserved. "sw-aa144-a48" -> "A-A#-A#". Used to spot outliers.
export function hostnameShape(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/[a-z]+/g, "A")
    .replace(/[0-9]+/g, "#");
}

function dominantPrefix(hostnames: string[]): string | null {
  const counts = new Map<string, number>();
  for (const h of hostnames) {
    const m = h.trim().toLowerCase().match(/^([a-z]+[-_])/);
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [p, c] of counts) {
    if (c > bestCount) {
      best = p;
      bestCount = c;
    }
  }
  // Only treat a prefix as a convention if a clear majority uses it.
  return best && bestCount >= Math.ceil(hostnames.length / 2) ? best : null;
}

export interface SwitchNamingIssue {
  id: number;
  hostname: string;
  building: string | null;
  reason: string;
}

export function analyzeSwitchNaming(switches: HealthSwitch[]): SwitchNamingIssue[] {
  const issues: SwitchNamingIssue[] = [];
  const named = switches.filter((s) => (s.hostname ?? "").trim());
  if (named.length < 2) return issues;

  // 1) Global prefix convention (e.g. most switches start with "sw-").
  const prefix = dominantPrefix(named.map((s) => s.hostname));
  if (prefix) {
    for (const s of named) {
      if (!s.hostname.trim().toLowerCase().startsWith(prefix)) {
        issues.push({
          id: s.id,
          hostname: s.hostname,
          building: s.building,
          reason: `Doesn't use the common "${prefix}" hostname prefix.`,
        });
      }
    }
  }

  // 2) Per-building structural outliers: within a building, if most switches
  //    share one hostname shape, flag the minority shapes.
  const byBuilding = new Map<string, HealthSwitch[]>();
  for (const s of named) {
    const key = buildingKey(s.building);
    if (!key) continue;
    if (!byBuilding.has(key)) byBuilding.set(key, []);
    byBuilding.get(key)!.push(s);
  }
  const alreadyFlagged = new Set(issues.map((i) => i.id));
  for (const group of byBuilding.values()) {
    if (group.length < 3) continue; // too few to establish a convention
    const shapeCounts = new Map<string, number>();
    for (const s of group) {
      const shape = hostnameShape(s.hostname);
      shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1);
    }
    if (shapeCounts.size < 2) continue;
    let common = "";
    let commonCount = 0;
    for (const [shape, c] of shapeCounts) {
      if (c > commonCount) {
        common = shape;
        commonCount = c;
      }
    }
    if (commonCount < Math.ceil(group.length / 2)) continue; // no clear majority
    for (const s of group) {
      if (alreadyFlagged.has(s.id)) continue;
      if (hostnameShape(s.hostname) !== common) {
        issues.push({
          id: s.id,
          hostname: s.hostname,
          building: s.building,
          reason: `Naming pattern differs from others in this building.`,
        });
      }
    }
  }
  return issues;
}

// ---- Staleness -------------------------------------------------------------

export interface StaleSwitch {
  id: number;
  hostname: string;
  building: string | null;
  status: string | null;
  lastSeen: string | null;
  daysStale: number;
}

function toDate(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Switches whose status is not "online" and that haven't been seen (or, if
// never seen, last updated) within `staleDays` days.
export function detectStaleSwitches(
  switches: HealthSwitch[],
  staleDays: number,
  now: Date = new Date(),
): StaleSwitch[] {
  const cutoffMs = staleDays * 24 * 60 * 60 * 1000;
  const out: StaleSwitch[] = [];
  for (const s of switches) {
    const status = (s.status ?? "").toLowerCase();
    if (status === "online") continue;
    const ref = toDate(s.lastSeen) ?? toDate(s.updatedAt);
    if (!ref) continue;
    const ageMs = now.getTime() - ref.getTime();
    if (ageMs < cutoffMs) continue;
    out.push({
      id: s.id,
      hostname: s.hostname,
      building: s.building,
      status: s.status ?? null,
      lastSeen: toDate(s.lastSeen)?.toISOString() ?? null,
      daysStale: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
    });
  }
  return out.sort((a, b) => b.daysStale - a.daysStale);
}

// ---- Coverage gaps ---------------------------------------------------------

export interface CoverageGaps {
  vlansWithoutSwitches: { building: string; vlans: number }[];
  switchesWithoutVlans: { building: string; switches: number }[];
}

export function analyzeCoverageGaps(
  switches: HealthSwitch[],
  vlans: HealthVlan[],
): CoverageGaps {
  const swByKey = new Map<string, { label: string; count: number }>();
  const vlanByKey = new Map<string, { label: string; count: number }>();

  for (const s of switches) {
    const label = (s.building ?? "").trim();
    const key = buildingKey(label);
    if (!key) continue;
    if (!swByKey.has(key)) swByKey.set(key, { label, count: 0 });
    swByKey.get(key)!.count += 1;
  }
  for (const v of vlans) {
    const label = (v.building ?? "").trim();
    const key = buildingKey(label);
    if (!key) continue;
    if (!vlanByKey.has(key)) vlanByKey.set(key, { label, count: 0 });
    vlanByKey.get(key)!.count += 1;
  }

  const vlansWithoutSwitches: { building: string; vlans: number }[] = [];
  for (const [key, v] of vlanByKey) {
    if (!swByKey.has(key)) vlansWithoutSwitches.push({ building: v.label, vlans: v.count });
  }
  const switchesWithoutVlans: { building: string; switches: number }[] = [];
  for (const [key, s] of swByKey) {
    if (!vlanByKey.has(key)) switchesWithoutVlans.push({ building: s.label, switches: s.count });
  }

  return {
    vlansWithoutSwitches: vlansWithoutSwitches.sort((a, b) => a.building.localeCompare(b.building)),
    switchesWithoutVlans: switchesWithoutVlans.sort((a, b) => a.building.localeCompare(b.building)),
  };
}

// ---- Aggregate -------------------------------------------------------------

export interface InventoryHealthReport {
  staleDays: number;
  generatedAt: string;
  counts: {
    switches: number;
    vlans: number;
    buildingNamingIssues: number;
    switchNamingIssues: number;
    staleSwitches: number;
    coverageGaps: number;
  };
  buildingNaming: BuildingNamingIssue[];
  switchNaming: SwitchNamingIssue[];
  staleSwitches: StaleSwitch[];
  coverage: CoverageGaps;
}

export function buildInventoryHealth(
  switches: HealthSwitch[],
  vlans: HealthVlan[],
  opts: { staleDays: number; now?: Date },
): InventoryHealthReport {
  const buildingNaming = analyzeBuildingNaming(switches, vlans);
  const switchNaming = analyzeSwitchNaming(switches);
  const staleSwitches = detectStaleSwitches(switches, opts.staleDays, opts.now);
  const coverage = analyzeCoverageGaps(switches, vlans);
  return {
    staleDays: opts.staleDays,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    counts: {
      switches: switches.length,
      vlans: vlans.length,
      buildingNamingIssues: buildingNaming.length,
      switchNamingIssues: switchNaming.length,
      staleSwitches: staleSwitches.length,
      coverageGaps: coverage.vlansWithoutSwitches.length + coverage.switchesWithoutVlans.length,
    },
    buildingNaming,
    switchNaming,
    staleSwitches,
    coverage,
  };
}
