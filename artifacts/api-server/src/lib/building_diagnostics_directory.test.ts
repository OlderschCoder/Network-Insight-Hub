import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
import { mergeDirectoryFacts, type Inventory } from "./building_diagnostics_store";

const now = Date.parse("2026-10-27T12:00:00Z"), original = "2026-10-27T10:00:00Z", newer = "2026-10-27T11:00:00Z";
const computer = { adObjectGuid: "22c1e90c-a186-4110-93c0-f517130430fe", computerName: "SYNTHETIC", domain: "sccc.edu", enabled: true };
const directory = { distinguishedName: "CN=Synthetic,OU=Library,DC=sccc,DC=edu", canonicalName: "sccc.edu/Library/Synthetic", location: null, memberOf: [], organizationalUnits: [] };
const previous: Inventory = { adObservedAt: original, adComputers: [{ ...computer, directory }], observations: [], userBuildingAssignments: [] };
describe("independently aged directory classification metadata", () => {
  it("retains omitted facts across a newer legacy roster with their original timestamp", () => {
    expect(mergeDirectoryFacts({ adObservedAt: newer, adComputers: [computer] }, previous, now)[0].directory).toEqual({ ...directory, observedAt: original });
  });
  it("does not renew facts on repeated legacy posts or collector GET/POST roundtrips", () => {
    const first = mergeDirectoryFacts({ adObservedAt: newer, adComputers: [computer] }, previous, now);
    const current = { ...previous, adObservedAt: newer, adComputers: first };
    for (const rows of [first, [computer]]) expect(mergeDirectoryFacts({ adObservedAt: "2026-10-27T11:30:00Z", adComputers: rows }, current, now)[0].directory?.observedAt).toBe(original);
  });
  it("drops retained facts when GUID, name, domain or enabled state changes", () => {
    for (const changed of [{ ...computer, adObjectGuid: "7755c8a8-a992-48e4-96d9-3109a826cbdb" }, { ...computer, computerName: "RENAMED" }, { ...computer, domain: "other.edu" }, { ...computer, enabled: false }]) expect(mergeDirectoryFacts({ adObservedAt: newer, adComputers: [changed] }, previous, now)[0].directory).toBeUndefined();
  });
  it("drops expired or future facts without resetting their age", () => {
    for (const observedAt of ["2026-10-26T10:00:00Z", "2026-10-27T12:01:00Z"]) {
      const old = { ...previous, adComputers: [{ ...computer, directory: { ...directory, observedAt } }] };
      expect(mergeDirectoryFacts({ adObservedAt: newer, adComputers: [computer] }, old, now)[0].directory).toBeUndefined();
      expect(mergeDirectoryFacts({ adObservedAt: newer, adComputers: old.adComputers }, previous, now)[0].directory).toBeUndefined();
    }
  });
  it("stamps freshly supplied facts once at the actual incoming AD observation", () => {
    expect(mergeDirectoryFacts({ adObservedAt: newer, adComputers: [{ ...computer, directory }] }, previous, now)[0].directory?.observedAt).toBe(newer);
    const supplied = { ...directory, observedAt: original };
    expect(mergeDirectoryFacts({ adObservedAt: newer, adComputers: [{ ...computer, directory: supplied }] }, previous, now)[0].directory?.observedAt).toBe(original);
  });
});
