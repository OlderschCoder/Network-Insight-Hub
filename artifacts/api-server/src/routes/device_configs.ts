/**
 * Device Configuration Backup API
 * POST   /api/network/configs          — upload a config file
 * GET    /api/network/configs          — list all configs (metadata only)
 * GET    /api/network/configs/:id      — get a specific config (full content)
 * DELETE /api/network/configs/:id      — delete a config
 * GET    /api/network/switches/:id/configs — list configs for a specific switch
 */

import { Router } from "express";
import { db, deviceConfigsTable, vlansTable } from "@workspace/db";
import { netPortsTable } from "@workspace/db/net_ports";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import { cleanConfig, parseDeviceConfig, type ParsedSwitch } from "../seeds/config_parser.js";
import { saveNetNodeByIdentity, saveSwitchByIdentity } from "../lib/network_identity.js";

const router = Router();

// Only CIO and network roles can upload/delete configs
function requireNetworkRole(req: any, res: any, next: any) {
  const role = req.user?.role ?? "";
  if (!["cio", "network", "network_engineer"].includes(role)) {
    return res.status(403).json({ error: "Network role required to manage device configs" });
  }
  next();
}

function inferStoredDeviceType(filename: string, content: string, parsed?: ParsedSwitch | null) {
  if (parsed?.format === "aruba-cx") return "aruba";
  if (/fortigate|fortios|config-version=fg/i.test(filename + "\n" + content)) return "fortigate";
  if (/nexus|nx-os/i.test(filename + "\n" + content)) return "nexus";
  return "other";
}

function inferNodeProfile(hostname: string, model: string | null | undefined, deviceType: string) {
  let role: "core" | "distribution" | "access" | "edge" | "firewall" | "controller" | "svi" = "access";
  let nodeKind: "switch" | "firewall" | "router" | "server" | "svi" | "patch_panel" | "isp" | "other" = "switch";
  let criticality: "critical" | "high" | "medium" | "low" = "medium";
  const combined = `${hostname} ${model ?? ""} ${deviceType}`.toLowerCase();

  if (/fortigate|fgt|firewall/.test(combined)) {
    role = "edge";
    nodeKind = "firewall";
    criticality = "critical";
  } else if (/nexus|core|a48|a24|9[0-9]{3}/.test(combined)) {
    role = "core";
    criticality = "critical";
  } else if (/dist|distribution/.test(combined)) {
    role = "distribution";
    criticality = "high";
  }

  return { role, nodeKind, criticality };
}

