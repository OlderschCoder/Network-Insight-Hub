/**
 * Device Configuration Backup API
 * POST   /api/network/configs          — upload a config file
 * GET    /api/network/configs          — list all configs (metadata only)
 * GET    /api/network/configs/:id      — get a specific config (full content)
 * DELETE /api/network/configs/:id      — delete a config
 * GET    /api/network/switches/:id/configs — list configs for a specific switch
 */

import { Router } from "express";
import { db, deviceConfigsTable, usersTable } from "@workspace/db";
import { eq, desc, or, ilike } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";

const router = Router();

// Only CIO and network roles can upload/delete configs
function requireNetworkRole(req: any, res: any, next: any) {
  const role = req.user?.role ?? "";
  if (!["cio", "network", "network_engineer"].includes(role)) {
    return res.status(403).json({ error: "Network role required to manage device configs" });
  }
  next();
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
