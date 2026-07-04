/**
 * Pure risk-flagging for Azure VM inventory metadata.
 *
 * These heuristics are computed from the fields we already store per VM (no
 * extra Azure API calls), so they can run both server-side (report exports,
 * risk endpoint) and be surfaced in the UI. Keep this module free of DB/HTTP
 * so it stays trivially testable and reusable.
 */

export type VmRiskSeverity = "high" | "medium" | "low";

export type VmRiskFlag = {
  code: "public_ip" | "unhealthy" | "retiring_size";
  severity: VmRiskSeverity;
  label: string;
  detail: string;
};

/** Minimal VM shape the risk rules read. Compatible with the azure_vms row. */
export type VmRiskInput = {
  name?: string | null;
  status?: string | null;
  size?: string | null;
  publicIp?: string | null;
  source?: string | null;
};

// Azure power/health states we consider "known good". Anything else (notably
// "unknown", which our sync writes when no PowerState is returned) is flagged.
const HEALTHY_STATES = new Set(["running", "stopped", "deallocated"]);

/**
 * VM sizes Azure has announced for retirement. Grounded in the original
 * A-series (Standard_A0–A7) and Basic tier retirements. Matching is
 * case-insensitive and anchored so e.g. Standard_A8+ (still supported) and the
 * modern Av2 series are NOT flagged.
 *
 * NOTE (interpretation): the task asks for "disk retirement notices". Azure
 * disk/scheduled-event retirement data is not fetched by this app, so we flag
 * the closest signal available from stored metadata — deprecated VM sizes that
 * Azure is retiring. Documented as a deviation.
 */
const RETIRING_SIZE_PATTERNS: RegExp[] = [
  /^basic_a\d+$/i, // Basic_A0..Basic_A4 (Basic tier retiring)
  /^standard_a[0-7]$/i, // original A-series Standard_A0..A7
  /^standard_a[0-7]_v1$/i,
];

export function isRetiringSize(size: string | null | undefined): boolean {
  if (!size) return false;
  const s = size.trim();
  return RETIRING_SIZE_PATTERNS.some((re) => re.test(s));
}

/**
 * Returns the risk flags for a single VM. Empty array = no flags.
 * "deleted" rows (removed from Azure but kept for history) are never flagged.
 */
export function flagVmRisks(vm: VmRiskInput): VmRiskFlag[] {
  const flags: VmRiskFlag[] = [];
  const status = (vm.status ?? "").toLowerCase();
  if (status === "deleted") return flags;

  if (vm.publicIp && vm.publicIp.trim().length > 0) {
    flags.push({
      code: "public_ip",
      severity: "high",
      label: "Public IP exposure",
      detail: `Reachable from the internet via ${vm.publicIp}. Confirm NSG rules and that public exposure is intended.`,
    });
  }

  if (status && !HEALTHY_STATES.has(status)) {
    flags.push({
      code: "unhealthy",
      severity: "medium",
      label: "Unhealthy state",
      detail: `Power state is "${vm.status}" (expected running, stopped, or deallocated). Investigate the VM's health.`,
    });
  }

  if (isRetiringSize(vm.size)) {
    flags.push({
      code: "retiring_size",
      severity: "medium",
      label: "Retiring VM series",
      detail: `Size "${vm.size}" is on a VM series Azure is retiring. Plan a resize to a supported series before end of life.`,
    });
  }

  return flags;
}

export type VmRiskItem = {
  id: number;
  name: string;
  resourceGroup: string | null;
  status: string;
  size: string | null;
  publicIp: string | null;
  flags: VmRiskFlag[];
};

export type VmRiskSummary = {
  publicIp: number;
  unhealthy: number;
  retiringSize: number;
  flaggedVms: number;
  high: number;
  medium: number;
  low: number;
};

/** Aggregates flags across a set of VMs into a summary + per-VM flagged list. */
export function summarizeVmRisks(
  vms: (VmRiskInput & { id: number; name: string; resourceGroup?: string | null })[],
): { items: VmRiskItem[]; summary: VmRiskSummary } {
  const items: VmRiskItem[] = [];
  const summary: VmRiskSummary = {
    publicIp: 0,
    unhealthy: 0,
    retiringSize: 0,
    flaggedVms: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const vm of vms) {
    const flags = flagVmRisks(vm);
    if (flags.length === 0) continue;
    summary.flaggedVms++;
    for (const f of flags) {
      if (f.code === "public_ip") summary.publicIp++;
      if (f.code === "unhealthy") summary.unhealthy++;
      if (f.code === "retiring_size") summary.retiringSize++;
      summary[f.severity]++;
    }
    items.push({
      id: vm.id,
      name: vm.name,
      resourceGroup: vm.resourceGroup ?? null,
      status: vm.status ?? "",
      size: vm.size ?? null,
      publicIp: vm.publicIp ?? null,
      flags,
    });
  }
  // Highest-severity VMs first, then by name for stable ordering.
  const rank = (i: VmRiskItem) =>
    i.flags.some((f) => f.severity === "high") ? 0 : i.flags.some((f) => f.severity === "medium") ? 1 : 2;
  items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { items, summary };
}
