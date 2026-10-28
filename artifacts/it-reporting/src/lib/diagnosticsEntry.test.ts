import { describe, expect, it } from "vitest";
import { diagnosticGuid, diagnosticIneligibility, diagnosticsSsoNavigation, diagnosticsSsoTarget } from "./diagnosticsEntry";

describe("sender performance entry", () => {
  it("only starts automatic SSO for the explicit internal diagnostics route", () => {
    expect(diagnosticsSsoTarget("/network/diagnostics?sso=1&adObjectGuid=fixture")).toBe("/network/diagnostics?sso=1&adObjectGuid=fixture");
    for (const value of ["//evil.invalid/network/diagnostics?sso=1", "https://evil.invalid/network/diagnostics?sso=1", "/network/diagnostics", "/network/tools?sso=1", "/\\evil.invalid/network/diagnostics?sso=1"]) expect(diagnosticsSsoTarget(value)).toBeNull();
  });
  it("rejects missing, malformed and empty AD locators", () => {
    expect(diagnosticGuid("ABCDEF01-2345-6789-ABCD-0123456789AB")).toBe("abcdef01-2345-6789-abcd-0123456789ab");
    for (const value of [null, "reported-name", "00000000-0000-0000-0000-000000000000", "https://evil.invalid"]) expect(diagnosticGuid(value)).toBeNull();
  });
  it("moves only a validated diagnostics target to the configured callback origin before starting OIDC", () => {
    const target = "/network/diagnostics?sso=1&adObjectGuid=30000000-0000-4000-8000-000000000001";
    const canonical = "https://app-server2.centralus.cloudapp.azure.com";
    expect(diagnosticsSsoNavigation(target, canonical, "https://insights.sccc.edu")).toBe(`${canonical}${target}`);
    expect(diagnosticsSsoNavigation(target, canonical, canonical)).toBe("/api/auth/entra/login");
    for (const origin of [undefined, null, "http://canonical.invalid", "https://user:pass@canonical.invalid", "https://canonical.invalid/other", "https://canonical.invalid?next=https://evil.invalid", "https://canonical.invalid#fragment"]) expect(() => diagnosticsSsoNavigation(target, origin, canonical)).toThrow();
    expect(() => diagnosticsSsoNavigation("//evil.invalid/network/diagnostics?sso=1", canonical, canonical)).toThrow();
  });
  it("explains why a device cannot be measured instead of implying that enrollment means online", () => {
    const device = { deviceId: "diagnostics-id", enrolled: true, online: true, adVerified: true, capabilities: ["external-probe-v2"] };
    expect(diagnosticIneligibility(device, "external-quick")).toBeNull();
    expect(diagnosticIneligibility({ ...device, revoked: true }, "fred")).toMatch(/revoked/);
    expect(diagnosticIneligibility({ ...device, adVerified: false }, "fred")).toMatch(/AD verification/);
    expect(diagnosticIneligibility({ ...device, enrolled: false }, "fred")).toMatch(/not enrolled/);
    expect(diagnosticIneligibility({ ...device, online: false }, "fred")).toMatch(/check-in/);
    expect(diagnosticIneligibility({ ...device, capabilities: [] }, "external-quick")).toMatch(/Update/);
    expect(diagnosticIneligibility({ ...device, capabilities: [] }, "librespeed-v2")).toMatch(/LibreSpeed/);
    expect(diagnosticIneligibility({ ...device, capabilities: ["librespeed-v2"] }, "librespeed-v2")).toBeNull();
    expect(diagnosticIneligibility({ ...device, capabilities: [] }, "fred")).toBeNull();
  });
});
