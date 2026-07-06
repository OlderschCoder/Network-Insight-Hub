/**
 * One-shot import: loads config files → device_configs, network_switches, vlans.
 *
 * Run on the appserver after DB migration:
 *   cd /opt/sccc-it
 *   npx tsx artifacts/api-server/src/seeds/import_device_configs.ts
 *
 * Safe to re-run — skips already-imported configs, updates existing switch/VLAN
 * records only when data improves them (doesn't overwrite manual edits to notes).
 *
 * Pass --dry-run to preview without writing anything.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db, deviceConfigsTable, networkSwitchesTable, vlansTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { parseDeviceConfig, cleanConfig, type ParsedVlan } from "./config_parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, "device-configs");
const DRY_RUN = process.argv.includes("--dry-run");

if (DRY_RUN) console.log("🔍 DRY RUN — no database writes\n");

// ── Counters ─────────────────────────────────────────────────────────────────

const stats = {
  configs: { inserted: 0, skipped: 0, failed: 0 },
  switches: { created: 0, updated: 0, skipped: 0 },
  vlans: { created: 0, updated: 0, skipped: 0 },
};

// ── Step 1: store raw config ──────────────────────────────────────────────────

async function importConfig(filename: string, raw: string, parsed: ReturnType<typeof parseDeviceConfig>) {
  const existing = await db
    .select({ id: deviceConfigsTable.id })
    .from(deviceConfigsTable)
    .where(eq(deviceConfigsTable.filename, filename));

  if (existing.length > 0) {
    console.log(`  SKIP  config  ${filename} (id=${existing[0].id} already imported)`);
    stats.configs.skipped++;
    return existing[0].id;
  }

  const content = cleanConfig(raw);
  const sizeBytes = Buffer.byteLength(content, "utf8");
  const notes = [
    parsed.firmwareVersion ? `Firmware: ${parsed.firmwareVersion}` : null,
    `Format: ${parsed.format}`,
    `Imported from backup`,
  ].filter(Boolean).join(" — ");

  if (DRY_RUN) {
    console.log(`  DRY   config  ${filename} → ${parsed.hostname} [${parsed.format}] ${Math.round(sizeBytes / 1024)}KB`);
    stats.configs.inserted++;
    return -1;
  }

  try {
    const [row] = await db
      .insert(deviceConfigsTable)
      .values({ deviceName: parsed.hostname, deviceType: parsed.format === "cisco-ios" ? "other" : "aruba", filename, content, notes, sizeBytes })
      .returning({ id: deviceConfigsTable.id });
    console.log(`  OK    config  ${filename} → ${parsed.hostname} [${parsed.format}] ${Math.round(sizeBytes / 1024)}KB (id=${row.id})`);
    stats.configs.inserted++;
    return row.id;
  } catch (err) {
    console.error(`  FAIL  config  ${filename}:`, err);
    stats.configs.failed++;
    return -1;
  }
}

// ── Step 2: upsert switch record ─────────────────────────────────────────────

async function upsertSwitch(parsed: ReturnType<typeof parseDeviceConfig>) {
  const hostname = parsed.hostname;
  // Match case-insensitively
  const existing = await db
    .select()
    .from(networkSwitchesTable);

  const match = existing.find(s => s.hostname.toLowerCase() === hostname.toLowerCase());

  const updates: Record<string, any> = {};
  if (parsed.model && !match?.model) updates.model = parsed.model;
  if (parsed.ipAddress && parsed.ipAddress !== "0.0.0.0" && (!match?.ipAddress || match.ipAddress === "unknown" || match.ipAddress === "0.0.0.0")) {
    updates.ipAddress = parsed.ipAddress;
  }
  if (parsed.building && (!match?.building || match.building === "Unknown")) {
    updates.building = parsed.building;
  }
  // Stamp firmware version in notes if not already there
  if (parsed.firmwareVersion && match && !(match.notes ?? "").includes(parsed.firmwareVersion)) {
    updates.notes = [(match.notes ?? "").trim(), `Firmware: ${parsed.firmwareVersion}`].filter(Boolean).join("\n");
  }

  if (!match) {
    if (DRY_RUN) {
      console.log(`  DRY   switch  CREATE ${hostname} → ${parsed.building} ${parsed.ipAddress}`);
      stats.switches.created++;
      return;
    }
    await db.insert(networkSwitchesTable).values({
      hostname,
      building: parsed.building,
      ipAddress: parsed.ipAddress !== "0.0.0.0" ? parsed.ipAddress : "unknown",
      model: parsed.model ?? undefined,
      status: "unknown",
      notes: parsed.firmwareVersion ? `Firmware: ${parsed.firmwareVersion}` : undefined,
    });
    console.log(`  OK    switch  CREATE ${hostname} → ${parsed.building} ${parsed.ipAddress}`);
    stats.switches.created++;
  } else if (Object.keys(updates).length > 0) {
    if (DRY_RUN) {
      console.log(`  DRY   switch  UPDATE ${hostname} → ${JSON.stringify(updates)}`);
      stats.switches.updated++;
      return;
    }
    await db.update(networkSwitchesTable).set({ ...updates, updatedAt: new Date() }).where(eq(networkSwitchesTable.id, match.id));
    console.log(`  OK    switch  UPDATE ${hostname} → ${Object.keys(updates).join(", ")}`);
    stats.switches.updated++;
  } else {
    console.log(`  SKIP  switch  ${hostname} (no new data)`);
    stats.switches.skipped++;
  }
}

// ── Step 3: upsert VLANs ─────────────────────────────────────────────────────

async function upsertVlans(parsed: ReturnType<typeof parseDeviceConfig>) {
  const existingVlans = await db.select().from(vlansTable);
  const existingMap = new Map(existingVlans.map(v => [`${v.vlanId}:${v.building}`, v]));

  for (const vlan of parsed.vlans) {
    if (vlan.vlanId <= 0 || vlan.vlanId > 4094) continue;
    // Skip placeholder VLANs with no real name
    if (vlan.name === `VLAN${vlan.vlanId}` && !vlan.subnet && !vlan.gateway) continue;

    const key = `${vlan.vlanId}:${parsed.building}`;
    const existing = existingMap.get(key);
    // Also check if any vlan with this ID exists (different building scope)
    const anyExisting = existingVlans.find(v => v.vlanId === vlan.vlanId);

    if (!existing && !anyExisting) {
      // New VLAN — create
      if (DRY_RUN) {
        console.log(`  DRY   vlan   CREATE ${vlan.vlanId} "${vlan.name}" [${vlan.type}] ${vlan.subnet ?? ""}`);
        stats.vlans.created++;
        continue;
      }
      await db.insert(vlansTable).values({
        vlanId: vlan.vlanId,
        name: vlan.name,
        description: vlan.description ?? undefined,
        building: parsed.building,
        type: vlan.type,
        subnet: vlan.subnet ?? undefined,
        gateway: vlan.gateway ?? undefined,
        notes: `Auto-imported from ${parsed.hostname} config`,
      });
      console.log(`  OK    vlan   CREATE ${vlan.vlanId} "${vlan.name}" [${vlan.type}] ${vlan.subnet ?? ""}`);
      stats.vlans.created++;
    } else if (existing) {
      // Existing VLAN for this building — update if we have better data
      const updates: Record<string, any> = {};
      if (vlan.subnet && !existing.subnet) updates.subnet = vlan.subnet;
      if (vlan.gateway && !existing.gateway) updates.gateway = vlan.gateway;
      if (vlan.description && !existing.description) updates.description = vlan.description;
      if (vlan.name && existing.name === `VLAN${vlan.vlanId}`) updates.name = vlan.name;

      if (Object.keys(updates).length > 0) {
        if (DRY_RUN) {
          console.log(`  DRY   vlan   UPDATE ${vlan.vlanId} → ${JSON.stringify(updates)}`);
          stats.vlans.updated++;
          continue;
        }
        await db.update(vlansTable).set(updates).where(eq(vlansTable.id, existing.id));
        console.log(`  OK    vlan   UPDATE ${vlan.vlanId} "${vlan.name}" → ${Object.keys(updates).join(", ")}`);
        stats.vlans.updated++;
      } else {
        stats.vlans.skipped++;
      }
    } else if (anyExisting) {
      // VLAN exists under a different building — update subnet/gateway/name if missing
      const updates: Record<string, any> = {};
      if (vlan.subnet && !anyExisting.subnet) updates.subnet = vlan.subnet;
      if (vlan.gateway && !anyExisting.gateway) updates.gateway = vlan.gateway;
      if (vlan.description && !anyExisting.description) updates.description = vlan.description;

      if (Object.keys(updates).length > 0) {
        if (!DRY_RUN) {
          await db.update(vlansTable).set(updates).where(eq(vlansTable.id, anyExisting.id));
        }
        console.log(`  OK    vlan   ENRICH ${vlan.vlanId} from ${parsed.hostname} → ${Object.keys(updates).join(", ")}`);
        stats.vlans.updated++;
      } else {
        stats.vlans.skipped++;
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const files = readdirSync(CONFIG_DIR)
    .filter(f => statSync(join(CONFIG_DIR, f)).isFile() && !f.startsWith("."))
    .sort();

  console.log(`Found ${files.length} config files\n${"─".repeat(60)}`);

  for (const filename of files) {
    console.log(`\n► ${filename}`);
    const raw = readFileSync(join(CONFIG_DIR, filename), "utf8");

    let parsed: ReturnType<typeof parseDeviceConfig>;
    try {
      parsed = parseDeviceConfig(raw);
    } catch (err) {
      console.error(`  FAIL  parse  ${filename}:`, err);
      stats.configs.failed++;
      continue;
    }

    console.log(`  HOST  ${parsed.hostname}  [${parsed.format}]  building=${parsed.building}  ip=${parsed.ipAddress}  vlans=${parsed.vlans.length}`);

    await importConfig(filename, raw, parsed);
    await upsertSwitch(parsed);
    await upsertVlans(parsed);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Configs  — inserted: ${stats.configs.inserted}, skipped: ${stats.configs.skipped}, failed: ${stats.configs.failed}`);
  console.log(`Switches — created:  ${stats.switches.created},  updated: ${stats.switches.updated},  skipped: ${stats.switches.skipped}`);
  console.log(`VLANs    — created:  ${stats.vlans.created},  updated: ${stats.vlans.updated},  skipped: ${stats.vlans.skipped}`);

  process.exit(stats.configs.failed > 0 ? 1 : 0);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
