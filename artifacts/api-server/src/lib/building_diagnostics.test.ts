import { describe, expect, it } from "vitest";
import { chooseCandidates, fresh, jobProof, newToken, normalizeMac, resolveLocation, secretsEqual, tokenHash, type Candidate, type Observation } from "./building_diagnostics";

const now = Date.parse("2026-10-25T12:00:00Z"), observedAt = new Date(now - 60_000).toISOString();
const machine = { interfaces: [{ mac: "AA-BB-CC-DD-EE-FF", ipAddresses: ["10.1.2.3"], kind: "ethernet" as const }], loggedOnUser: "SCCC\\person" };
const evidence: Observation = { mac: "aa:bb:cc:dd:ee:ff", building: "Science", switchName: "sw-science", port: "1/1/4", source: "switch", observedAt, edge: true };
describe("building diagnostics location evidence", () => {
  it("matches normalized MAC and records current access-edge evidence", () => {
    expect(normalizeMac(machine.interfaces[0].mac)).toBe("aabbccddeeff");
    expect(resolveLocation(machine, [evidence], [], now)).toEqual({ building: "Science", kind: "network-confirmed", source: "sw-science / 1/1/4", observedAt });
  });
  it("never uses uplink forwarding observations", () => {
    expect(resolveLocation(machine, [{ ...evidence, edge: false }], [], now).kind).toBe("unknown");
  });
  it("marks cross-building MAC ambiguity rather than choosing a guess", () => {
    expect(resolveLocation(machine, [evidence, { ...evidence, building: "Library" }], [], now)).toMatchObject({ kind: "ambiguous", building: null });
  });
  it("uses current Wi-Fi BSSID and rejects future or stale observations", () => {
    const wifi = { interfaces: [{ ...machine.interfaces[0], kind: "wifi" as const, bssid: "12:34:56:78:9a:bc" }] };
    const ap: Observation = { bssid: "12:34:56:78:9A:BC", source: "wifi", building: "Library", observedAt, edge: true };
    expect(resolveLocation(wifi, [ap], [], now).building).toBe("Library");
    expect(resolveLocation(wifi, [{ ...ap, observedAt: new Date(now - 11 * 60_000).toISOString() }], [], now).kind).toBe("stale");
    expect(resolveLocation(wifi, [{ ...ap, observedAt: new Date(now + 60_000).toISOString() }], [], now).kind).toBe("stale");
  });
  it("labels exact user-to-phone assignment as assigned, not network confirmed", () => {
    const assigned = [{ username: "sccc\\PERSON", building: "Office", source: "desk-phone" as const, observedAt }];
    expect(resolveLocation(machine, [], assigned, now)).toMatchObject({ building: "Office", kind: "assigned", source: "desk-phone" });
    expect(resolveLocation(machine, [evidence], assigned, now).building).toBe("Science");
    expect(resolveLocation(machine, [], [{ ...assigned[0], username: "Different person" }], now).kind).toBe("unknown");
  });
  it("expires assignments and rejects conflicting offices", () => {
    const assignment = { username: machine.loggedOnUser, building: "Office", source: "assignment" as const, observedAt };
    expect(resolveLocation(machine, [], [assignment, { ...assignment, building: "Library" }], now).kind).toBe("ambiguous");
    expect(resolveLocation(machine, [], [{ ...assignment, observedAt: "2025-01-01T00:00:00Z" }], now).kind).toBe("unknown");
  });
});
describe("bounded building rotation", () => {
  const base: Candidate = { deviceId: "a", adVerified: true, lastCheckIn: observedAt, lastTestAt: null, location: { building: "Science", kind: "network-confirmed", source: "switch", observedAt } };
  it("selects one least-recently measured machine per due building", () => {
    const choices = chooseCandidates([{ ...base, deviceId: "b", lastTestAt: observedAt }, base, { ...base, deviceId: "c", location: { ...base.location, building: "Library" } }], new Map(), now);
    expect(choices.map((c) => c.deviceId)).toEqual(["a", "c"]);
  });
  it("excludes stale, AD-disabled, assigned-only and recently measured buildings", () => {
    expect(chooseCandidates([base], new Map([["Science", now - 60_000]]), now)).toEqual([]);
    expect(chooseCandidates([{ ...base, adVerified: false }, { ...base, lastCheckIn: "2020-01-01" }, { ...base, location: { ...base.location, kind: "assigned" } }], new Map(), now)).toEqual([]);
    expect(fresh("garbage", now, 100)).toBe(false);
  });
});
describe("diagnostics credentials and job proof", () => {
  it("uses separate high-entropy credentials and hashes", () => {
    const a = newToken(), b = newToken();
    expect(a).toMatch(/^sccc-diag\.[A-Za-z0-9_-]{43}$/);
    expect(secretsEqual(a, a)).toBe(true); expect(secretsEqual(a, b)).toBe(false); expect(secretsEqual("", "")).toBe(false);
    expect(tokenHash(a)).toHaveLength(64);
  });
  it("binds every job field and the receiving device to its proof", () => {
    const job = { id: "job", expiresAt: "2026-10-25T12:02:00.000Z", downloadBytes: 8388608, uploadBytes: 8388608, pingCount: 5 };
    const proof = jobProof("test-secret", "device", job);
    expect(proof).toHaveLength(43);
    expect(jobProof("test-secret", "other-device", job)).not.toBe(proof);
    expect(jobProof("test-secret", "device", { ...job, uploadBytes: 999 })).not.toBe(proof);
    expect(jobProof("other-secret", "device", job)).not.toBe(proof);
  });
});
