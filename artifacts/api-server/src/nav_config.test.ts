import { describe, expect, it } from "vitest";
import { getNavGroups } from "../../it-reporting/src/config/nav";

describe("primary navigation", () => {
  it("puts the campus operational journey first and in the approved order", () => {
    const groups = getNavGroups(true, true);
    expect(groups[0].label).toBe("Campus Operations");
    expect(groups[0].items.map((item) => item.label)).toEqual([
      "Status",
      "Buildings",
      "Network Map",
      "Monitoring",
      "Cisco Webex Phones",
      "Azure",
    ]);
  });

  it("does not duplicate campus destinations in lower menu groups", () => {
    const groups = getNavGroups(true, true);
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
