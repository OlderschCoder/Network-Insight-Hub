import { describe, expect, it } from "vitest";
import { getNavGroups } from "../../it-reporting/src/config/nav";

describe("primary navigation", () => {
  it("organizes the sidebar into linked category dropdowns", () => {
    const groups = getNavGroups(true, true);
    expect(groups.map((group) => [group.label, group.href])).toEqual([
      ["Status & Reporting", "/status"],
      ["Campus Technology", "/network/buildings"],
      ["Troubleshooting", "/support"],
      ["My Work", "/todos"],
      ["IT Apps", "/it-apps"],
      ["Administration", "/projects"],
    ]);
    expect(groups[1].items.map((item) => item.label)).toEqual([
      "Buildings",
      "Network Map",
      "Monitoring",
      "Cisco Webex Phones",
      "Azure",
      "Network Tools",
    ]);
  });

  it("does not duplicate campus destinations in lower menu groups", () => {
    const groups = getNavGroups(true, true);
    const hrefs = groups.flatMap((group) =>
      group.items.map((item) => item.href),
    );
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("separates outstanding to-dos from completed weekly-log work", () => {
    const groups = getNavGroups(true, true);
    expect(groups[3].items.map((item) => [item.label, item.href])).toEqual([
      ["To-do List", "/todos"],
      ["Completed Work", "/items"],
      ["Weekly Log", "/entries"],
    ]);
    expect(groups[4].items.map((item) => item.label)).toEqual([
      "App Directory",
      "Banner",
      "High School Students",
    ]);
    expect(
      groups
        .flatMap((group) => group.items)
        .filter((item) => item.href === "/student-access"),
    ).toHaveLength(1);
  });

  it("hides the administration category from non-CIO users", () => {
    expect(
      getNavGroups(false).some((group) => group.label === "Administration"),
    ).toBe(false);
  });
});
