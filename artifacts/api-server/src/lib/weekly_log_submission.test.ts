import { describe, expect, it } from "vitest";
import { explicitWeeklyLogSubmissionUpdate } from "./weekly_log_submission";

describe("weekly log submission upserts", () => {
  it("persists an explicit submit", () => {
    expect(explicitWeeklyLogSubmissionUpdate(true)).toEqual({
      isSubmitted: true,
    });
  });

  it("persists an explicit return to draft", () => {
    expect(explicitWeeklyLogSubmissionUpdate(false)).toEqual({
      isSubmitted: false,
    });
  });

  it("preserves the existing state for legacy callers", () => {
    expect(explicitWeeklyLogSubmissionUpdate(undefined)).toEqual({});
  });
});
