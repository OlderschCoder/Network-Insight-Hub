const NON_PHYSICAL_DIAGNOSTICS_SCOPES = new Set([
  "Azure (Hybrid-VNet)",
  "Azure Connectivity (Objects)",
  "Business",
  "Campus Wide",
  "Maintenance",
]);

const AGGREGATED_DIAGNOSTICS_BUILDINGS: Record<string, string> = {
  "Epworth ALC": "Industrial Technology Campus",
  "Technology B": "Industrial Technology Campus",
  "Tech Building A": "Industrial Technology Campus",
  "Tech Building B": "Industrial Technology Campus",
  "Tech Building D": "Industrial Technology Campus",
  "Tech Building T": "Industrial Technology Campus",
  "Student Living F": "Student Living Center",
  "Student Living G": "Student Living Center",
  "Student Living H": "Student Living Center",
  "Student Living J": "Student Living Center",
  "Student Living R": "Student Living Center",
  "Student Living S": "Student Living Center",
  "Student Living T": "Student Living Center",
};

/** Keep service scopes out of endpoint-performance building lists. */
export function diagnosticsBuildingName(value: string | null | undefined): string | null {
  const name = value?.trim();
  if (!name || NON_PHYSICAL_DIAGNOSTICS_SCOPES.has(name)) return null;
  // Preserve detailed switch/topology labels, but aggregate endpoint and building
  // reporting into the physical sites that people recognize.
  return AGGREGATED_DIAGNOSTICS_BUILDINGS[name] ?? name;
}