async function upsertParsedVlans(parsed: ParsedSwitch, sourceLabel: string) {
  const existingVlans = await db.select().from(vlansTable);
  const existingByScopedKey = new Map(existingVlans.map((row) => [`${row.vlanId}:${row.building}`, row]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const vlan of parsed.vlans) {
    if (!vlan || vlan.vlanId <= 0 || vlan.vlanId > 4094) {
      skipped++;
      continue;
    }

    const scopedKey = `${vlan.vlanId}:${parsed.building}`;
    const exact = existingByScopedKey.get(scopedKey) ?? null;
    const anyExisting = existingVlans.find((row) => row.vlanId === vlan.vlanId) ?? null;

    if (!exact && !anyExisting) {
      await db.insert(vlansTable).values({
        vlanId: vlan.vlanId,
        name: vlan.name,
        description: vlan.description ?? undefined,
        building: parsed.building,
        type: vlan.type,
        subnet: vlan.subnet ?? undefined,
        gateway: vlan.gateway ?? undefined,
        notes: `Auto-imported from ${sourceLabel}`,
      });
      created++;
      continue;
    }

    const target = exact ?? anyExisting;
    if (!target) {
      skipped++;
      continue;
    }

    const updates: Record<string, unknown> = {};
    if (vlan.name && (!target.name || /^VLAN\d+$/i.test(target.name))) updates.name = vlan.name;
    if (vlan.description && !target.description) updates.description = vlan.description;
    if (vlan.subnet && !target.subnet) updates.subnet = vlan.subnet;
    if (vlan.gateway && !target.gateway) updates.gateway = vlan.gateway;
    if (exact == null && target.building === "Unknown" && parsed.building) updates.building = parsed.building;

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    await db.update(vlansTable).set(updates).where(eq(vlansTable.id, target.id));
    updated++;
  }

  return { created, updated, skipped };
}

async function upsertParsedPorts(parsed: ParsedSwitch, nodeId: string, sourceLabel: string) {
  let processed = 0;
  const now = new Date();
  for (const port of parsed.ports) {
    if (!port.interfaceName || port.interfaceName.length > 80) continue;
    const staticFields: Record<string, unknown> = {
      isPhysical: port.isPhysical,
      configEvidence: `config:${sourceLabel}`.slice(0, 300),
      configUpdatedAt: now,
      updatedAt: now,
    };
    if (port.description != null) staticFields.description = port.description;
    if (port.adminStatus != null) staticFields.adminStatus = port.adminStatus;
    if (port.speedMbps != null) staticFields.speedMbps = port.speedMbps;
    if (port.portMode !== "unknown") staticFields.portMode = port.portMode;
    if (port.nativeVlan != null) staticFields.nativeVlan = port.nativeVlan;
    if (port.allowedVlans != null) staticFields.allowedVlans = port.allowedVlans;
    if (port.portchannel != null) staticFields.portchannel = port.portchannel;
    if (port.vpcId != null) staticFields.vpcId = port.vpcId;

    await db
      .insert(netPortsTable)
      .values({
        nodeId,
        interfaceName: port.interfaceName,
        isPhysical: port.isPhysical,
        description: port.description,
        adminStatus: port.adminStatus,
        speedMbps: port.speedMbps,
        portMode: port.portMode === "unknown" ? null : port.portMode,
        nativeVlan: port.nativeVlan,
        allowedVlans: port.allowedVlans,
        portchannel: port.portchannel,
        vpcId: port.vpcId,
        configEvidence: `config:${sourceLabel}`.slice(0, 300),
        configUpdatedAt: now,
      })
      .onConflictDoUpdate({
        target: [netPortsTable.nodeId, netPortsTable.interfaceName],
        set: staticFields,
      });
    processed++;
  }
  return processed;
}

async function saveImportedConfigRecord(input: {
  filename: string;
  sanitizedContent: string;
  deviceName: string;
  deviceType: string;
  notes: string | null;
  switchId?: number | null;
  uploadedBy: number | null;
}) {
  const existing = await db.select().from(deviceConfigsTable).where(eq(deviceConfigsTable.filename, input.filename));
  const dupe = existing.find((row) => row.deviceName === input.deviceName && row.content.trim() === input.sanitizedContent.trim());
  if (dupe) {
    return { row: dupe, inserted: false as const };
  }

  const [row] = await db
    .insert(deviceConfigsTable)
    .values({
      switchId: input.switchId ?? null,
      deviceName: input.deviceName,
      deviceType: input.deviceType,
      filename: input.filename,
      content: input.sanitizedContent,
      notes: input.notes,
      sizeBytes: Buffer.byteLength(input.sanitizedContent, "utf8"),
      uploadedBy: input.uploadedBy,
    })
    .returning();
  return { row, inserted: true as const };
}

// ── Upload ────────────────────────────────────────────────────────────────────
router.post("/", requireAuth, requireNetworkRole, async (req, res) => {
  try {
    const {
      deviceName,
      deviceType = "other",
      filename,
      content,
      notes,
      switchId,
    } = req.body as {
      deviceName?: string;
      deviceType?: string;
      filename?: string;
      content?: string;
      notes?: string;
      switchId?: number;
    };

    if (!deviceName?.trim()) return res.status(400).json({ error: "deviceName is required" });
    if (!filename?.trim()) return res.status(400).json({ error: "filename is required" });
    if (!content?.trim()) return res.status(400).json({ error: "content is required" });

    const ALLOWED_TYPES = new Set(["fortigate", "aruba", "nexus", "other"]);
    const safeType = ALLOWED_TYPES.has(deviceType) ? deviceType : "other";
    const sizeBytes = Buffer.byteLength(content, "utf8");

    // Hard cap: 5MB per config
    if (sizeBytes > 5 * 1024 * 1024) {
      return res.status(413).json({ error: "Config file too large (max 5MB)" });
    }

    const [row] = await db
      .insert(deviceConfigsTable)
      .values({
        switchId: switchId ?? null,
        deviceName: deviceName.trim().slice(0, 200),
        deviceType: safeType,
        filename: filename.trim().slice(0, 300),
        content: content.trim(),
        notes: notes?.trim() ?? null,
        sizeBytes,
        uploadedBy: req.user?.id ?? null,
      })
      .returning();

    logger.info(
      { id: row.id, deviceName: row.deviceName, deviceType: row.deviceType, sizeBytes },
      "Device config uploaded",
    );

    return res.json({
      id: row.id,
      deviceName: row.deviceName,
      deviceType: row.deviceType,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt,
    });
  } catch (err) {
    logger.error({ err }, "Failed to upload device config");
    return res.status(500).json({ error: "Failed to save config" });
  }
});

router.post("/import-batch", requireAuth, requireNetworkRole, async (req: any, res) => {
  try {
    const { formidable } = await import("formidable");
    const fs = await import("node:fs/promises");
    const form = formidable({
      multiples: true,
      keepExtensions: true,
      allowEmptyFiles: false,
      maxFiles: 250,
      maxFileSize: 10 * 1024 * 1024,
      maxTotalFileSize: 750 * 1024 * 1024,
    });

    const [, uploaded] = await form.parse(req);
    const rawFiles = uploaded.files;
    const fileList = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
    if (fileList.length === 0) {
      return res.status(400).json({ error: "At least one file is required" });
    }

    const summary = {
      received: fileList.length,
      configsImported: 0,
      configsSkipped: 0,
      switchesCreated: 0,
      switchesUpdated: 0,
      nodesCreated: 0,
      nodesUpdated: 0,
      vlansCreated: 0,
      vlansUpdated: 0,
      portsImported: 0,
      unsupportedStored: 0,
      errors: [] as string[],
    };

    for (const file of fileList) {
      if (!file?.filepath || !file.originalFilename) continue;
      try {
        const raw = await fs.readFile(file.filepath, "utf8");
        const sanitized = cleanConfig(raw);
        const filename = file.originalFilename;

        let parsed: ParsedSwitch | null = null;
        try {
          parsed = parseDeviceConfig(raw);
          if (parsed.format === "unknown" || parsed.hostname === "unknown") parsed = null;
        } catch {
          parsed = null;
        }

        const deviceType = inferStoredDeviceType(filename, raw, parsed);
        let switchRow: { id: number } | null = null;
        let nodeAction: "created" | "updated" | "merged" | null = null;
        let switchAction: "created" | "updated" | "merged" | null = null;

        if (parsed) {
          const switchResult = await saveSwitchByIdentity({
            hostname: parsed.hostname,
            building: parsed.building,
            ipAddress: parsed.ipAddress,
            model: parsed.model ?? null,
            status: "online",
            notes: parsed.firmwareVersion ? `Firmware: ${parsed.firmwareVersion}` : null,
          });
          switchRow = switchResult.row;
          switchAction = switchResult.action;
          if (switchAction === "created") summary.switchesCreated++;
          else summary.switchesUpdated++;

          const profile = inferNodeProfile(parsed.hostname, parsed.model, deviceType);
          const nodeResult = await saveNetNodeByIdentity({
            hostname: parsed.hostname,
            displayName: parsed.hostname,
            nodeKind: profile.nodeKind,
            vendor: deviceType === "fortigate" ? "Fortinet" : deviceType === "aruba" ? "Aruba" : deviceType === "nexus" ? "Cisco" : null,
            model: parsed.model ?? null,
            mgmtIp: parsed.ipAddress,
            building: parsed.building,
            location: null,
            role: profile.role,
            criticality: profile.criticality,
            status: "online",
            notes: parsed.firmwareVersion ? `Firmware: ${parsed.firmwareVersion}` : null,
          });
          nodeAction = nodeResult.action;
          if (nodeAction === "created") summary.nodesCreated++;
          else summary.nodesUpdated++;

          const vlanSummary = await upsertParsedVlans(parsed, filename);
          summary.vlansCreated += vlanSummary.created;
          summary.vlansUpdated += vlanSummary.updated;
          summary.portsImported += await upsertParsedPorts(parsed, nodeResult.row.id, filename);
        } else {
          summary.unsupportedStored++;
        }

        const noteParts = [
          parsed?.firmwareVersion ? `Firmware: ${parsed.firmwareVersion}` : null,
          parsed ? `Format: ${parsed.format}` : `Type: ${deviceType}`,
          "Imported through batch upload",
        ].filter(Boolean);
        const configResult = await saveImportedConfigRecord({
          filename,
          sanitizedContent: sanitized,
          deviceName: parsed?.hostname ?? filename,
          deviceType,
          notes: noteParts.join(" — "),
          switchId: switchRow?.id ?? null,
          uploadedBy: req.user?.id ?? null,
        });

        if (configResult.inserted) summary.configsImported++;
        else summary.configsSkipped++;
      } catch (error: any) {
        const label = file.originalFilename ?? file.newFilename ?? "unknown-file";
        summary.errors.push(`${label}: ${error?.message ?? "unknown error"}`);
      }
    }

    logger.info({ userId: req.user?.id ?? null, summary }, "Imported device config batch");
    return res.json(summary);
  } catch (error: any) {
    logger.error({ err: error }, "Failed to import device config batch");
    const message = typeof error?.message === "string" ? error.message : "Failed to import config files";
    const status = /max/i.test(message) || /too large/i.test(message) ? 413 : 500;
    return res.status(status).json({ error: message });
  }
});

// ── List all configs (no content — metadata only) ─────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const { type, q } = req.query as { type?: string; q?: string };

    const rows = await db
      .select({
        id: deviceConfigsTable.id,
        switchId: deviceConfigsTable.switchId,
        deviceName: deviceConfigsTable.deviceName,
        deviceType: deviceConfigsTable.deviceType,
        filename: deviceConfigsTable.filename,
        notes: deviceConfigsTable.notes,
        sizeBytes: deviceConfigsTable.sizeBytes,
        uploadedBy: deviceConfigsTable.uploadedBy,
        createdAt: deviceConfigsTable.createdAt,
      })
      .from(deviceConfigsTable)
      .orderBy(desc(deviceConfigsTable.createdAt));

    let results = rows;
    if (type) results = results.filter((r) => r.deviceType === type);
    if (q) {
      const query = q.toLowerCase();
      results = results.filter(
        (r) =>
          r.deviceName.toLowerCase().includes(query) ||
          r.filename.toLowerCase().includes(query) ||
          (r.notes ?? "").toLowerCase().includes(query),
      );
    }

    return res.json(results);
  } catch (err) {
    logger.error({ err }, "Failed to list device configs");
    return res.status(500).json({ error: "Failed to list configs" });
  }
});

