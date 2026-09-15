export const DEFAULT_AUTHORITATIVE_BUILDINGS = [
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
  "Mansions",
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

export function normalizeBuildingKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Preserve an exact authoritative display name before applying legacy alias
 * canonicalization. Lettered dorm/tech buildings are separate map entities
 * even though older inventory labels may roll up to a campus grouping.
 */
export function getAuthoritativeBuildingName(
  rawBuilding: string,
  authoritativeBuildings: readonly string[],
): string {
  const key = normalizeBuildingKey(rawBuilding);
  const exact = authoritativeBuildings.find(
    (name) => normalizeBuildingKey(name) === key,
  );
  if (exact) return exact;

  const canonical = getCanonicalBuildingName(rawBuilding);
  return authoritativeBuildings.find(
    (name) => normalizeBuildingKey(name) === normalizeBuildingKey(canonical),
  ) ?? canonical;
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
    "student life ab": "Mansions",
    "student life de": "Mansions",
    "student living ab": "Mansions",
    "student living a b": "Mansions",
    "student living cd": "Mansions",
    "student living c d": "Mansions",
    "student living de": "Mansions",
    "student living d e": "Mansions",
    "swa slab": "Mansions",
    "swa slcde": "Mansions",
    "student living slg": "Student Living Center",
    "student living slh": "Student Living Center",
    "student living slj": "Student Living Center",
    "student living slr": "Student Living Center",
    "student living sls": "Student Living Center",
    "student living slt": "Student Living Center",
    "tech ta107": "Industrial Technology Campus",
    "tech tt103": "Industrial Technology Campus",
    "tech t122 mgmt": "Industrial Technology Campus",
    "tech t122 svi": "Industrial Technology Campus",
    "tech b141": "Industrial Technology Campus",
    "tech d201": "Industrial Technology Campus",
    "tech core 3": "Industrial Technology Campus",
    "tech core 4": "Industrial Technology Campus",
    "tech building": "Industrial Technology Campus",
    "tech building b": "Industrial Technology Campus",
    "tech building d": "Industrial Technology Campus",
    "tech building f": "Industrial Technology Campus",
    "tech building t": "Industrial Technology Campus",
    "technology": "Industrial Technology Campus",
    "technology a": "Industrial Technology Campus",
    "technology b": "Industrial Technology Campus",
    "technology d": "Industrial Technology Campus",
    "technology t": "Industrial Technology Campus",
    "west campus": "West Campus",
  };
  if (exactMatches[key]) return exactMatches[key];

  if (key.includes("azure connectivity")) return "Azure Connectivity (Objects)";
  if (key.includes("azure")) return "Azure (Hybrid-VNet)";
  if (key.includes("mansions")) return "Mansions";
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

export function getAssignedBuildingName(
  building: string | null | undefined,
  location?: string | null,
  hostname?: string | null,
): string {
  const hint = normalizeBuildingKey(`${location ?? ""} ${hostname ?? ""}`);
  if (/\b(?:swa slab|swa slcde|student living a b|student living c d|student living d e)\b/.test(hint)) {
    return "Mansions";
  }
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
