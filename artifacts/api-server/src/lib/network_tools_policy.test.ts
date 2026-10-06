import { describe, expect, it } from "vitest";
import { canUseNetworkTools } from "./network_tools_policy";

describe("canUseNetworkTools", () => {
  it("keeps existing network administrator roles authorized", () => {
    expect(canUseNetworkTools({ role: "cio" })).toBe(true);
    expect(canUseNetworkTools({ role: "network" })).toBe(true);
    expect(canUseNetworkTools({ role: "network_engineer" })).toBe(true);
  });

  it("allows a scoped staff grant without changing the user's role", () => {
    expect(
      canUseNetworkTools({ role: "helpdesk", canUseNetworkTools: true }),
    ).toBe(true);
  });

  it("denies ordinary staff without the scoped grant", () => {
    expect(
      canUseNetworkTools({ role: "helpdesk", canUseNetworkTools: false }),
    ).toBe(false);
    expect(canUseNetworkTools(undefined)).toBe(false);
  });
});
