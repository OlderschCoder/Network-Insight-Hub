import { describe, expect, it } from "vitest";
import {
  zendeskSolvedTicketQuery,
  zendeskSolvedWindow,
} from "./zendesk_solved_window";

describe("Zendesk solved-ticket reporting windows", () => {
  it("builds a seven-day half-open window for a weekly log", () => {
    expect(zendeskSolvedWindow("2026-09-14", "2026-09-07")).toEqual({
      start: "2026-09-07",
      endExclusive: "2026-09-14",
    });
  });

  it("builds a one-day half-open window for a daily lookup", () => {
    expect(zendeskSolvedWindow("2026-09-14")).toEqual({
      start: "2026-09-14",
      endExclusive: "2026-09-15",
    });
  });

  it("handles month and leap-year boundaries", () => {
    expect(zendeskSolvedWindow("2028-02-26", "2028-02-26")).toEqual({
      start: "2028-02-26",
      endExclusive: "2028-03-04",
    });
  });

  it("rejects an impossible calendar date", () => {
    expect(() => zendeskSolvedWindow("2026-02-30")).toThrow(
      "Invalid calendar date",
    );
  });

  it("generates a bounded Zendesk solved-at query", () => {
    expect(
      zendeskSolvedTicketQuery(
        "Onsite_it",
        zendeskSolvedWindow("2026-09-07", "2026-09-07"),
      ),
    ).toBe(
      'type:ticket solved>=2026-09-07 solved<2026-09-14 group:"Onsite_it"',
    );
  });
});
