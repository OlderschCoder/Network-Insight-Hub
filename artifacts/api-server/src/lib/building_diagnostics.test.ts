import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseCandidates, chooseLibreSpeedBuildingSample, diagnosticsReadiness, externalProbeConfig, fresh, jobProof, libreSpeedBucket, libreSpeedConfig, libreSpeedScheduleSlot, newToken, normalizeMac, resolveLocation, resolvePortTelemetry, schedulerSettings, secretsEqual, tokenHash, type Candidate, type Observation } from "./building_diagnostics";
afterEach(() => vi.unstubAllEnvs());

const now = Date.parse("2026-10-25T12:00:00Z"), observedAt = new Date(now - 60_000).toISOString();
const machine = { interfaces: [{ mac: "AA-BB-CC-DD-EE-FF", ipAddresses: ["10.1.2.3"], kind: "ethernet" as const }], loggedOnUser: "SCCC\\person" };
const evidence: Observation = { mac: "aa:bb:cc:dd:ee:ff", building: "Science", switchName: "sw-science", port: "1/1/4", source: "switch", observedAt, edge: true };

describe("operator readiness and scheduler gates", () => {
  it("requires both a deployment gate and persisted operator arming", () => {
    vi.stubEnv("BUILDING_DIAGNOSTICS_ENABLED", "true"); vi.stubEnv("BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED", "true");
    expect(schedulerSettings()).toMatchObject({ schedulerArmed: false, rotationIntervalMinutes: 360, persisted: false, effectiveSchedulerEnabled: false });
    const row = { scheduler_armed: true, rotation_interval_minutes: 180, revision: 3 };
    expect(schedulerSettings(row)).toMatchObject({ persisted: true, effectiveSchedulerEnabled: true, revision: 3 });
    vi.stubEnv("BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED", "false");
    expect(schedulerSettings(row)).toMatchObject({ schedulerArmed: true, effectiveSchedulerEnabled: false });
    vi.stubEnv("BUILDING_DIAGNOSTICS_ENABLED", "false"); vi.stubEnv("BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED", "true");
    expect(schedulerSettings(row).effectiveSchedulerEnabled).toBe(false);
  });
  it("separates worker contact, AD freshness and unknown collector state", () => {
    vi.stubEnv("BUILDING_DIAGNOSTICS_ENABLED", "true"); vi.stubEnv("BUILDING_DIAGNOSTICS_WORKER_TOKEN", "w".repeat(40));
    expect(diagnosticsReadiness({}, now)).toMatchObject({ workerConfigured: true, worker: { state: "never-seen", lastSeenAt: null }, inventory: { state: "never-imported" }, collector: { state: "unknown", lastSeenAt: null }, counts: { inventory: 0, online: 0 } });
    const inventory = { updatedAt: observedAt, adObservedAt: "2020-01-01T00:00:00Z", observations: [evidence], adComputers: [{}] };
    expect(diagnosticsReadiness({ inventory, workerLastSeenAt: observedAt }, now)).toMatchObject({ worker: { state: "current" }, inventory: { state: "stale", networkObservedAt: observedAt }, collector: { state: "unknown" }, counts: { inventory: 1, online: 0 } });
    expect(diagnosticsReadiness({ inventory: { ...inventory, collectorStatus: { observedAt, status: "degraded", switchesObserved: 2, portObservations: 1, wifiObservations: 0 } } }, now).collector).toMatchObject({ state: "degraded", status: "degraded", switchesObserved: 2 });
    expect(diagnosticsReadiness({ inventory: { ...inventory, collectorStatus: { observedAt: "2020-01-01T00:00:00Z", status: "ok", switchesObserved: 2, portObservations: 1, wifiObservations: 0 } } }, now).collector.state).toBe("stale");
  });
  it("separates enabled-fleet eligibility from ready-now measurement state", () => {
    vi.stubEnv("BUILDING_DIAGNOSTICS_ENABLED", "true");
    const location = { building: "Science", kind: "assigned" as const, source: "manual", observedAt };
    const enabled = { enrolled: true, revoked: false, online: true, adVerified: true, adEnabled: true, capabilities: ["librespeed-v2"], location };
    const counts = diagnosticsReadiness({ devices: [
      enabled,
      { ...enabled, enrolled: false, online: false, capabilities: [] },
      { ...enabled, adEnabled: false, online: false, capabilities: [] },
      { ...enabled, online: false, capabilities: [], location: { building: null, kind: "unknown" as const, source: null, observedAt: null } },
    ] }, now).counts;
    expect(counts).toMatchObject({ eligible: 3, runnableNow: 1, unlocated: 1 });
  });
});

