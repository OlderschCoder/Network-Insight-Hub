import { describe, expect, it } from "vitest";
import { HOME_WORKSPACE_HREFS } from "./home-hub";

describe("Home workspace cards", () => {
  it("keeps Apps beside Status, Network, and Support", () => {
    expect(Object.entries(HOME_WORKSPACE_HREFS)).toEqual([
      ["status", "/status"],
      ["network", "/network"],
      ["apps", "/it-apps"],
      ["support", "/support"],
    ]);
  });
});
