import { importFormalEaDocument } from "../lib/formal_ea";
import { pool } from "@workspace/db";

function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const markdownPath = argument("markdown");
if (!markdownPath)
  throw new Error(
    "Usage: pnpm import:formal-ea -- --markdown <file.md> [--word <file.docx>] [--imported-by-name <name>] [--storage-dir <dir>]",
  );

try {
  const result = await importFormalEaDocument({
    markdownPath,
    wordPath: argument("word"),
    importedByName: argument("imported-by-name") || "Office of the CIO",
    storageDir: argument("storage-dir") || undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await pool.end();
}
