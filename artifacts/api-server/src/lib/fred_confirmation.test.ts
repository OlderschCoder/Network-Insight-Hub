import { describe, expect, it } from "vitest";
import { deleteConfirmationMatches } from "./fred_confirmation";

describe("Fred delete confirmation", () => {
  it("accepts the exact standalone confirmation line case-insensitively", () => {
    expect(deleteConfirmationMatches("confirm delete risk 42", "risk", 42)).toBe(true);
    expect(deleteConfirmationMatches("\n CONFIRM   DELETE switch SW-A144 \n", "switch", "SW-A144")).toBe(true);
  });

  it("rejects partial, wrong-target, and embedded confirmations", () => {
    expect(deleteConfirmationMatches("CONFIRM DELETE risk", "risk", 42)).toBe(false);
    expect(deleteConfirmationMatches("CONFIRM DELETE risk 43", "risk", 42)).toBe(false);
    expect(deleteConfirmationMatches("Please use CONFIRM DELETE risk 42", "risk", 42)).toBe(false);
    expect(deleteConfirmationMatches(undefined, "risk", 42)).toBe(false);
  });
});