describe("central port telemetry attribution", () => {
  const measured: Observation = { ...evidence, portTelemetry: { source: "snmp", observedAt, linkMbps: 1000, inErrors: 3 } };
  it("exposes actual fresh unique port fields without manufacturing traffic rates", () => {
    expect(resolvePortTelemetry(machine, [measured], now)).toEqual({ source: "snmp", observedAt, linkMbps: 1000, inErrors: 3, switchName: "sw-science", port: "1/1/4" });
    expect(resolvePortTelemetry(machine, [measured], now)).not.toHaveProperty("inBitsPerSecond");
  });
  it("withholds stale, uplink and ambiguous central port measurements", () => {
    expect(resolvePortTelemetry(machine, [{ ...measured, portTelemetry: { ...measured.portTelemetry!, observedAt: "2020-01-01T00:00:00Z" } }], now)).toBeNull();
    expect(resolvePortTelemetry(machine, [{ ...measured, edge: false }], now)).toBeNull();
    expect(resolvePortTelemetry(machine, [measured, { ...measured, building: "Library" }], now)).toBeNull();
    expect(resolvePortTelemetry(machine, [measured, { ...measured, port: "1/1/8" }], now)).toBeNull();
  });
});

describe("external probe configuration", () => {
  it("defaults off and validates a configurable public HTTPS origin", () => {
    delete process.env.BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN;
    delete process.env.BUILDING_DIAGNOSTICS_EXTERNAL_SUSTAINED_ENABLED;
    expect(externalProbeConfig()).toMatchObject({ configured: false, origin: null, sustainedEnabled: false, dailyBudgetBytes: 1073741824 });
    process.env.BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN = "https://probe.example.org/";
    expect(externalProbeConfig().origin).toBe("https://probe.example.org");
    for (const origin of ["http://example.org", "https://127.0.0.1", "https://10.0.0.22", "https://localhost", "https://host.local", "https://example.org/private", "https://user:secret@example.org", "https://example.org:8443", "https://example.org/?token=secret"]) {
      process.env.BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN = origin;
      expect(() => externalProbeConfig()).toThrow("public HTTPS DNS origin");
    }
    delete process.env.BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN;
  });
});
describe("LibreSpeed V2 deployment guard", () => {
  it("requires both feature gates and bounds canary concurrency", () => {
    vi.stubEnv("BUILDING_DIAGNOSTICS_ENABLED", "true");
    vi.stubEnv("BUILDING_DIAGNOSTICS_LIBRESPEED_ENABLED", "true");
    vi.stubEnv("BUILDING_DIAGNOSTICS_LIBRESPEED_MAX_CONCURRENT", "3");
    vi.stubEnv("BUILDING_DIAGNOSTICS_LIBRESPEED_CANARY_MAX", "6");
    expect(libreSpeedConfig()).toMatchObject({ enabled: true, maxConcurrent: 3, canaryMax: 6, intervalMinutes: 120, bucketMinutes: 10 });
    vi.stubEnv("BUILDING_DIAGNOSTICS_LIBRESPEED_CANARY_MAX", "600");
    vi.stubEnv("BUILDING_DIAGNOSTICS_LIBRESPEED_MAX_CONCURRENT", "0");
    expect(libreSpeedConfig()).toMatchObject({ maxConcurrent: 2, canaryMax: 4 });
    vi.stubEnv("BUILDING_DIAGNOSTICS_LIBRESPEED_ENABLED", "false");
    expect(libreSpeedConfig().enabled).toBe(false);
  });
  it("assigns a stable three-hour bucket without exposing device identity", () => {
    const first = libreSpeedBucket("device-123");
    expect(first).toBe(libreSpeedBucket("DEVICE-123"));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(12);
  });
  it("opens only the seven daytime two-hour slots in Central time", () => {
    expect(libreSpeedScheduleSlot(new Date("2026-10-29T12:00:00Z"))).toBe("2026-10-29T07:00@America/Chicago");
    expect(libreSpeedScheduleSlot(new Date("2026-10-29T13:59:00Z"))).toBe("2026-10-29T07:00@America/Chicago");
    expect(libreSpeedScheduleSlot(new Date("2026-10-29T14:00:00Z"))).toBe("2026-10-29T09:00@America/Chicago");
    expect(libreSpeedScheduleSlot(new Date("2026-10-30T01:00:00Z"))).toBeNull();
    expect(libreSpeedScheduleSlot(new Date("2026-10-29T11:59:00Z"))).toBeNull();
  });
  it("chooses up to five oldest capable online computers per named building", () => {
    const location = (building: string) => ({ building, kind: "assigned" as const, source: "manual", observedAt });
    const base = { adVerified: true, online: true, lastCheckIn: observedAt, lastTestAt: null, capabilities: ["librespeed-v2"] };
    const devices = [
      ...Array.from({ length: 7 }, (_, index) => ({ ...base, deviceId: `a-${index}`, location: location("Alpha"), lastTestAt: index === 0 ? observedAt : null })),
      { ...base, deviceId: "b-1", location: location("Beta") },
      { ...base, deviceId: "offline", online: false, location: location("Beta") },
      { ...base, deviceId: "unknown", location: location("") },
    ];
    const selected = chooseLibreSpeedBuildingSample(devices);
    expect(selected.filter((device) => device.location.building === "Alpha")).toHaveLength(5);
    expect(selected.map((device) => device.deviceId)).toContain("b-1");
    expect(selected.map((device) => device.deviceId)).not.toContain("offline");
    expect(selected.map((device) => device.deviceId)).not.toContain("a-0");
  });
});
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
  it("uses a fresh trusted controller client-MAC association when Windows cannot report BSSID", () => {
    const wifi = { interfaces: [{ ...machine.interfaces[0], kind: "wifi" as const }] };
    const ap: Observation = { mac: "aa:bb:cc:dd:ee:ff", bssid: "02:34:56:78:9a:bc", source: "wifi", building: "Library", observedAt, edge: true };
    expect(resolveLocation(wifi, [ap], [], now)).toMatchObject({ building: "Library", kind: "network-confirmed", source: "Wi-Fi AP" });
    expect(resolveLocation(wifi, [{ ...ap, mac: "00:11:22:33:44:55" }], [], now).kind).toBe("unknown");
    expect(resolveLocation(wifi, [{ ...ap, observedAt: "2020-01-01T00:00:00Z" }], [], now).kind).toBe("stale");
    expect(resolveLocation(wifi, [ap, { ...ap, building: "Science" }], [], now).kind).toBe("ambiguous");
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
  it("binds external origin, type, timeout and byte budget with a versioned proof", () => {
    const job = { id: "job", expiresAt: "2026-10-25T12:02:00.000Z", downloadBytes: 5242880, uploadBytes: 0, pingCount: 1, proofVersion: 2, type: "external-quick" as const, targetOrigin: "https://probe.example.org", timeoutSeconds: 30 };
    const proof = jobProof("secret", "device", job);
    expect(jobProof("secret", "device", { ...job, targetOrigin: "https://other.example.org" })).not.toBe(proof);
    expect(jobProof("secret", "device", { ...job, timeoutSeconds: 180 })).not.toBe(proof);
    expect(jobProof("secret", "other-device", job)).not.toBe(proof);
    expect(jobProof("secret", "device", { ...job, proofVersion: undefined })).not.toBe(proof);
  });
});
