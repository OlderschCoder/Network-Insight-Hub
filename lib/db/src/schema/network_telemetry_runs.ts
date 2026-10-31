import { pgTable, serial, varchar, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export type TelemetryPortChange = {
  port: string;
  kind: "oper" | "admin" | "native_vlan" | "description" | "added" | "missing";
  before: string | number | null;
  after: string | number | null;
};

export type TelemetryDeviceDelta = {
  hostname: string;
  managementIp: string;
  downToUp: number;
  upToDown: number;
  adminChanges: number;
  vlanChanges: number;
  descriptionChanges: number;
  portsAdded: number;
  portsMissing: number;
  changes: TelemetryPortChange[];
};

export const networkTelemetryRunsTable = pgTable(
  "network_telemetry_runs",
  {
    id: serial("id").primaryKey(),
    runId: varchar("run_id", { length: 100 }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    collectionScope: varchar("collection_scope", { length: 20 }).notNull().default("partial"),
    targetIps: jsonb("target_ips").$type<string[]>().notNull().default([]),
    sourceRecords: integer("source_records").notNull().default(0),
    successfulRecords: integer("successful_records").notNull().default(0),
    failedRecords: integer("failed_records").notNull().default(0),
    appliedSwitches: integer("applied_switches").notNull().default(0),
    physicalPorts: integer("physical_ports").notNull().default(0),
    downToUp: integer("down_to_up").notNull().default(0),
    upToDown: integer("up_to_down").notNull().default(0),
    adminChanges: integer("admin_changes").notNull().default(0),
    vlanChanges: integer("vlan_changes").notNull().default(0),
    descriptionChanges: integer("description_changes").notNull().default(0),
    portsAdded: integer("ports_added").notNull().default(0),
    portsMissing: integer("ports_missing").notNull().default(0),
    changedDevices: integer("changed_devices").notNull().default(0),
    deviceDeltas: jsonb("device_deltas").$type<TelemetryDeviceDelta[]>().notNull().default([]),
    failures: jsonb("failures").$type<Array<{ hostname: string; managementIp: string; error: string }>>().notNull().default([]),
    actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
    actorName: varchar("actor_name", { length: 255 }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("network_telemetry_runs_run_id_uq").on(table.runId)],
);

export type NetworkTelemetryRun = typeof networkTelemetryRunsTable.$inferSelect;
