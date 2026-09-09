import { describe, expect, it } from "vitest";
import { QUICK_START_NAVIGATION_COPY, QUICK_START_WORKSPACES } from "./index";

describe("Quick Start interface training", () => {
  it("teaches the four first-class workspaces in interface order", () => {
    expect(
      QUICK_START_WORKSPACES.map(({ label, href }) => [label, href]),
    ).toEqual([
      ["Status & Reporting", "/status"],
      ["Campus Technology", "/network"],
      ["IT Apps", "/it-apps"],
      ["Troubleshooting", "/support"],
    ]);
  });

  it("directs people to the workspace switcher and fixed sidebar", () => {
    expect(QUICK_START_NAVIGATION_COPY).toContain("workspace switcher");
    expect(QUICK_START_NAVIGATION_COPY).toContain("fixed sidebar");
  });
});
