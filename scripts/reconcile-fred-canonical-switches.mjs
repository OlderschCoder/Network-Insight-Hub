#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NODE_FIELDS = Object.freeze({
  hostname: "hostname",
  ip: "mgmt_ip",
  building: "building",
  location: "location",
});
const SWITCH_FIELDS = Object.freeze({
  hostname: "hostname",
  ip: "ip_address",
  building: "building",
  location: "location",
});

function normalizeHostname(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.sccc\.edu$/i, "");
}

function truthy(value) {
  return /^(?:true|yes|1)$/i.test(String(value ?? "").trim());
}

export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("CSV input ends inside a quoted field");
  if (field || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  if (!records.length) return [];
  const headers = records
    .shift()
    .map((header) => header.trim().replace(/^\uFEFF/, ""));
  return records
    .filter((row) => row.some((value) => value.trim()))
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, row[index] ?? ""]),
      ),
    );
}

function canonicalBuilding(site) {
  const key = site.trim().toLowerCase();
  if (key === "mansions") return "Student Living Center";
  if (key === "maintenance") return "Maintenance Building";
  return site.trim();
}

function platformShape(platform, hostname) {
  const key = platform.trim().toLowerCase();
  const role =
    /(?:^|[-_])(?:a48|a24|t48|t24)(?:$|[-_])/i.test(hostname) ||
    /(?:^|[-_])core(?:$|[-_])/i.test(hostname)
      ? "core"
      : "access";
  if (key === "aruba_aoscx")
    return { vendor: "Aruba", model: "Aruba AOS-CX", role };
  if (key === "cisco_ios") return { vendor: "Cisco", model: "Cisco IOS", role };
  if (key === "cisco_nxos")
    return { vendor: "Cisco", model: "Cisco NX-OS", role };
  return { vendor: null, model: null, role };
}

export function loadCanonicalSwitches(catalogText, collectorText) {
  const catalog = parseCsv(catalogText).filter(
    (row) =>
      row.device_type?.trim().toLowerCase() === "switch" &&
      truthy(row.monitoring_required),
  );
  const collectorByIp = new Map();
  for (const row of parseCsv(collectorText).filter((item) =>
    truthy(item.enabled),
  )) {
    const ip = row.ip?.trim();
    if (!ip) continue;
    if (collectorByIp.has(ip))
      throw new Error(`Collector inventory duplicates ${ip}`);
    collectorByIp.set(ip, row);
  }

  const expected = catalog.map((row) => {
    const hostname = row.name?.trim();
    const ip = row.ip?.trim();
    const site = row.site?.trim();
    if (!hostname || !ip || !site)
      throw new Error("Canonical switch row is missing name, ip, or site");
    const collector = collectorByIp.get(ip);
    if (!collector)
      throw new Error(
        `Collector inventory is missing canonical switch ${hostname} (${ip})`,
      );
    const location = collector.location?.trim() || site;
    const shape = platformShape(
      row.platform ?? collector.platform ?? "",
      hostname,
    );
    const aliasIps = /\b(?:alias|svi)\b/i.test(row.notes ?? "")
      ? [...String(row.notes).matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)]
          .map((match) => match[0])
          .filter((value) => value !== ip)
      : [];
    return {
      hostname,
      ip,
      building: canonicalBuilding(site),
      location,
      authoritativeLocation: location.toLowerCase() !== site.toLowerCase(),
      vendor: shape.vendor,
      model: shape.model,
      role: shape.role,
      criticality: shape.role === "core" ? "critical" : "medium",
      notes: row.notes?.trim() || null,
      aliasIps,
    };
  });

  const duplicateIps = expected.filter(
    (row, index) => expected.findIndex((item) => item.ip === row.ip) !== index,
  );
  const duplicateNames = expected.filter(
    (row, index) =>
      expected.findIndex(
        (item) =>
          normalizeHostname(item.hostname) === normalizeHostname(row.hostname),
      ) !== index,
  );
  if (duplicateIps.length)
    throw new Error(
      `Canonical catalog duplicates IPs: ${duplicateIps.map((row) => row.ip).join(", ")}`,
    );
  if (duplicateNames.length)
    throw new Error(
      `Canonical catalog duplicates names: ${duplicateNames.map((row) => row.hostname).join(", ")}`,
    );
  if (expected.length !== 49)
    throw new Error(
      `Expected 49 monitoring-required physical switches, found ${expected.length}`,
    );
  return expected;
}

