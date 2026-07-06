import { pgTable, serial, integer, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { networkSwitchesTable } from "./network_switches";

/**
 * Stores backup configuration files for network devices.
 * One row per uploaded config — devices can have multiple versions.
 * Content stored as raw text (FortiGate, Aruba, Nexus configs are plaintext).
 * Secrets are stored intact for recovery purposes; Fred redacts on display.
 */
export const deviceConfigsTable = pgTable("device_configs", {
  id: serial("id").primaryKey(),
  // Optional FK to network_switches — null for standalone devices (FortiGate, etc.)
  switchId: integer("switch_id").references(() => networkSwitchesTable.id, { onDelete: "set null" }),
  // Friendly device identifier if no switch record exists
  deviceName: varchar("device_name", { length: 200 }).notNull(),
  // fortigate | aruba | nexus | other
  deviceType: varchar("device_type", { length: 50 }).notNull().default("other"),
  // Original filename of the uploaded config
  filename: varchar("filename", { length: 300 }).notNull(),
  // Full config text — stored intact including secrets (DB-protected)
  content: text("content").notNull(),
  // Optional notes: "post-upgrade backup", "pre-change snapshot", etc.
  notes: text("notes"),
  // File size in bytes for display
  sizeBytes: integer("size_bytes"),
  uploadedBy: integer("uploaded_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDeviceConfigSchema = createInsertSchema(deviceConfigsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertDeviceConfig = z.infer<typeof insertDeviceConfigSchema>;
export type DeviceConfig = typeof deviceConfigsTable.$inferSelect;
