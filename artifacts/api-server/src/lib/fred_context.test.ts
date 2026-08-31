import { describe, expect, it } from "vitest";
import { boundFredMessages, FRED_MAX_RECENT_MESSAGES } from "./fred_context";

describe("Fred bounded conversation context", () => {
  it("keeps a short conversation intact", () => {
    expect(boundFredMessages([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("sends only the most recent messages", () => {
    const messages = Array.from({ length: 30 }, (_, index) => index + 1);
    const bounded = boundFredMessages(messages);
    expect(bounded).toHaveLength(FRED_MAX_RECENT_MESSAGES);
    expect(bounded[0]).toBe(19);
    expect(bounded.at(-1)).toBe(30);
  });
});
