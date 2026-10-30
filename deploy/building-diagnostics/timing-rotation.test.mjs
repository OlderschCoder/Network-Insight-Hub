import assert from "node:assert/strict";
import test from "node:test";
import { ACTOR, planTimingProbe, INTERVAL_MS, RETRY_MS, DAILY_JOB_LIMIT } from "./timing-rotation.mjs";
const now = Date.parse("2026-10-30T16:00:00Z");
const device = { deviceId: "one", computerName: "SYNTHETIC", enrolled: true, online: true, adVerified: true, adEnabled: true, lastCheckIn: new Date(now).toISOString(), capabilities: ["external-probe-v2"], location: { kind: "network-confirmed", building: "Synthetic A" } };
const input = { devices: [device], history: [], pending: [], dailyJobs: 0, externalConfigured: true, now };
test("first collects external timings, then request loss, with six-hour freshness", () => {
  assert.equal(planTimingProbe(input).type, "external-quick");
  const history = [{ building: "Synthetic A", type: "external-quick", last_success: new Date(now).toISOString() }];
  assert.equal(planTimingProbe({ ...input, history }).type, "fred");
  history.push({ building: "Synthetic A", type: "fred", last_success: new Date(now - INTERVAL_MS + 1).toISOString() });
  assert.equal(planTimingProbe({ ...input, history }), null);
});
test("respects any pending measurement and the rolling daily cap", () => {
  assert.equal(planTimingProbe({ ...input, pending: [{}] }), null);
  assert.equal(planTimingProbe({ ...input, dailyJobs: DAILY_JOB_LIMIT }), null);
});
test("unclaimed speed jobs cannot starve other receivers; timing queue stays bounded", () => {
  const pending = [{ status: "queued", device_id: "other", requested_by: "speed rotation" }];
  assert.equal(planTimingProbe({ ...input, pending }).deviceId, "one");
  assert.equal(planTimingProbe({ ...input, pending: [{ ...pending[0], device_id: "one" }] }), null);
  assert.equal(planTimingProbe({ ...input, pending: [{ ...pending[0], requested_by: ACTOR }] }), null);
});
test("failed probe backs off per building even if another device is available", () => {
  const history = ["fred", "external-quick"].map(type => ({ building: "Synthetic A", type, last_attempt: new Date(now - RETRY_MS + 1).toISOString() }));
  assert.equal(planTimingProbe({ ...input, history }), null);
});
test("requires a fresh, enabled, verified, located and enrolled receiver", () => {
  for (const patch of [{ online: false }, { enrolled: false }, { revoked: true }, { adEnabled: false }, { adVerified: false }, { lastCheckIn: new Date(now - 121_000).toISOString() }, { location: { kind: "assigned", building: "Synthetic A" } }]) {
    assert.equal(planTimingProbe({ ...input, devices: [{ ...device, ...patch }] }), null);
  }
});
test("does not schedule external jobs without both capability and target", () => {
  assert.equal(planTimingProbe({ ...input, externalConfigured: false }).type, "fred");
  assert.equal(planTimingProbe({ ...input, devices: [{ ...device, capabilities: [] }] }).type, "fred");
});
