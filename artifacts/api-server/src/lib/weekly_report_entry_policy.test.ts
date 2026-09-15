import { describe, expect, it } from "vitest";
import {
  WEEKLY_LOG_SUBMISSION_CUTOVER_AT,
  includedWeeklyLogOwnerWeeks,
  includedWeeklyLogUserIds,
  includedWeeklyLogs,
  isWeeklyLogIncludedInDepartmentReport,
  selectedItemsForIncludedWeeklyLogs,
  weeklyLogSubmissionStatus,
  weeklyLogOwnerWeekKey,
} from "./weekly_report_entry_policy";

describe("department weekly-report entry policy", () => {
  it("includes explicit submissions regardless of update time", () => {
    expect(
      isWeeklyLogIncludedInDepartmentReport({
        isSubmitted: true,
        updatedAt: "2026-10-01T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("grandfathers an untouched legacy weekly log", () => {
    expect(
      isWeeklyLogIncludedInDepartmentReport({
        isSubmitted: false,
        updatedAt: new Date("2026-09-14T17:29:59.999Z"),
      }),
    ).toBe(true);
  });

  it("excludes a draft saved at or after the cutover", () => {
    expect(
      isWeeklyLogIncludedInDepartmentReport({
        isSubmitted: false,
        updatedAt: WEEKLY_LOG_SUBMISSION_CUTOVER_AT,
      }),
    ).toBe(false);
  });

  it("treats Return to Draft as ineligible once the write refreshes updatedAt", () => {
    const legacyLog = {
      isSubmitted: false,
      updatedAt: "2026-09-01T12:00:00.000Z",
    };
    expect(isWeeklyLogIncludedInDepartmentReport(legacyLog)).toBe(true);

    const returnedToDraft = {
      ...legacyLog,
      isSubmitted: false,
      updatedAt: "2026-09-14T17:30:00.001Z",
    };
    expect(isWeeklyLogIncludedInDepartmentReport(returnedToDraft)).toBe(false);
  });

  it("fails closed when an unsubmitted row has no valid update time", () => {
    expect(
      isWeeklyLogIncludedInDepartmentReport({
        isSubmitted: false,
        updatedAt: null,
      }),
    ).toBe(false);
    expect(
      isWeeklyLogIncludedInDepartmentReport({
        isSubmitted: false,
        updatedAt: "not-a-date",
      }),
    ).toBe(false);
  });

  it("filters mixed legacy, submitted, and draft rows with the same policy", () => {
    const entries = includedWeeklyLogs([
      { id: 1, isSubmitted: false, updatedAt: "2026-09-01T12:00:00Z" },
      { id: 2, isSubmitted: false, updatedAt: "2026-09-15T12:00:00Z" },
      { id: 3, isSubmitted: true, updatedAt: "2026-09-15T12:00:00Z" },
    ]);

    expect(entries.map((entry) => entry.id)).toEqual([1, 3]);
  });

  it("never lets a saved item selection re-include a draft user's work", () => {
    const eligibleUserIds = includedWeeklyLogUserIds([
      { userId: 10, isSubmitted: true, updatedAt: "2026-09-15T12:00:00Z" },
      { userId: 20, isSubmitted: false, updatedAt: "2026-09-15T12:00:00Z" },
    ]);
    const items = [
      { id: 101, userId: 10, title: "eligible" },
      { id: 202, userId: 20, title: "draft user" },
    ];

    expect(
      selectedItemsForIncludedWeeklyLogs(items, eligibleUserIds, [101, 202]),
    ).toEqual([{ id: 101, userId: 10, title: "eligible" }]);
  });

  it("keeps multi-week eligibility scoped to both owner and week", () => {
    const eligibleOwnerWeeks = includedWeeklyLogOwnerWeeks([
      {
        userId: 10,
        weekOf: "2026-09-07",
        isSubmitted: true,
        updatedAt: "2026-09-15T12:00:00Z",
      },
      {
        userId: 10,
        weekOf: "2026-09-14",
        isSubmitted: false,
        updatedAt: "2026-09-15T12:00:00Z",
      },
    ]);

    expect(
      eligibleOwnerWeeks.has(weeklyLogOwnerWeekKey(10, "2026-09-07")),
    ).toBe(true);
    expect(
      eligibleOwnerWeeks.has(weeklyLogOwnerWeekKey(10, "2026-09-14")),
    ).toBe(false);
  });

  it("keeps active teammates with no weekly log visible as missing", () => {
    const status = weeklyLogSubmissionStatus(
      [
        { id: 1, name: "Tracy Example", role: "cio" },
        { id: 2, name: "Mark Example", role: "cio" },
        { id: 3, name: "Maria Example", role: "helpdesk" },
      ],
      [
        {
          userId: 2,
          isSubmitted: true,
          updatedAt: "2026-09-15T12:00:00Z",
        },
        {
          userId: 3,
          isSubmitted: false,
          updatedAt: "2026-09-15T12:00:00Z",
        },
      ],
    );

    expect(status).toEqual([
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
      {
        userId: 3,
        userName: "Maria Example",
        userRole: "helpdesk",
        entryCount: 1,
        isSubmitted: false,
      },
    ]);
  });
});
