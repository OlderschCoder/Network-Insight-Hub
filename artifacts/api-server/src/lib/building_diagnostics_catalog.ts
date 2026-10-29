const NON_PHYSICAL_DIAGNOSTICS_SCOPES = new Set([
  "Azure (Hybrid-VNet)",
  "Azure Connectivity (Objects)",
  "Business",
  "Campus Wide",
  "Maintenance",
]);

/** Keep service scopes out of endpoint-performance building lists. */
export function diagnosticsBuildingName(value: string | null | undefined): string | null {
  const name = value?.trim();
  if (!name || NON_PHYSICAL_DIAGNOSTICS_SCOPES.has(name)) return null;
  // Adult Education left the former Epworth site; endpoint reporting follows
  // the current Industrial Technology location while topology history remains intact.
  if (name === "Epworth ALC") return "Industrial Technology Campus";
  if (name === "Technology B") return "Tech Building B";
  return name;
}
