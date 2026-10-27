import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
import { resolveEnrollmentSelection } from "./building_diagnostics_enrollment";
const id = randomUUID(), other = randomUUID();
const inventory = { adObservedAt: new Date().toISOString(), adComputers: [{ adObjectGuid: id, computerName: "PC-1", domain: "sccc.edu", enabled: true }, { adObjectGuid: other, computerName: "PC-DISABLED", domain: "sccc.edu", enabled: false }], observations: [], userBuildingAssignments: [] };
describe("bulk enrollment directory selection", () => {
  it("resolves identities from the authoritative roster rather than caller names", () => expect(resolveEnrollmentSelection(inventory, [id.toUpperCase()])).toEqual([inventory.adComputers[0]]));
  it("rejects disabled, unknown, stale, future and duplicate identity selections", () => {
    for (const selected of [[other], [randomUUID()], [id, id.toUpperCase()]]) expect(() => resolveEnrollmentSelection(inventory, selected)).toThrow();
    for (const adObservedAt of [new Date(Date.now() - 25 * 3600_000).toISOString(), new Date(Date.now() + 60_000).toISOString()]) expect(() => resolveEnrollmentSelection({ ...inventory, adObservedAt }, [id])).toThrow();
  });
});
