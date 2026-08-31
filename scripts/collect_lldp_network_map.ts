import { pool } from "@workspace/db";
import { ensureSchema } from "../artifacts/api-server/src/lib/ensure_schema";
import { collectLldpIntoNetworkMap } from "../artifacts/api-server/src/lib/lldp_map_collector";

try {
  await ensureSchema();
  const summary = await collectLldpIntoNetworkMap();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await pool.end();
}