// ── Get single config (full content — network roles get full, others get redacted) ──
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [row] = await db
      .select()
      .from(deviceConfigsTable)
      .where(eq(deviceConfigsTable.id, id));

    if (!row) return res.status(404).json({ error: "Config not found" });

    const role = (req as any).user?.role ?? "";
    const canSeeSecrets = ["cio", "network", "network_engineer"].includes(role);

    // Redact secrets for non-network roles (display only — storage stays intact)
    let content = row.content;
    if (!canSeeSecrets) {
      content = redactConfigSecrets(content);
    }

    return res.json({ ...row, content });
  } catch (err) {
    logger.error({ err }, "Failed to get device config");
    return res.status(500).json({ error: "Failed to retrieve config" });
  }
});

// ── List configs for a specific switch ────────────────────────────────────────
router.get("/switch/:switchId", requireAuth, async (req, res) => {
  try {
    const switchId = parseInt(req.params.switchId, 10);
    if (isNaN(switchId)) return res.status(400).json({ error: "Invalid switchId" });

    const rows = await db
      .select({
        id: deviceConfigsTable.id,
        deviceName: deviceConfigsTable.deviceName,
        deviceType: deviceConfigsTable.deviceType,
        filename: deviceConfigsTable.filename,
        notes: deviceConfigsTable.notes,
        sizeBytes: deviceConfigsTable.sizeBytes,
        createdAt: deviceConfigsTable.createdAt,
      })
      .from(deviceConfigsTable)
      .where(eq(deviceConfigsTable.switchId, switchId))
      .orderBy(desc(deviceConfigsTable.createdAt));

    return res.json(rows);
  } catch (err) {
    logger.error({ err }, "Failed to list switch configs");
    return res.status(500).json({ error: "Failed to list configs" });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete("/:id", requireAuth, requireNetworkRole, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [deleted] = await db
      .delete(deviceConfigsTable)
      .where(eq(deviceConfigsTable.id, id))
      .returning({ id: deviceConfigsTable.id });

    if (!deleted) return res.status(404).json({ error: "Config not found" });

    logger.info({ id, userId: (req as any).user?.id }, "Device config deleted");
    return res.json({ deleted: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete device config");
    return res.status(500).json({ error: "Failed to delete config" });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Redact sensitive values from config text for non-privileged display.
 * Covers FortiGate, Aruba, and Nexus secret patterns.
 * Storage is never modified — this is display-only.
 */
function redactConfigSecrets(content: string): string {
  return content
    // FortiGate: set password ENC ..., set passwd ..., set psksecret ...
    .replace(/(set\s+(?:password|passwd|psksecret|secret|community)\s+)(\S+)/gi, "$1[REDACTED]")
    // Aruba: password <type> <value>
    .replace(/(password\s+\d+\s+)(\S+)/gi, "$1[REDACTED]")
    // SNMP community strings: community <name>
    .replace(/(community\s+)(\S+)/gi, "$1[REDACTED]")
    // Cisco enable secret / password
    .replace(/(enable\s+(?:secret|password)\s+\d?\s*)(\S+)/gi, "$1[REDACTED]")
    // Generic: username x password y / secret y
    .replace(/(username\s+\S+\s+(?:password|secret)\s+\d?\s*)(\S+)/gi, "$1[REDACTED]")
    // RADIUS/TACACS keys
    .replace(/((?:radius-server|tacacs-server)\s+key\s+)(\S+)/gi, "$1[REDACTED]")
    // VPN pre-shared keys
    .replace(/(pre-shared-key\s+)(\S+)/gi, "$1[REDACTED]");
}

export default router;
