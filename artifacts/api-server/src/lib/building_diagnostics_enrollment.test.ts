import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
import { normalizeEnrollmentRequestIds, resolveEnrollmentSelection } from "./building_diagnostics_enrollment";
const id = randomUUID(), other = randomUUID();
const inventory = { adObservedAt: new Date().toISOString(), adComputers: [{ adObjectGuid: id, computerName: "PC-1", domain: "sccc.edu", enabled: true }, { adObjectGuid: other, computerName: "PC-DISABLED", domain: "sccc.edu", enabled: false }], observations: [], userBuildingAssignments: [] };
describe("bulk enrollment directory selection", () => {
  it("resolves identities from the authoritative roster rather than caller names", () => expect(resolveEnrollmentSelection(inventory, [id.toUpperCase()])).toEqual([inventory.adComputers[0]]));
  it("rejects disabled, unknown, stale, future and duplicate identity selections", () => {
    for (const selected of [[other], [randomUUID()], [id, id.toUpperCase()]]) expect(() => resolveEnrollmentSelection(inventory, selected)).toThrow();
    for (const adObservedAt of [new Date(Date.now() - 25 * 3600_000).toISOString(), new Date(Date.now() + 60_000).toISOString()]) expect(() => resolveEnrollmentSelection({ ...inventory, adObservedAt }, [id])).toThrow();
  });
});
describe("bulk claim request filter", () => {
  it("keeps omitted filtering and deduplicates explicitly selected request UUIDs", () => {
    expect(normalizeEnrollmentRequestIds()).toBeUndefined();
    expect(normalizeEnrollmentRequestIds([id.toUpperCase(), id, other])).toEqual([id, other]);
  });
  it("rejects empty, malformed and oversized filters rather than broadening to every request", () => {
    for (const input of [[], ["bad-guid"], Array(17).fill(id), null, id] as any[]) expect(() => normalizeEnrollmentRequestIds(input)).toThrow();
  });
});
