import { describe, expect, it } from "vitest";
import { canUseNetworkTools } from "./networkToolsAccess";

describe("canUseNetworkTools", () => {
  it("allows existing network roles and scoped staff", () => {
    expect(canUseNetworkTools({ role: "network_engineer" })).toBe(true);
    expect(
      canUseNetworkTools({ role: "helpdesk", canUseNetworkTools: true }),
    ).toBe(true);
  });

  it("denies staff without the scoped permission", () => {
    expect(canUseNetworkTools({ role: "helpdesk" })).toBe(false);
  });
});
