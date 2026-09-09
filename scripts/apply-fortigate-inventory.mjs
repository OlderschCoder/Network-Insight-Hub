#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { Client } = require("../artifacts/api-server/node_modules/pg");

const devices = [
  {
    mgmtIp: "192.168.1.1",
    hostname: "FortigateA-Sccc",
    model: "FortiGate-1801F",
    building: "Hobble",
    location: "Hobble firewall",
  },
  {
    mgmtIp: "172.25.0.1",
    hostname: "WestCampus-Fortigate",
    model: "FortiGate-90G",
    building: "West Campus",
    location: "West Campus firewall",
  },
];

const apply = process.argv.includes("--apply");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const backupDirectory = path.resolve("backups", `fortigate-inventory-${timestamp}`);
const client = new Client({ connectionString });

async function evidence() {
  const ips = devices.map((device) => device.mgmtIp);
  const nodes = await client.query(
    `SELECT id, hostname, display_name, node_kind, vendor, model, mgmt_ip, building,
            location, role, criticality, status
       FROM net_nodes
      WHERE mgmt_ip = ANY($1::text[])
      ORDER BY mgmt_ip`,
    [ips],
  );
  const inventory = await client.query(
    `SELECT id, hostname, ip_address, model, building, location, status, last_seen
       FROM network_switches
      WHERE ip_address = ANY($1::text[])
      ORDER BY ip_address`,
    [ips],
  );
  return { nodes: nodes.rows, inventory: inventory.rows };
}
function summary(snapshot) {
  return devices.map((expected) => {
    const node = snapshot.nodes.find((row) => row.mgmt_ip === expected.mgmtIp);
    const inventory = snapshot.inventory.find((row) => row.ip_address === expected.mgmtIp);
    return {
      ip: expected.mgmtIp,
      expected: expected.hostname,
      mapNode: node?.hostname ?? "MISSING",
      kind: node?.node_kind ?? "MISSING",
      role: node?.role ?? "MISSING",
      inventory: inventory?.hostname ?? "MISSING",
    };
  });
}

await client.connect();
try {
  const before = await evidence();
  console.table(summary(before));
  if (!apply) {
    console.log("Dry run only. Re-run with --apply to normalize the two FortiGate inventory records.");
  } else {
    if (before.nodes.length !== devices.length || before.inventory.length !== devices.length) {
      throw new Error("Expected both FortiGates in net_nodes and network_switches; no changes were made");
    }

    await mkdir(backupDirectory, { recursive: true });
    await writeFile(path.join(backupDirectory, "before.json"), `${JSON.stringify(before, null, 2)}\n`, "utf8");

    await client.query("BEGIN");
    try {
      for (const device of devices) {
        await client.query(
          `UPDATE net_nodes
              SET hostname = $2, display_name = $2, node_kind = 'firewall', vendor = 'Fortinet',
                  model = $3, building = $4, location = $5, role = 'firewall',
                  criticality = 'critical', updated_at = now()
            WHERE mgmt_ip = $1`,
          [device.mgmtIp, device.hostname, device.model, device.building, device.location],
        );
        await client.query(
          `UPDATE network_switches
              SET hostname = $2, model = $3, building = $4, location = $5, updated_at = now()
            WHERE ip_address = $1`,
          [device.mgmtIp, device.hostname, device.model, device.building, device.location],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const after = await evidence();
    const invalid = devices.filter((expected) => {
      const node = after.nodes.find((row) => row.mgmt_ip === expected.mgmtIp);
      const inventory = after.inventory.find((row) => row.ip_address === expected.mgmtIp);
      return node?.hostname !== expected.hostname
        || node?.node_kind !== "firewall"
        || node?.role !== "firewall"
        || inventory?.hostname !== expected.hostname;
    });
    if (invalid.length > 0) throw new Error(`Post-change validation failed for ${invalid.length} firewall(s)`);
    await writeFile(path.join(backupDirectory, "after.json"), `${JSON.stringify(after, null, 2)}\n`, "utf8");
    console.table(summary(after));
    console.log(`Applied successfully. Before/after evidence: ${backupDirectory}`);
  }
} finally {
  await client.end();
}
