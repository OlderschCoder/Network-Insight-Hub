import { describe, expect, it } from "vitest";
import {
  missingWeeklyLogSubmissions,
  resolvedTicketCount,
  weeklyLogSubmissionLabel,
} from "./weekly_report_overview";

describe("weekly report overview", () => {
  it("uses the direct group-wide Zendesk count", () => {
    expect(resolvedTicketCount({ count: 61, tickets: new Array(61) })).toBe(61);
  });

  it("does not turn an unavailable Zendesk result into a misleading zero", () => {
    expect(resolvedTicketCount(undefined)).toBeNull();
    expect(
      resolvedTicketCount({ configured: false, count: 0, tickets: [] }),
    ).toBeNull();
  });

  it("keeps a CIO with no weekly log in the visible missing list", () => {
    const missing = missingWeeklyLogSubmissions([
      {
        userId: 1,
        userName: "Tracy Example",
        userRole: "cio",
        entryCount: 0,
        isSubmitted: false,
      },
      {
        userId: 2,
        userName: "Mark Example",
        userRole: "cio",
        entryCount: 1,
        isSubmitted: true,
      },
    ]);

    expect(missing.map((submission) => submission.userName)).toEqual([
      "Tracy Example",
    ]);
    expect(weeklyLogSubmissionLabel(missing[0])).toBe("No weekly log");
  });
});