function desiredValues(table, expected, current) {
  const hostname =
    current &&
    normalizeHostname(current.hostname) === normalizeHostname(expected.hostname)
      ? current.hostname
      : expected.hostname;
  if (table === "net_nodes") {
    return {
      hostname,
      display_name: current?.display_name || expected.hostname,
      node_kind: "switch",
      vendor: expected.vendor ?? current?.vendor ?? null,
      model: current?.model ?? expected.model,
      mgmt_ip: expected.ip,
      building: expected.building,
      location:
        expected.authoritativeLocation || !current?.location
          ? expected.location
          : current.location,
      role: current?.role || expected.role,
      criticality: current?.criticality || expected.criticality,
      status: current?.status || "unknown",
      notes: current ? current.notes : expected.notes,
    };
  }
  return {
    hostname,
    building: expected.building,
    ip_address: expected.ip,
    model: current?.model ?? expected.model,
    status: current?.status || "unknown",
    notes: current ? current.notes : expected.notes,
    location:
      expected.authoritativeLocation || !current?.location
        ? expected.location
        : current.location,
  };
}

function sameValue(left, right) {
  return (left ?? null) === (right ?? null);
}

function planTable(table, rows, expectedSwitches) {
  const fields = table === "net_nodes" ? NODE_FIELDS : SWITCH_FIELDS;
  const actions = [];
  const conflicts = [];
  for (const expected of expectedSwitches) {
    const matches = rows.filter(
      (row) =>
        row[fields.ip] === expected.ip ||
        normalizeHostname(row[fields.hostname]) ===
          normalizeHostname(expected.hostname),
    );
    let uniqueMatches = [
      ...new Map(matches.map((row) => [String(row.id), row])).values(),
    ];
    if (table === "network_switches" && uniqueMatches.length > 1) {
      const canonicalRows = uniqueMatches.filter(
        (row) => row[fields.ip] === expected.ip,
      );
      const aliasRows = uniqueMatches.filter(
        (row) => row[fields.ip] !== expected.ip,
      );
      if (
        canonicalRows.length === 1 &&
        aliasRows.length > 0 &&
        aliasRows.every((row) => expected.aliasIps.includes(row[fields.ip]))
      ) {
        for (const alias of aliasRows) {
          const aliasNote = `SVI alias for ${expected.hostname} at canonical management IP ${expected.ip}`;
          const desiredAlias = {
            hostname: `${expected.hostname}-SVI-${alias[fields.ip].replace(/\./g, "-")}`,
            model: null,
            location: `${expected.building} SVI (${alias[fields.ip]})`,
            notes: alias.notes?.includes(aliasNote)
              ? alias.notes
              : [alias.notes, aliasNote].filter(Boolean).join("; "),
          };
          const changes = Object.fromEntries(
            Object.entries(desiredAlias).filter(
              ([field, value]) => !sameValue(alias[field], value),
            ),
          );
          actions.push({
            table,
            action: Object.keys(changes).length ? "update" : "unchanged",
            id: alias.id,
            hostname: desiredAlias.hostname,
            ip: alias[fields.ip],
            values: changes,
          });
        }
        uniqueMatches = canonicalRows;
      }
    }
    if (uniqueMatches.length > 1) {
      conflicts.push({
        table,
        hostname: expected.hostname,
        ip: expected.ip,
        matches: uniqueMatches.map((row) => ({
          id: row.id,
          hostname: row.hostname,
          ip: row[fields.ip],
        })),
      });
      continue;
    }
    const current = uniqueMatches[0] ?? null;
    const desired = desiredValues(table, expected, current);
    if (!current) {
      actions.push({
        table,
        action: "insert",
        id: null,
        hostname: expected.hostname,
        ip: expected.ip,
        values: desired,
      });
      continue;
    }
    const changes = Object.fromEntries(
      Object.entries(desired).filter(
        ([field, value]) => !sameValue(current[field], value),
      ),
    );
    actions.push({
      table,
      action: Object.keys(changes).length ? "update" : "unchanged",
      id: current.id,
      hostname: expected.hostname,
      ip: expected.ip,
      values: changes,
    });
  }
  return { actions, conflicts };
}

export function buildReconciliationPlan(evidence, expectedSwitches) {
  const nodes = planTable("net_nodes", evidence.nodes, expectedSwitches);
  const switches = planTable(
    "network_switches",
    evidence.switches,
    expectedSwitches,
  );
  const actions = [...nodes.actions, ...switches.actions];
  const conflicts = [...nodes.conflicts, ...switches.conflicts];
  return {
    expectedSwitches: expectedSwitches.length,
    actions,
    conflicts,
    summary: {
      inserts: actions.filter((item) => item.action === "insert").length,
      updates: actions.filter((item) => item.action === "update").length,
      unchanged: actions.filter((item) => item.action === "unchanged").length,
      conflicts: conflicts.length,
    },
  };
}

