#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { Client } = require("../artifacts/api-server/node_modules/pg");

const assignments = new Map([
  ["sw-sa208", "Student Activities"],
  ["sugymcam", "Student Activities"],
  ["sw-sa208-replay", "Student Activities"],
  ["swa-su121", "Student Union"],
  ["sw-cafe", "Student Union"],
]);

const apply = process.argv.includes("--apply");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const backupDirectory = path.resolve("backups", `student-building-split-${timestamp}`);
const names = [...assignments.keys()];
const client = new Client({ connectionString });

async function selectEvidence() {
  // A pg Client executes one query at a time; keep evidence reads sequential so
  // this remains compatible with pg 9 rather than relying on its old queueing.
  const nodes = await client.query(
    "SELECT * FROM net_nodes WHERE lower(hostname) = ANY($1::text[]) ORDER BY hostname",
    [names],
  );
  const switches = await client.query(
    "SELECT * FROM network_switches WHERE lower(hostname) = ANY($1::text[]) ORDER BY hostname",
    [names],
  );
  const vlans = await client.query(
    "SELECT * FROM vlans WHERE building IN ($1, $2, $3) ORDER BY vlan_id",
    ["Student Activities", "Student Union", "Student Union / Student Activities"],
  );
  const markers = await client.query(
    "SELECT * FROM network_layout_positions WHERE node_id LIKE $1 ORDER BY node_id",
    ["building-master:Student%"],
  );
  return { nodes: nodes.rows, switches: switches.rows, vlans: vlans.rows, markers: markers.rows };
}
function summarize(evidence) {
  return names.map((hostname) => {
    const node = evidence.nodes.find((row) => row.hostname.toLowerCase() === hostname);
    const inventory = evidence.switches.find((row) => row.hostname.toLowerCase() === hostname);
    return {
      hostname,
      expected: assignments.get(hostname),
      nodeBuilding: node?.building ?? "MISSING",
      inventoryBuilding: inventory?.building ?? "MISSING",
    };
  });
}

await client.connect();
try {
  const before = await selectEvidence();
  console.table(summarize(before));
  if (!apply) {
    console.log("Dry run only. Re-run with --apply to update both inventories and create missing map nodes.");
    process.exitCode = 0;
  } else {
    await mkdir(backupDirectory, { recursive: true });
    await writeFile(
      path.join(backupDirectory, "before.json"),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), ...before }, null, 2)}\n`,
      "utf8",
    );

    await client.query("BEGIN");
    try {
      for (const [hostname, building] of assignments) {
        await client.query(
          "UPDATE network_switches SET building = $2, updated_at = now() WHERE lower(hostname) = $1",
          [hostname, building],
        );
        await client.query(
          "UPDATE net_nodes SET building = $2, updated_at = now() WHERE lower(hostname) = $1",
          [hostname, building],
        );
      }

      await client.query(
        `INSERT INTO net_nodes (
          hostname, display_name, node_kind, vendor, model, mgmt_ip, building,
          location, role, function, criticality, status, notes, created_at, updated_at
        )
        SELECT
          lower(regexp_replace(sw.hostname, '\\.sccc\\.edu$', '', 'i')),
          sw.hostname,
          'switch',
          CASE
            WHEN coalesce(sw.model, '') ~* 'cisco|nexus' THEN 'Cisco'
            WHEN coalesce(sw.model, '') ~* 'aruba|hpe|jl[0-9]+' THEN 'Aruba'
            WHEN coalesce(sw.model, '') ~* 'fortinet|fortigate' THEN 'Fortinet'
            ELSE NULL
          END,
          sw.model,
          nullif(sw.ip_address, ''),
          CASE lower(sw.hostname)
            WHEN 'sw-sa208' THEN 'Student Activities'
            WHEN 'sugymcam' THEN 'Student Activities'
            WHEN 'sw-sa208-replay' THEN 'Student Activities'
            WHEN 'swa-su121' THEN 'Student Union'
            WHEN 'sw-cafe' THEN 'Student Union'
          END,
          sw.location,
          'access',
          CASE WHEN lower(sw.hostname) IN ('sw-sa208', 'sugymcam', 'sw-sa208-replay')
            THEN 'student_activities' ELSE 'student_union' END,
          'medium',
          sw.status,
          sw.notes,
          now(),
          now()
        FROM network_switches sw
        WHERE lower(sw.hostname) = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM net_nodes node WHERE lower(node.hostname) = lower(sw.hostname)
          )`,
        [names],
      );

      for (const building of ["Student Activities", "Student Union"]) {
        await client.query(
          `INSERT INTO network_layout_positions (node_id, x, y, width, height, updated_at, updated_by)
           VALUES ($1, 0, 0, NULL, NULL, now(), NULL)
           ON CONFLICT (node_id) DO NOTHING`,
          [`building-master:${encodeURIComponent(building)}`],
        );
      }

      const legacyCounts = await client.query(
        `SELECT
          (SELECT count(*)::int FROM net_nodes WHERE building = $1) AS nodes,
          (SELECT count(*)::int FROM network_switches WHERE building = $1) AS switches,
          (SELECT count(*)::int FROM vlans WHERE building = $1) AS vlans`,
        ["Student Union / Student Activities"],
      );
      const counts = legacyCounts.rows[0];
      if (counts.nodes === 0 && counts.switches === 0 && counts.vlans === 0) {
        await client.query(
          "DELETE FROM network_layout_positions WHERE node_id = $1",
          [`building-master:${encodeURIComponent("Student Union / Student Activities")}`],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const after = await selectEvidence();
    const summary = summarize(after);
    const invalid = summary.filter(
      (row) => row.nodeBuilding !== row.expected || row.inventoryBuilding !== row.expected,
    );
    if (invalid.length > 0) throw new Error(`Post-change validation failed for ${invalid.length} device(s)`);

    await writeFile(
      path.join(backupDirectory, "after.json"),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), ...after }, null, 2)}\n`,
      "utf8",
    );
    console.table(summary);
    console.log(`Applied successfully. Before/after evidence: ${backupDirectory}`);
  }
} finally {
  await client.end();
}
