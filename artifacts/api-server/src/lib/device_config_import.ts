import { readFileSync, readdirSync, statSync } from "fs";
import { db, deviceConfigsTable, networkSwitchesTable, vlansTable } from "@workspace/db";
import { voiceVlanAuthority } from "./voice_vlan_registry";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "url";
import { join } from "path";
import { cleanConfig, parseDeviceConfig } from "../seeds/config_parser.js";

const DEFAULT_CONFIG_DIR = fileURLToPath(new URL("../seeds/device-configs", import.meta.url));

export interface DeviceConfigImportStats {
  configs: { inserted: number; skipped: number; failed: number };
  switches: { created: number; updated: number; skipped: number };
  vlans: { created: number; updated: number; skipped: number };
}

export interface DeviceConfigImportResult {
  configDir: string;
  dryRun: boolean;
  filesScanned: number;
  stats: DeviceConfigImportStats;
  logs: string[];
}

interface ImportContext {
  dryRun: boolean;
  stats: DeviceConfigImportStats;
  log: (line: string) => void;
}

type ParsedConfig = ReturnType<typeof parseDeviceConfig>;

function createStats(): DeviceConfigImportStats {
  return {
    configs: { inserted: 0, skipped: 0, failed: 0 },
    switches: { created: 0, updated: 0, skipped: 0 },
    vlans: { created: 0, updated: 0, skipped: 0 },
  };
}

async function importConfig(
  ctx: ImportContext,
  filename: string,
  raw: string,
  parsed: ParsedConfig,
) {
  const existing = await db
    .select({ id: deviceConfigsTable.id })
    .from(deviceConfigsTable)
    .where(eq(deviceConfigsTable.filename, filename));

  if (existing.length > 0) {
    ctx.log(`  SKIP  config  ${filename} (id=${existing[0].id} already imported)`);
    ctx.stats.configs.skipped++;
    return existing[0].id;
  }

  const content = cleanConfig(raw);
  const sizeBytes = Buffer.byteLength(content, "utf8");
  const notes = [
    parsed.firmwareVersion ? `Firmware: ${parsed.firmwareVersion}` : null,
    `Format: ${parsed.format}`,
    "Imported from backup",
  ].filter(Boolean).join(" -- ");

  if (ctx.dryRun) {
    ctx.log(`  DRY   config  ${filename} -> ${parsed.hostname} [${parsed.format}] ${Math.round(sizeBytes / 1024)}KB`);
    ctx.stats.configs.inserted++;
    return -1;
  }

  try {
    const [row] = await db
      .insert(deviceConfigsTable)
      .values({
        deviceName: parsed.hostname,
        deviceType: parsed.format === "cisco-ios" ? "other" : "aruba",
        filename,
        content,
        notes,
        sizeBytes,
      })
      .returning({ id: deviceConfigsTable.id });
    ctx.log(`  OK    config  ${filename} -> ${parsed.hostname} [${parsed.format}] ${Math.round(sizeBytes / 1024)}KB (id=${row.id})`);
    ctx.stats.configs.inserted++;
    return row.id;
  } catch (err) {
    ctx.log(`  FAIL  config  ${filename}: ${err instanceof Error ? err.message : String(err)}`);
    ctx.stats.configs.failed++;
    return -1;
  }
}

