import { describe, expect, it } from "vitest";
import {
  isZendeskDashboardTeamMember,
  zendeskDashboardTeamOrder,
} from "./zendesk_dashboard_team";

describe("Zendesk dashboard roster", () => {
  it("includes only the six active named team members", () => {
    for (const name of ["Tracy Smith", "Mark Bojeun", "Maria Jones", "Lucas Brown", "Illia Green", "Craig White"]) {
      expect(isZendeskDashboardTeamMember({ name, isActive: true })).toBe(true);
    }
    expect(isZendeskDashboardTeamMember({ name: "Another Agent", isActive: true })).toBe(false);
    expect(isZendeskDashboardTeamMember({ name: "Cecil Stoll", isActive: true })).toBe(false);
    expect(isZendeskDashboardTeamMember({ name: "Tracy Smith", isActive: false })).toBe(false);
  });

  it("keeps the requested roster order stable", () => {
    const names = ["Craig White", "Maria Jones", "Tracy Smith"];
    expect(names.sort((a, b) => zendeskDashboardTeamOrder(a) - zendeskDashboardTeamOrder(b))).toEqual([
      "Tracy Smith",
      "Maria Jones",
      "Craig White",
    ]);
  });
});
