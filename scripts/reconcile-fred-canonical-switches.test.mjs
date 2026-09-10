import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReconciliationPlan,
  loadCanonicalSwitches,
  parseCsv,
  validateCanonicalCoverage,
} from "./reconcile-fred-canonical-switches.mjs";

function inventory(count = 49) {
  const catalogRows = [
    "name,ip,site,device_type,platform,monitoring_required,notes",
  ];
  const collectorRows = ["enabled,name,ip,platform,location,description,notes"];
  for (let index = 1; index <= count; index += 1) {
    const third = Math.floor((index - 1) / 250);
    const fourth = ((index - 1) % 250) + 1;
    const ip = `10.20.${third}.${fourth}`;
    const site = index === 2 ? "Mansions" : "Hobble";
    const location = index === 1 ? "Hobble (Switch 1)" : site;
    const notes =
      index === 1
        ? "Canonical management address; 10.99.99.1 is a duplicate SVI"
        : "";
    catalogRows.push(
      `switch-${index},${ip},${site},switch,aruba_aoscx,true,${notes}`,
    );
    collectorRows.push(`true,switch-${index},${ip},aruba_aoscx,${location},,`);
  }
  return {
    catalog: catalogRows.join("\n"),
    collector: collectorRows.join("\n"),
  };
}

function evidence(expected) {
  return {
    nodes: expected.map((item, index) => ({
      id: `node-${index}`,
      hostname: item.hostname,
      display_name: item.hostname,
      node_kind: "switch",
      vendor: item.vendor,
      model: item.model,
      mgmt_ip: item.ip,
      building: item.building,
      location: item.location,
      role: item.role,
      criticality: item.criticality,
      status: "unknown",
      notes: null,
    })),
    switches: expected.map((item, index) => ({
      id: index + 1,
      hostname: item.hostname,
      building: item.building,
      ip_address: item.ip,
      model: item.model,
      status: "unknown",
      notes: null,
      location: item.location,
    })),
  };
}

test("CSV parser preserves quoted commas", () => {
  assert.deepEqual(parseCsv('name,notes\nSW-1,"primary, access"\n'), [
    { name: "SW-1", notes: "primary, access" },
  ]);
});

test("loads exactly 49 physical switches and separates building from location", () => {
  const input = inventory();
  const expected = loadCanonicalSwitches(input.catalog, input.collector);
  assert.equal(expected.length, 49);
  assert.equal(expected[0].building, "Hobble");
  assert.equal(expected[0].location, "Hobble (Switch 1)");
  assert.equal(expected[0].authoritativeLocation, true);
  assert.equal(expected[1].building, "Student Living Center");
  assert.equal(expected[1].location, "Mansions");
});

test("plans missing rows without erasing a richer existing location", () => {
  const input = inventory();
  const expected = loadCanonicalSwitches(input.catalog, input.collector);
  const current = evidence(expected);
  current.nodes[2].location = "AA 144 switch closet";
  current.switches[2].location = "AA 144 switch closet";
  current.nodes.pop();
  current.switches.pop();
  const plan = buildReconciliationPlan(current, expected);
  assert.equal(plan.summary.inserts, 2);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(
    plan.actions.find(
      (item) => item.table === "net_nodes" && item.ip === expected[2].ip,
    ).action,
    "unchanged",
  );
});

test("moves a hostname alias to its canonical management IP", () => {
  const input = inventory();
  const expected = loadCanonicalSwitches(input.catalog, input.collector);
  const current = evidence(expected);
  current.nodes[0].mgmt_ip = "10.99.99.1";
  current.switches[0].ip_address = "10.99.99.1";
  const plan = buildReconciliationPlan(current, expected);
  assert.equal(plan.summary.updates, 2);
  assert.equal(plan.summary.conflicts, 0);
  assert.deepEqual(
    plan.actions
      .filter((item) => item.ip === expected[0].ip)
      .map(
        (item) =>
          item.values[item.table === "net_nodes" ? "mgmt_ip" : "ip_address"],
      ),
    [expected[0].ip, expected[0].ip],
  );
});

test("blocks split IP and hostname identities", () => {
  const input = inventory();
  const expected = loadCanonicalSwitches(input.catalog, input.collector);
  const current = evidence(expected);
  current.nodes.push({
    ...current.nodes[0],
    id: "duplicate",
    hostname: "different-switch",
  });
  const plan = buildReconciliationPlan(current, expected);
  assert.equal(plan.summary.conflicts, 1);
  assert.throws(
    () => validateCanonicalCoverage(current, expected),
    /one canonical row/,
  );
});

test("preserves a known SVI alias while separating it from the physical switch identity", () => {
  const input = inventory();
  const expected = loadCanonicalSwitches(input.catalog, input.collector);
  const current = evidence(expected);
  current.switches.push({
    ...current.switches[0],
    id: 500,
    ip_address: "10.99.99.1",
    model: "legacy model",
  });
  const plan = buildReconciliationPlan(current, expected);
  assert.equal(plan.summary.conflicts, 0);
  const alias = plan.actions.find((item) => item.id === 500);
  assert.equal(alias.action, "update");
  assert.match(alias.values.hostname, /-SVI-/);
  assert.equal(alias.values.model, null);
});

test("validates complete canonical coverage in both tables", () => {
  const input = inventory();
  const expected = loadCanonicalSwitches(input.catalog, input.collector);
  assert.doesNotThrow(() =>
    validateCanonicalCoverage(evidence(expected), expected),
  );
});
