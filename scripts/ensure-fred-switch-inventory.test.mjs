import assert from "node:assert/strict";
import test from "node:test";

import {
  requestedSwitches,
  summarizeSwitchInventory,
  validateSwitchInventory,
} from "./ensure-fred-switch-inventory.mjs";

function matchingEvidence() {
  return {
    nodes: requestedSwitches.map((row, index) => ({
      hostname: `switch-${index}`,
      mgmt_ip: row.ip,
      building: row.building,
      location: row.location,
      role: "access",
      vendor: "Aruba",
      node_kind: "switch",
    })),
    switches: requestedSwitches.map((row, index) => ({
      hostname: `switch-${index}`,
      ip_address: row.ip,
      building: row.building,
      location: row.location,
    })),
  };
}

test("defines the nine requested unique Aruba access-switch assignments", () => {
  assert.equal(requestedSwitches.length, 9);
  assert.equal(new Set(requestedSwitches.map((row) => row.ip)).size, 9);
  assert.deepEqual(
    requestedSwitches.map(({ ip, location }) => [ip, location]),
    [
      ["172.25.0.2", "West Campus (SW-WestCampus-1)"],
      ["172.25.0.3", "West Campus Truck Driving (SW-WestCampus-2)"],
      ["172.25.0.11", "West ALC ALC-B"],
      ["172.25.0.92", "West Reception (SW-Reception)"],
      ["192.168.2.26", "Student Union Cafeteria (SW-Cafe)"],
      ["192.168.2.50", "Student Activities Gym Instant Replay"],
      ["192.168.2.194", "Student Activities (SW-SA208)"],
      ["192.168.2.200", "Student Union (SWA-SU121)"],
      ["192.168.252.46", "Student Union Gym 208 (SUGymCam)"],
    ],
  );
});

test("accepts a fully reconciled two-table inventory", () => {
  const evidence = matchingEvidence();
  assert.doesNotThrow(() =>
    validateSwitchInventory(evidence, { requireExpectedValues: true }),
  );
  assert.equal(summarizeSwitchInventory(evidence).length, 9);
});

test("refuses to proceed when either inventory is missing a requested IP", () => {
  const evidence = matchingEvidence();
  evidence.switches.pop();
  assert.throws(
    () => validateSwitchInventory(evidence),
    /must contain exactly one row/,
  );
});

test("detects incorrect role, vendor, building, or location after apply", () => {
  const evidence = matchingEvidence();
  evidence.nodes[0].role = "distribution";
  assert.throws(
    () => validateSwitchInventory(evidence, { requireExpectedValues: true }),
    /Post-change validation failed/,
  );
});
