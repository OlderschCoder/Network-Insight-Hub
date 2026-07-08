/**
 * import_lldp_neighbors.ts
 * Parses LLDP/CDP neighbor output files from seeds/device-configs/
 * and upserts net_links rows.
 *
 * Run:
 *   DATABASE_URL="postgres://sccc:a-strong-password@localhost:5432/sccc_it" \
 *   npx tsx artifacts/api-server/src/seeds/import_lldp_neighbors.ts
 *
 * Safe to re-run — uses ON CONFLICT DO UPDATE so existing links are refreshed.
 * Only touches links where both endpoints exist in net_nodes.
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, "device-configs");
const DB_URL = process.env.DATABASE_URL!;
const DRY_RUN = process.argv.includes("--dry-run");

if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
if (DRY_RUN) console.log("DRY RUN — no writes\n");

const pool = new pg.Pool({ connectionString: DB_URL });
const query = (text: string, params?: unknown[]) => pool.query(text, params);

// ── Hostname canonicalisation ──────────────────────────────────────────────

function canonHostname(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\.sccc\.edu$/i, "")
    .replace(/\.local$/i, "")
    .trim();
}

// ── Speed parsing ──────────────────────────────────────────────────────────

function parseSpeed(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/(\d+)\s*(G|M|K)?bps?/i);
  if (!m) return null;
  const n = parseInt(m[1]);
  const u = (m[2] || "M").toUpperCase();
  if (u === "G") return n * 1000;
  if (u === "K") return Math.round(n / 1000);
  return n;
}

// ── Aruba AOS-CX LLDP parser ──────────────────────────────────────────────
// Output format:
//   Local Port   : 1/1/49
//   ...
//   System Name  : swa-aa105.sccc.edu
//   Port ID      : 1/1/51

interface LLDPEntry {
  localPort: string;
  remoteHostname: string;
  remotePort: string;
  speed: number | null;
  confidence: "confirmed_lldp" | "confirmed_cdp";
}

function parseArubaLldp(text: string): LLDPEntry[] {
  const entries: LLDPEntry[] = [];
  // Split on "Local Port" blocks
  const blocks = text.split(/(?=^\s*Local Port\s*:)/m);
  for (const block of blocks) {
    const localPort  = block.match(/Local Port\s*:\s*(\S+)/i)?.[1];
    const sysName    = block.match(/System Name\s*:\s*(\S+)/i)?.[1];
    const portId     = block.match(/Port ID\s*:\s*(\S+)/i)?.[1];
    const speedStr   = block.match(/Link Speed\s*:\s*(\S+)/i)?.[1];

    if (!localPort || !sysName || !portId) continue;
    const remoteHostname = canonHostname(sysName);
    if (!remoteHostname || remoteHostname === "unknown") continue;

    entries.push({
      localPort,
      remoteHostname,
      remotePort: portId,
      speed: parseSpeed(speedStr),
      confidence: "confirmed_lldp",
    });
  }
  return entries;
}

// ── Cisco Nexus/IOS LLDP parser ───────────────────────────────────────────
// show lldp neighbors detail blocks start with "---" separator

function parseCiscoLldp(text: string): LLDPEntry[] {
  const entries: LLDPEntry[] = [];
  const blocks = text.split(/^-{3,}/m);
  for (const block of blocks) {
    const localPort  = block.match(/Local\s+Intf(?:erface)?\s*[:\-]\s*(\S+)/i)?.[1];
    const sysName    = block.match(/System\s+Name\s*[:\-]\s*(\S+)/i)?.[1];
    const portId     = block.match(/Port\s+id(?:entifier)?\s*[:\-]\s*(\S+)/i)?.[1];
    const speedStr   = block.match(/(\d+[GMK]?bps)/i)?.[1];

    if (!localPort || !sysName || !portId) continue;
    const remoteHostname = canonHostname(sysName);
    if (!remoteHostname || remoteHostname === "unknown") continue;

    entries.push({
      localPort,
      remoteHostname,
      remotePort: portId,
      speed: parseSpeed(speedStr),
      confidence: "confirmed_lldp",
    });
  }
  return entries;
}

// ── Cisco CDP parser ──────────────────────────────────────────────────────

function parseCiscoCdp(text: string): LLDPEntry[] {
  const entries: LLDPEntry[] = [];
  const blocks = text.split(/^-{3,}/m);
  for (const block of blocks) {
    const device     = block.match(/Device\s+ID\s*[:\-]\s*(\S+)/i)?.[1];
    const localPort  = block.match(/Interface\s*[:\-]\s*(\S+)/i)?.[1];
    const remotePort = block.match(/Port\s+ID\s*\(outgoing\s+port\)\s*[:\-]\s*(\S+)/i)?.[1];

    if (!device || !localPort || !remotePort) continue;
    const remoteHostname = canonHostname(device);
    if (!remoteHostname) continue;

    entries.push({
      localPort,
      remoteHostname,
      remotePort,
      speed: null,
      confidence: "confirmed_cdp",
    });
  }
  return entries;
}

// ── Main parser dispatcher ────────────────────────────────────────────────

function parseFile(filename: string, content: string): LLDPEntry[] {
  const entries: LLDPEntry[] = [];
  const sections = content.split(/^---\s+(.+?)\s+---$/m);

  // Try per-section parsing
  for (let i = 1; i < sections.length; i += 2) {
    const cmd  = sections[i]?.trim() ?? "";
    const body = sections[i + 1] ?? "";
    if (/show lldp neighbors detail/i.test(cmd)) {
      if (/Local Port\s*:/i.test(body)) {
        entries.push(...parseArubaLldp(body));
      } else {
        entries.push(...parseCiscoLldp(body));
      }
    } else if (/show cdp neighbors detail/i.test(cmd)) {
      entries.push(...parseCiscoCdp(body));
    }
  }

  // Fallback: no section markers — try both parsers on full content
  if (entries.length === 0) {
    if (/Local Port\s*:/i.test(content)) {
      entries.push(...parseArubaLldp(content));
    } else if (/System Name/i.test(content)) {
      entries.push(...parseCiscoLldp(content));
    }
  }

  return entries;
}

// ── Dedup: keep one entry per (localPort, remoteHostname) pair ────────────

function dedup(entries: LLDPEntry[]): LLDPEntry[] {
  const seen = new Map<string, LLDPEntry>();
  for (const e of entries) {
    const key = `${e.localPort}|${e.remoteHostname}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()];
}

// ── DB upsert ─────────────────────────────────────────────────────────────

async function upsertLink(
  aHostname: string,
  entry: LLDPEntry,
  evidenceRef: string
): Promise<"inserted" | "updated" | "skipped" | "no_node"> {
  const aRes = await query("SELECT id FROM net_nodes WHERE hostname = $1 LIMIT 1", [aHostname]);
  const aNode = aRes.rows[0];
  if (!aNode) return "no_node";

  const bRes = await query("SELECT id FROM net_nodes WHERE hostname = $1 LIMIT 1", [entry.remoteHostname]);
  const bNode = bRes.rows[0];
  if (!bNode) return "no_node";

  if (aNode.id === bNode.id) return "skipped";

  const exRes = await query(`
    SELECT id FROM net_links
    WHERE (a_node_id = $1 AND b_node_id = $2 AND a_port = $3)
       OR (a_node_id = $2 AND b_node_id = $1 AND b_port = $3)
    LIMIT 1
  `, [aNode.id, bNode.id, entry.localPort]);
  const existing = exRes.rows[0];

  if (existing) {
    if (!DRY_RUN) {
      await query(`
        UPDATE net_links SET
          confidence       = $1,
          last_verified_at = NOW(),
          evidence_ref     = $2,
          speed_mbps       = COALESCE($3, speed_mbps)
        WHERE id = $4
      `, [entry.confidence, evidenceRef, entry.speed ?? null, existing.id]);
    }
    return "updated";
  }

  if (!DRY_RUN) {
    await query(`
      INSERT INTO net_links
        (id, a_node_id, a_port, b_node_id, b_port, link_kind, speed_mbps,
         confidence, last_verified_at, evidence_ref)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, 'fiber', $5, $6, NOW(), $7)
    `, [aNode.id, entry.localPort, bNode.id, entry.remotePort,
        entry.speed ?? null, entry.confidence, evidenceRef]);
  }
  return "inserted";
}

// ── Entry point ───────────────────────────────────────────────────────────

const stats = { inserted: 0, updated: 0, skipped: 0, no_node: 0, files: 0 };

const files = readdirSync(CONFIG_DIR)
  .filter(f => f.endsWith(".sccc.edu"))
  .sort();

for (const filename of files) {
  const content = readFileSync(join(CONFIG_DIR, filename), "utf-8");

  // Skip error markers and empty files
  if (content.startsWith("# COLLECTION FAILED") || content.trim().length < 20) continue;

  // Derive local hostname from filename
  const localHostname = canonHostname(filename.replace(/\.sccc\.edu$/, ""));

  const entries = dedup(parseFile(filename, content));
  if (entries.length === 0) continue;

  stats.files++;
  console.log(`► ${filename}  (${localHostname})  →  ${entries.length} neighbor(s)`);

  const evidenceRef = `lldp-collect-${new Date().toISOString().slice(0, 10)}`;

  for (const entry of entries) {
    const result = await upsertLink(localHostname, entry, evidenceRef);
    stats[result]++;
    const icon = result === "inserted" ? "  +" : result === "updated" ? "  ~" : "  -";
    console.log(`${icon} ${entry.localPort} → ${entry.remoteHostname}:${entry.remotePort}  [${result}]`);
  }
}

console.log("\n════════════════════════════════════════");
console.log(`Files parsed : ${stats.files}`);
console.log(`Links inserted: ${stats.inserted}`);
console.log(`Links updated : ${stats.updated}`);
console.log(`Skipped       : ${stats.skipped}`);
console.log(`No node match : ${stats.no_node}  ← add missing nodes to net_nodes`);

await pool.end();
