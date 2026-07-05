import { describe, expect, it } from "vitest";

import {
  flagVmRisks,
  isRetiringSize,
  summarizeVmRisks,
  type VmRiskInput,
} from "./azure_risk";

// Pure module — no DB or network. Runs under the same vitest setup as the
// sync/DB coverage, but nothing here touches Postgres.

describe("flagVmRisks", () => {
  it("flags a public IP as high severity", () => {
    const flags = flagVmRisks({ status: "running", publicIp: "20.1.2.3" });
    expect(flags).toHaveLength(1);
    expect(flags[0].code).toBe("public_ip");
    expect(flags[0].severity).toBe("high");
    expect(flags[0].detail).toContain("20.1.2.3");
  });

  it("treats a blank/whitespace public IP as no exposure", () => {
    expect(flagVmRisks({ status: "running", publicIp: "" })).toHaveLength(0);
    expect(flagVmRisks({ status: "running", publicIp: "   " })).toHaveLength(0);
    expect(flagVmRisks({ status: "running", publicIp: null })).toHaveLength(0);
  });

  it("flags a non-healthy status as medium severity", () => {
    const flags = flagVmRisks({ status: "unknown" });
    expect(flags).toHaveLength(1);
    expect(flags[0].code).toBe("unhealthy");
    expect(flags[0].severity).toBe("medium");
    expect(flags[0].detail).toContain("unknown");
  });

  it("is case-insensitive when checking status health", () => {
    expect(flagVmRisks({ status: "RUNNING" })).toHaveLength(0);
    expect(flagVmRisks({ status: "Stopped" })).toHaveLength(0);
    expect(flagVmRisks({ status: "DEALLOCATED" })).toHaveLength(0);
  });

  it("does not flag health when status is empty/absent", () => {
    expect(flagVmRisks({ status: "" })).toHaveLength(0);
    expect(flagVmRisks({})).toHaveLength(0);
    expect(flagVmRisks({ status: null })).toHaveLength(0);
  });

  it.each([
    "running",
    "stopped",
    "deallocated",
  ])("does not flag a healthy '%s' VM with no other risks", (status) => {
    expect(flagVmRisks({ status, size: "Standard_D2s_v3", publicIp: null })).toHaveLength(0);
  });

  it.each([
    "Basic_A0",
    "Basic_A4",
    "Standard_A0",
    "Standard_A7",
    "standard_a3",
    "Standard_A5_v1",
  ])("flags retiring size '%s' as medium severity", (size) => {
    const flags = flagVmRisks({ status: "running", size });
    expect(flags).toHaveLength(1);
    expect(flags[0].code).toBe("retiring_size");
    expect(flags[0].severity).toBe("medium");
    expect(flags[0].detail).toContain(size);
  });

  it.each([
    "Standard_A8",
    "Standard_A0_v2",
    "Standard_D2s_v3",
    "Standard_A10",
    "Standard_B1s",
  ])("does not flag supported size '%s'", (size) => {
    expect(flagVmRisks({ status: "running", size })).toHaveLength(0);
  });

  it("never flags a deleted VM even when it has other risk signals", () => {
    const flags = flagVmRisks({
      status: "deleted",
      publicIp: "20.1.2.3",
      size: "Standard_A0",
    });
    expect(flags).toHaveLength(0);
  });

  it("is case-insensitive about the deleted short-circuit", () => {
    expect(
      flagVmRisks({ status: "DELETED", publicIp: "20.1.2.3", size: "Standard_A0" }),
    ).toHaveLength(0);
  });

  it("returns multiple flags when several rules match", () => {
    const flags = flagVmRisks({
      status: "unknown",
      publicIp: "20.1.2.3",
      size: "Standard_A0",
    });
    const codes = flags.map((f) => f.code).sort();
    expect(codes).toEqual(["public_ip", "retiring_size", "unhealthy"]);
  });
});

describe("isRetiringSize", () => {
  it("returns false for empty/nullish sizes", () => {
    expect(isRetiringSize(null)).toBe(false);
    expect(isRetiringSize(undefined)).toBe(false);
    expect(isRetiringSize("")).toBe(false);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(isRetiringSize("  Standard_A1  ")).toBe(true);
  });
});

describe("summarizeVmRisks", () => {
  it("counts flags per code and per severity across VMs", () => {
    const vms: (VmRiskInput & { id: number; name: string })[] = [
      { id: 1, name: "vm-public", status: "running", publicIp: "20.0.0.1" },
      { id: 2, name: "vm-unhealthy", status: "unknown" },
      { id: 3, name: "vm-retiring", status: "running", size: "Standard_A0" },
      { id: 4, name: "vm-healthy", status: "running", size: "Standard_D2s_v3" },
      { id: 5, name: "vm-deleted", status: "deleted", publicIp: "20.0.0.9" },
    ];

    const { items, summary } = summarizeVmRisks(vms);

    // Only the three flagged VMs appear (healthy + deleted excluded).
    expect(items).toHaveLength(3);
    expect(summary.flaggedVms).toBe(3);
    expect(summary.publicIp).toBe(1);
    expect(summary.unhealthy).toBe(1);
    expect(summary.retiringSize).toBe(1);
    expect(summary.high).toBe(1);
    expect(summary.medium).toBe(2);
    expect(summary.low).toBe(0);
  });

  it("counts every flag on a VM that trips multiple rules", () => {
    const { items, summary } = summarizeVmRisks([
      { id: 1, name: "vm-multi", status: "unknown", publicIp: "20.0.0.1", size: "Standard_A0" },
    ]);

    expect(items).toHaveLength(1);
    expect(summary.flaggedVms).toBe(1);
    expect(summary.publicIp).toBe(1);
    expect(summary.unhealthy).toBe(1);
    expect(summary.retiringSize).toBe(1);
    expect(summary.high).toBe(1);
    expect(summary.medium).toBe(2);
  });

  it("orders highest-severity VMs first, then by name", () => {
    const vms: (VmRiskInput & { id: number; name: string })[] = [
      { id: 1, name: "zeta-medium", status: "unknown" },
      { id: 2, name: "alpha-high", status: "running", publicIp: "20.0.0.1" },
      { id: 3, name: "beta-medium", status: "running", size: "Standard_A0" },
    ];

    const { items } = summarizeVmRisks(vms);
    expect(items.map((i) => i.name)).toEqual([
      "alpha-high", // high severity first
      "beta-medium", // then mediums alphabetically
      "zeta-medium",
    ]);
  });

  it("returns empty items/zeroed summary when nothing is flagged", () => {
    const { items, summary } = summarizeVmRisks([
      { id: 1, name: "vm-healthy", status: "running", size: "Standard_D2s_v3" },
      { id: 2, name: "vm-deleted", status: "deleted", publicIp: "20.0.0.9" },
    ]);

    expect(items).toEqual([]);
    expect(summary).toEqual({
      publicIp: 0,
      unhealthy: 0,
      retiringSize: 0,
      flaggedVms: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
  });

  it("preserves resourceGroup/status/size/publicIp on emitted items", () => {
    const { items } = summarizeVmRisks([
      {
        id: 7,
        name: "vm-detail",
        resourceGroup: "rg-prod",
        status: "running",
        size: "Standard_A0",
        publicIp: "20.0.0.7",
      },
    ]);

    expect(items[0]).toMatchObject({
      id: 7,
      name: "vm-detail",
      resourceGroup: "rg-prod",
      status: "running",
      size: "Standard_A0",
      publicIp: "20.0.0.7",
    });
  });
});
