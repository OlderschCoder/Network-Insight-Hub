#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { Client } = require("../artifacts/api-server/node_modules/pg");

const building = "Mansions";
const hostnames = ["swa-slab", "swa-slcde"];
const apply = process.argv.includes("--apply");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const backupDirectory = path.resolve("backups", `mansions-building-${timestamp}`);
const client = new Client({ connectionString });

async function evidence() {
  const nodes = await client.query(
    "SELECT * FROM net_nodes WHERE lower(hostname) = ANY($1::text[]) ORDER BY hostname",
    [hostnames],
  );
  const switches = await client.query(
    "SELECT * FROM network_switches WHERE lower(hostname) = ANY($1::text[]) ORDER BY hostname",
    [hostnames],
  );
  const markers = await client.query(
    "SELECT * FROM network_layout_positions WHERE node_id = ANY($1::text[]) ORDER BY node_id",
    [[
      `building-master:${encodeURIComponent(building)}`,
      `building-hidden:${encodeURIComponent(building)}`,
      `building-disabled:${encodeURIComponent(building)}`,
    ]],
  );
  return { nodes: nodes.rows, switches: switches.rows, markers: markers.rows };
}
function summary(snapshot) {
  return hostnames.map((hostname) => ({
    hostname,
    expected: building,
    nodeBuilding: snapshot.nodes.find((row) => row.hostname.toLowerCase() === hostname)?.building ?? "MISSING",
    inventoryBuilding: snapshot.switches.find((row) => row.hostname.toLowerCase() === hostname)?.building ?? "MISSING",
  }));
}

await client.connect();
try {
  const before = await evidence();
  console.table(summary(before));
  if (!apply) {
    console.log("Dry run only. Re-run with --apply to create Mansions and move both switches.");
  } else {
    await mkdir(backupDirectory, { recursive: true });
    await writeFile(path.join(backupDirectory, "before.json"), `${JSON.stringify(before, null, 2)}\n`, "utf8");

    await client.query("BEGIN");
    try {
      await client.query(
        "UPDATE net_nodes SET building = $2, updated_at = now() WHERE lower(hostname) = ANY($1::text[])",
        [hostnames, building],
      );
      await client.query(
        "UPDATE network_switches SET building = $2, updated_at = now() WHERE lower(hostname) = ANY($1::text[])",
        [hostnames, building],
      );
      await client.query(
        `INSERT INTO network_layout_positions (node_id, x, y, width, height, updated_at, updated_by)
         VALUES ($1, 0, 0, NULL, NULL, now(), NULL)
         ON CONFLICT (node_id) DO NOTHING`,
        [`building-master:${encodeURIComponent(building)}`],
      );
      await client.query(
        "DELETE FROM network_layout_positions WHERE node_id = ANY($1::text[])",
        [[`building-hidden:${encodeURIComponent(building)}`, `building-disabled:${encodeURIComponent(building)}`]],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const after = await evidence();
    const invalid = summary(after).filter(
      (row) => row.nodeBuilding !== building || row.inventoryBuilding !== building,
    );
    if (invalid.length > 0) throw new Error(`Post-change validation failed for ${invalid.length} switch(es)`);
    if (!after.markers.some((row) => row.node_id === `building-master:${encodeURIComponent(building)}`)) {
      throw new Error("Post-change validation failed: Mansions building marker is missing");
    }
    await writeFile(path.join(backupDirectory, "after.json"), `${JSON.stringify(after, null, 2)}\n`, "utf8");
    console.table(summary(after));
    console.log(`Applied successfully. Before/after evidence: ${backupDirectory}`);
  }
} finally {
  await client.end();
}