async function upsertSwitch(ctx: ImportContext, parsed: ParsedConfig) {
  const hostname = parsed.hostname;
  const existing = await db.select().from(networkSwitchesTable);
  const match = existing.find((row) => row.hostname.toLowerCase() === hostname.toLowerCase());

  const updates: Record<string, unknown> = {};
  if (parsed.model && !match?.model) updates.model = parsed.model;
  if (
    parsed.ipAddress &&
    parsed.ipAddress !== "0.0.0.0" &&
    (!match?.ipAddress || match.ipAddress === "unknown" || match.ipAddress === "0.0.0.0")
  ) {
    updates.ipAddress = parsed.ipAddress;
  }
  if (parsed.building && (!match?.building || match.building === "Unknown")) {
    updates.building = parsed.building;
  }
  if (parsed.firmwareVersion && match && !(match.notes ?? "").includes(parsed.firmwareVersion)) {
    updates.notes = [(match.notes ?? "").trim(), `Firmware: ${parsed.firmwareVersion}`]
      .filter(Boolean)
      .join("\n");
  }

  if (!match) {
    if (ctx.dryRun) {
      ctx.log(`  DRY   switch  CREATE ${hostname} -> ${parsed.building} ${parsed.ipAddress}`);
      ctx.stats.switches.created++;
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
    ctx.log(`  OK    switch  CREATE ${hostname} -> ${parsed.building} ${parsed.ipAddress}`);
    ctx.stats.switches.created++;
    return;
  }

  if (Object.keys(updates).length === 0) {
    ctx.log(`  SKIP  switch  ${hostname} (no new data)`);
    ctx.stats.switches.skipped++;
    return;
  }

  if (ctx.dryRun) {
    ctx.log(`  DRY   switch  UPDATE ${hostname} -> ${JSON.stringify(updates)}`);
    ctx.stats.switches.updated++;
    return;
  }

  await db
    .update(networkSwitchesTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(networkSwitchesTable.id, match.id));
  ctx.log(`  OK    switch  UPDATE ${hostname} -> ${Object.keys(updates).join(", ")}`);
  ctx.stats.switches.updated++;
}

async function upsertVlans(ctx: ImportContext, parsed: ParsedConfig) {
  const existingVlans = await db.select().from(vlansTable);
  const existingMap = new Map(existingVlans.map((vlan) => [`${vlan.vlanId}:${vlan.building}`, vlan]));

  for (const vlan of parsed.vlans) {
    if (vlan.vlanId <= 0 || vlan.vlanId > 4094) continue;
    if (vlan.name === `VLAN${vlan.vlanId}` && !vlan.subnet && !vlan.gateway) continue;

    const authority = voiceVlanAuthority(vlan.vlanId);
    const targetBuilding = authority?.building ?? parsed.building;
    const targetType = authority?.type ?? vlan.type;
    const key = `${vlan.vlanId}:${targetBuilding}`;
    const existing = existingMap.get(key);
    const anyExisting = existingVlans.find((row) => row.vlanId === vlan.vlanId);

    if (!existing && !anyExisting) {
      if (ctx.dryRun) {
        ctx.log(`  DRY   vlan   CREATE ${vlan.vlanId} "${vlan.name}" [${vlan.type}] ${vlan.subnet ?? ""}`);
        ctx.stats.vlans.created++;
        continue;
      }
      await db.insert(vlansTable).values({
        vlanId: vlan.vlanId,
        name: vlan.name,
        description: vlan.description ?? undefined,
        building: targetBuilding,
        type: targetType,
        subnet: vlan.subnet ?? undefined,
        gateway: vlan.gateway ?? undefined,
        notes: `Auto-imported from ${parsed.hostname} config`,
      });
      ctx.log(`  OK    vlan   CREATE ${vlan.vlanId} "${vlan.name}" [${vlan.type}] ${vlan.subnet ?? ""}`);
      ctx.stats.vlans.created++;
      continue;
    }

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (authority && existing.building !== targetBuilding) updates.building = targetBuilding;
      if (authority && existing.type !== targetType) updates.type = targetType;
      if (vlan.subnet && !existing.subnet) updates.subnet = vlan.subnet;
      if (vlan.gateway && !existing.gateway) updates.gateway = vlan.gateway;
      if (vlan.description && !existing.description) updates.description = vlan.description;
      if (vlan.name && existing.name === `VLAN${vlan.vlanId}`) updates.name = vlan.name;

      if (Object.keys(updates).length === 0) {
        ctx.stats.vlans.skipped++;
        continue;
      }

      if (ctx.dryRun) {
        ctx.log(`  DRY   vlan   UPDATE ${vlan.vlanId} -> ${JSON.stringify(updates)}`);
        ctx.stats.vlans.updated++;
        continue;
      }

      await db.update(vlansTable).set(updates).where(eq(vlansTable.id, existing.id));
      ctx.log(`  OK    vlan   UPDATE ${vlan.vlanId} "${vlan.name}" -> ${Object.keys(updates).join(", ")}`);
      ctx.stats.vlans.updated++;
      continue;
    }

    const updates: Record<string, unknown> = {};
    if (authority && anyExisting?.building !== targetBuilding) updates.building = targetBuilding;
    if (authority && anyExisting?.type !== targetType) updates.type = targetType;
    if (vlan.subnet && !anyExisting?.subnet) updates.subnet = vlan.subnet;
    if (vlan.gateway && !anyExisting?.gateway) updates.gateway = vlan.gateway;
    if (vlan.description && !anyExisting?.description) updates.description = vlan.description;

    if (Object.keys(updates).length === 0 || !anyExisting) {
      ctx.stats.vlans.skipped++;
      continue;
    }

    if (!ctx.dryRun) {
      await db.update(vlansTable).set(updates).where(eq(vlansTable.id, anyExisting.id));
    }
    ctx.log(`  OK    vlan   ENRICH ${vlan.vlanId} from ${parsed.hostname} -> ${Object.keys(updates).join(", ")}`);
    ctx.stats.vlans.updated++;
  }
}

export async function runDeviceConfigImport(
  options: { configDir?: string; dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<DeviceConfigImportResult> {
  const dryRun = options.dryRun === true;
  const configDir = options.configDir ?? DEFAULT_CONFIG_DIR;
  const logs: string[] = [];
  const log = (line: string) => {
    logs.push(line);
    options.log?.(line);
  };
  const ctx: ImportContext = { dryRun, stats: createStats(), log };

  if (dryRun) log("DRY RUN -- no database writes");

  const files = readdirSync(configDir)
    .filter((file) => statSync(join(configDir, file)).isFile() && !file.startsWith("."))
    .sort();

  log(`Found ${files.length} config files`);

  for (const filename of files) {
    log(``);
    log(`> ${filename}`);
    const raw = readFileSync(join(configDir, filename), "utf8");

    let parsed: ParsedConfig;
    try {
      parsed = parseDeviceConfig(raw);
    } catch (err) {
      log(`  FAIL  parse  ${filename}: ${err instanceof Error ? err.message : String(err)}`);
      ctx.stats.configs.failed++;
      continue;
    }

    log(
      `  HOST  ${parsed.hostname} [${parsed.format}] building=${parsed.building} ip=${parsed.ipAddress} vlans=${parsed.vlans.length}`,
    );

    await importConfig(ctx, filename, raw, parsed);
    await upsertSwitch(ctx, parsed);
    await upsertVlans(ctx, parsed);
  }

  log("");
  log(
    `Configs  -- inserted: ${ctx.stats.configs.inserted}, skipped: ${ctx.stats.configs.skipped}, failed: ${ctx.stats.configs.failed}`,
  );
  log(
    `Switches -- created: ${ctx.stats.switches.created}, updated: ${ctx.stats.switches.updated}, skipped: ${ctx.stats.switches.skipped}`,
  );
  log(
    `VLANs    -- created: ${ctx.stats.vlans.created}, updated: ${ctx.stats.vlans.updated}, skipped: ${ctx.stats.vlans.skipped}`,
  );

  return {
    configDir,
    dryRun,
    filesScanned: files.length,
    stats: ctx.stats,
    logs,
  };
}
