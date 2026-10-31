import { pool } from "@workspace/db";
import { ensureSchema } from "../artifacts/api-server/src/lib/ensure_schema";
import { executeCollectLldpFromNoc } from "../artifacts/api-server/src/lib/ai_knowledge";

async function main(): Promise<void> {
  try {
    await ensureSchema();
    const result = await executeCollectLldpFromNoc(JSON.stringify({ confirm: true }), "cio");
    process.stdout.write(`${result}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
