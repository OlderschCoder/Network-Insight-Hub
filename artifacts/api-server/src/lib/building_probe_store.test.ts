import { describe, expect, it, vi } from "vitest";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { BuildingProbeStore } from "./building_probe_store";
import { digest, token, JobSigner } from "./building_probe_protocol";
const id = randomUUID(), deviceId = randomUUID(), credential = token(), bootstrap = token();
function setup(row: any) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith("SELECT * FROM building_probes")) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    if (sql.startsWith("INSERT INTO building_probes")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const pool = { query, connect: async () => ({ query, release }) };
  return { store: new BuildingProbeStore(pool), query, release };
}
const registered = { id, enabled: true, computer_name: "WEST-LAB-01", device_id: deviceId, credential_hash: digest(credential), last_seen: new Date() };
describe("probe identity and transaction boundaries", () => {
  it("rejects revoked credentials and credentials from a different device", async () => {
    const a = setup({ ...registered, enabled: false });
    await expect(a.store.authenticate(id, deviceId, credential)).rejects.toMatchObject({ status: 401 });
    const b = setup(registered);
    await expect(b.store.authenticate(id, randomUUID(), credential)).rejects.toMatchObject({ status: 401 });
    await expect(b.store.authenticate(id, deviceId, token())).rejects.toMatchObject({ status: 401 });
  });
  it("cannot replace an enrolled device using an old bootstrap", async () => {
    const { store, query, release } = setup({ ...registered, bootstrap_hash: digest(bootstrap) });
    await expect(store.enroll({ assignmentId: id, deviceId: randomUUID(), computerName: "WEST-LAB-01", proposedToken: token() }, bootstrap)).rejects.toMatchObject({ status: 403 });
    expect(query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true); expect(release).toHaveBeenCalledOnce();
    expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE building_probes"))).toBe(false);
  });
  it("accepts enrollment retry only with the already pinned device credential", async () => {
    const { store, query } = setup(registered);
    await store.enroll({ assignmentId: id, deviceId, computerName: "WEST-LAB-01", proposedToken: credential }, bootstrap);
    expect(query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE building_probes"))).toBe(false);
  });
  it("expires bootstrap and pins one computer name", async () => {
    const { store } = setup({ ...registered, device_id: null, credential_hash: null, bootstrap_hash: digest(bootstrap), bootstrap_expires_at: new Date(Date.now()-1) });
    await expect(store.enroll({ assignmentId: id, deviceId, computerName: "WEST-LAB-01", proposedToken: credential }, bootstrap)).rejects.toMatchObject({ status: 403 });
    await expect(store.enroll({ assignmentId: id, deviceId, computerName: "OTHER-PC", proposedToken: credential }, bootstrap)).rejects.toMatchObject({ status: 403 });
  });
  it("hashes new credentials, clears bootstrap and commits atomically", async () => {
    const { store, query } = setup({ ...registered, device_id: null, credential_hash: null, bootstrap_hash: digest(bootstrap), bootstrap_expires_at: new Date(Date.now()+60000) });
    await store.enroll({ assignmentId: id, deviceId, computerName: "west-lab-01", proposedToken: credential }, bootstrap);
    const update = query.mock.calls.find(([sql]) => sql.startsWith("UPDATE building_probes"));
    expect(update?.[0]).toContain("bootstrap_hash=NULL"); expect(update?.[1]).toEqual([id,deviceId,digest(credential)]);
  });
  it("never silently replaces an active building assignment", async () => {
    const { store } = setup(null);
    await expect(store.assign({ building: "West", computerName: "PC" }, bootstrap, 42)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects another probe's job result before writing a snapshot", async () => {
    const { store, query } = setup(registered);
    const signer = new JobSigner(generateKeyPairSync("ec",{namedCurve:"prime256v1"}).privateKey);
    await expect(store.heartbeat(id,deviceId,credential,{computerName:"WEST-LAB-01"} as any,[{ jobId: randomUUID(),kind:"multicast" } as any],signer)).rejects.toMatchObject({status:403});
    expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE building_probes"))).toBe(false);
  });
});
