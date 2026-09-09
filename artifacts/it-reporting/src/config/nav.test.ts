import { describe, expect, it } from "vitest";
import {
  getPortalModeLinks,
  portalModeForPath,
  type PortalMode,
} from "../components/portal-ui";
import { getNavGroups } from "./nav";

describe("primary navigation", () => {
  it("keeps IT Apps as a first-class sidebar destination", () => {
    const groups = getNavGroups(true, true);
    expect(groups.map((group) => [group.label, group.href])).toEqual([
      ["Status & Reporting", "/status"],
      ["Campus Technology", "/network/buildings"],
      ["Troubleshooting", "/support"],
      ["My Work", "/todos"],
      ["IT Apps", "/it-apps"],
      ["Administration", "/projects"],
    ]);
    expect(groups[4].items.map((item) => [item.label, item.href])).toEqual([
      ["App Directory", "/it-apps"],
      ["Banner", "/banner"],
      ["High School Students", "/student-access"],
    ]);
    expect(groups[2].items.map((item) => [item.label, item.href])).toEqual(
      expect.arrayContaining([
        ["Quick Start", "/quick-start"],
        ["Zendesk Monitor", "/support/zendesk"],
      ]),
    );
  });

  it("does not duplicate destinations in the sidebar", () => {
    const groups = getNavGroups(true, true);
    const hrefs = groups.flatMap((group) =>
      group.items.map((item) => item.href),
    );
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it.each<PortalMode>(["status", "network", "apps", "support"])(
    "keeps Apps visible in the %s workspace switcher",
    (mode) => {
      expect(
        getPortalModeLinks(mode).map((item) => [item.label, item.href]),
      ).toContainEqual(["Apps", "/it-apps"]);
    },
  );

  it.each([
    ["/it-apps", "apps"],
    ["/it-apps/cisco-calling", "apps"],
    ["/banner", "apps"],
    ["/student-access", "apps"],
    ["/password-reset-activity", "apps"],
    ["/mfa-tap-activity", "apps"],
    ["/acr/analytics/", "apps"],
    ["/online-kiosk", "apps"],
  ] as const)("classifies %s as the Apps workspace", (path, expected) => {
    expect(portalModeForPath(path)).toBe(expected);
  });

  it.each([
    "/support",
    "/support/zendesk",
    "/incidents/42",
    "/learn",
    "/processes",
    "/quick-start",
    "/user-guide",
    "/risks",
    "/after-action/42",
  ])("classifies %s as the Troubleshooting workspace", (path) => {
    expect(portalModeForPath(path)).toBe("support");
  });
});
