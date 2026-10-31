import { describe, expect, it } from "vitest";
import { isFredCodingRequest } from "./fred_coding_request";
describe("Fred coding request routing", () => {
  it("recognizes site corrections even when they mention network evidence", () => {
    expect(isFredCodingRequest("Fix the Buildings page health calculation; phones are up", "cio")).toBe(true);
    expect(isFredCodingRequest("Use develop_website to implement the fix", "cio")).toBe(true);
    expect(isFredCodingRequest("Update the campus map", "cio")).toBe(true);
  });
  it("does not expand staff permissions or route ordinary status questions to coding", () => {
    expect(isFredCodingRequest("Use develop_website", "staff")).toBe(false);
    expect(isFredCodingRequest("Are the campus phones down?", "cio")).toBe(false);
    expect(isFredCodingRequest("Update my weekly log", "cio")).toBe(false);
  });
});