export function validateCanonicalCoverage(evidence, expectedSwitches) {
  for (const [table, rows, fields] of [
    ["net_nodes", evidence.nodes, NODE_FIELDS],
    ["network_switches", evidence.switches, SWITCH_FIELDS],
  ]) {
    for (const expected of expectedSwitches) {
      const byIp = rows.filter((row) => row[fields.ip] === expected.ip);
      const byName = rows.filter(
        (row) =>
          normalizeHostname(row[fields.hostname]) ===
          normalizeHostname(expected.hostname),
      );
      if (
        byIp.length !== 1 ||
        byName.length !== 1 ||
        String(byIp[0].id) !== String(byName[0].id)
      ) {
        throw new Error(
          `${table} does not resolve ${expected.hostname} (${expected.ip}) to one canonical row`,
        );
      }
      const row = byIp[0];
      if (row[fields.building] !== expected.building)
        throw new Error(`${table} has the wrong building for ${expected.ip}`);
      if (!row[fields.location])
        throw new Error(`${table} has no location for ${expected.ip}`);
      if (
        expected.authoritativeLocation &&
        row[fields.location] !== expected.location
      ) {
        throw new Error(
          `${table} has the wrong authoritative location for ${expected.ip}`,
        );
      }
      if (table === "net_nodes" && row.node_kind !== "switch") {
        throw new Error(
          `net_nodes does not classify ${expected.ip} as a switch`,
        );
      }
    }
  }
}

async function selectEvidence(client) {
  const [nodes, switches] = await Promise.all([
    client.query("SELECT * FROM net_nodes ORDER BY hostname, mgmt_ip"),
    client.query(
      "SELECT * FROM network_switches ORDER BY hostname, ip_address",
    ),
  ]);
  return { nodes: nodes.rows, switches: switches.rows };
}

async function applyAction(client, item) {
  const entries = Object.entries(item.values);
  if (item.action === "unchanged") return;
  if (item.action === "insert") {
    const columns = entries.map(([field]) => field);
    const parameters = entries.map((_, index) => `$${index + 1}`);
    await client.query(
      `INSERT INTO ${item.table} (${columns.join(", ")}) VALUES (${parameters.join(", ")})`,
      entries.map(([, value]) => value),
    );
    return;
  }
  const assignments = entries.map(
    ([field], index) => `${field} = $${index + 1}`,
  );
  assignments.push("updated_at = now()");
  const result = await client.query(
    `UPDATE ${item.table} SET ${assignments.join(", ")} WHERE id = $${entries.length + 1}`,
    [...entries.map(([, value]) => value), item.id],
  );
  if (result.rowCount !== 1)
    throw new Error(
      `Expected one ${item.table} row for ${item.hostname} (${item.ip})`,
    );
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1])
    throw new Error(`${name} is required`);
  return path.resolve(process.argv[index + 1]);
}

function printablePlan(plan) {
  return {
    expectedSwitches: plan.expectedSwitches,
    summary: plan.summary,
    conflicts: plan.conflicts,
    actions: plan.actions
      .filter((item) => item.action !== "unchanged")
      .map(({ table, action, id, hostname, ip, values }) => ({
        table,
        action,
        id,
        hostname,
        ip,
        changes: Object.keys(values),
      })),
  };
}

async function main() {
  const catalogPath = optionValue("--catalog");
  const collectorPath = optionValue("--collector-inventory");
  const expectedSwitches = loadCanonicalSwitches(
    await readFile(catalogPath, "utf8"),
    await readFile(collectorPath, "utf8"),
  );
  const apply = process.argv.includes("--apply");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const appRoot = path.resolve(process.env.FRED_APP_ROOT ?? process.cwd());
  const appRequire = createRequire(
    path.join(appRoot, "artifacts/api-server/package.json"),
  );
  const { Client } = appRequire("pg");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const before = await selectEvidence(client);
    const plan = buildReconciliationPlan(before, expectedSwitches);
    console.log(JSON.stringify(printablePlan(plan), null, 2));
    if (plan.conflicts.length)
      throw new Error(
        "Canonical reconciliation has identity conflicts; no changes were made",
      );
    if (!apply) {
      console.log(
        "Dry run only. Re-run with --apply after reviewing the plan.",
      );
      return;
    }
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    const backupRoot = path.resolve(
      process.env.FRED_INVENTORY_BACKUP_ROOT ?? "backups",
    );
    const backupDirectory = path.join(
      backupRoot,
      `fred-canonical-switches-${timestamp}`,
    );
    await mkdir(backupDirectory, { recursive: true });
    await writeFile(
      path.join(backupDirectory, "before.json"),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), ...before }, null, 2)}\n`,
      "utf8",
    );
    await client.query("BEGIN");
    try {
      for (const item of plan.actions) await applyAction(client, item);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    const after = await selectEvidence(client);
    validateCanonicalCoverage(after, expectedSwitches);
    await writeFile(
      path.join(backupDirectory, "after.json"),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), ...after }, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `Applied and validated all ${expectedSwitches.length} physical switches in both Fred inventories.`,
    );
    console.log(`Before/after evidence: ${backupDirectory}`);
  } finally {
    await client.end();
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
