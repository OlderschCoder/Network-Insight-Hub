#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const requestedSwitches = Object.freeze([
  {
    ip: "172.25.0.2",
    building: "West Campus",
    location: "West Campus (SW-WestCampus-1)",
  },
  {
    ip: "172.25.0.3",
    building: "West Campus",
    location: "West Campus Truck Driving (SW-WestCampus-2)",
  },
  { ip: "172.25.0.11", building: "West Campus", location: "West ALC ALC-B" },
  {
    ip: "172.25.0.92",
    building: "West Campus",
    location: "West Reception (SW-Reception)",
  },
  {
    ip: "192.168.2.26",
    building: "Student Union",
    location: "Student Union Cafeteria (SW-Cafe)",
  },
  {
    ip: "192.168.2.50",
    building: "Student Activities",
    location: "Student Activities Gym Instant Replay",
  },
  {
    ip: "192.168.2.194",
    building: "Student Activities",
    location: "Student Activities (SW-SA208)",
  },
  {
    ip: "192.168.2.200",
    building: "Student Union",
    location: "Student Union (SWA-SU121)",
  },
  {
    ip: "192.168.252.46",
    building: "Student Activities",
    location: "Student Union Gym 208 (SUGymCam)",
  },
]);

const requestedByIp = new Map(requestedSwitches.map((row) => [row.ip, row]));
const requestedIps = [...requestedByIp.keys()];

export function summarizeSwitchInventory(evidence) {
  return requestedSwitches.map((expected) => {
    const node = evidence.nodes.find((row) => row.mgmt_ip === expected.ip);
    const inventory = evidence.switches.find(
      (row) => row.ip_address === expected.ip,
    );
    return {
      ip: expected.ip,
      hostname: node?.hostname ?? inventory?.hostname ?? "MISSING",
      expectedBuilding: expected.building,
      nodeBuilding: node?.building ?? "MISSING",
      inventoryBuilding: inventory?.building ?? "MISSING",
      expectedLocation: expected.location,
      nodeLocation: node?.location ?? "MISSING",
      inventoryLocation: inventory?.location ?? "MISSING",
      nodeRole: node?.role ?? "MISSING",
      nodeVendor: node?.vendor ?? "MISSING",
      nodeKind: node?.node_kind ?? "MISSING",
    };
  });
}

export function validateSwitchInventory(
  evidence,
  { requireExpectedValues = false } = {},
) {
  for (const source of ["nodes", "switches"]) {
    const rows = evidence[source];
    if (!Array.isArray(rows)) throw new Error(`Evidence is missing ${source}`);
    const field = source === "nodes" ? "mgmt_ip" : "ip_address";
    const counts = new Map();
    for (const row of rows)
      counts.set(row[field], (counts.get(row[field]) ?? 0) + 1);
    const invalid = requestedIps.filter((ip) => counts.get(ip) !== 1);
    if (invalid.length > 0) {
      throw new Error(
        `${source} must contain exactly one row for: ${invalid.join(", ")}`,
      );
    }
  }

  if (!requireExpectedValues) return;
  const invalid = summarizeSwitchInventory(evidence).filter(
    (row) =>
      row.nodeBuilding !== row.expectedBuilding ||
      row.inventoryBuilding !== row.expectedBuilding ||
      row.nodeLocation !== row.expectedLocation ||
      row.inventoryLocation !== row.expectedLocation ||
      row.nodeRole.toLowerCase() !== "access" ||
      row.nodeVendor.toLowerCase() !== "aruba" ||
      row.nodeKind.toLowerCase() !== "switch",
  );
  if (invalid.length > 0) {
    throw new Error(
      `Post-change validation failed for ${invalid.length} switch(es): ${invalid.map((row) => row.ip).join(", ")}`,
    );
  }
}

async function selectEvidence(client) {
  const nodes = await client.query(
    "SELECT * FROM net_nodes WHERE mgmt_ip = ANY($1::text[]) ORDER BY mgmt_ip",
    [requestedIps],
  );
  const switches = await client.query(
    "SELECT * FROM network_switches WHERE ip_address = ANY($1::text[]) ORDER BY ip_address",
    [requestedIps],
  );
  return { nodes: nodes.rows, switches: switches.rows };
}

async function main() {
  const appRoot = path.resolve(process.env.FRED_APP_ROOT ?? process.cwd());
  const appRequire = createRequire(
    path.join(appRoot, "artifacts/api-server/package.json"),
  );
  const { Client } = appRequire("pg");
  const apply = process.argv.includes("--apply");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const backupRoot = path.resolve(
    process.env.FRED_INVENTORY_BACKUP_ROOT ?? "backups",
  );
  const backupDirectory = path.join(
    backupRoot,
    `fred-switch-inventory-${timestamp}`,
  );
  const client = new Client({ connectionString });

  await client.connect();
  try {
    const before = await selectEvidence(client);
    validateSwitchInventory(before);
    console.table(summarizeSwitchInventory(before));

    if (!apply) {
      console.log(
        "Dry run only. Re-run with --apply to update both Fred inventory tables.",
      );
      return;
    }

    await mkdir(backupDirectory, { recursive: true });
    await writeFile(
      path.join(backupDirectory, "before.json"),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), ...before }, null, 2)}\n`,
      "utf8",
    );

    await client.query("BEGIN");
    try {
      for (const expected of requestedSwitches) {
        const nodeUpdate = await client.query(
          `UPDATE net_nodes
             SET building = $2,
                 location = $3,
                 node_kind = 'switch',
                 vendor = 'Aruba',
                 role = 'access',
                 updated_at = now()
           WHERE mgmt_ip = $1`,
          [expected.ip, expected.building, expected.location],
        );
        const inventoryUpdate = await client.query(
          `UPDATE network_switches
             SET building = $2,
                 location = $3,
                 updated_at = now()
           WHERE ip_address = $1`,
          [expected.ip, expected.building, expected.location],
        );
        if (nodeUpdate.rowCount !== 1 || inventoryUpdate.rowCount !== 1) {
          throw new Error(
            `Expected one row in each inventory for ${expected.ip}`,
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const after = await selectEvidence(client);
    validateSwitchInventory(after, { requireExpectedValues: true });
    await writeFile(
      path.join(backupDirectory, "after.json"),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), ...after }, null, 2)}\n`,
      "utf8",
    );
    console.table(summarizeSwitchInventory(after));
    console.log(
      `Applied successfully. Before/after evidence: ${backupDirectory}`,
    );
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
