import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  numeric,
  real,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { netNodesTable } from "./net_nodes";

/**
 * Latest merged view of each switch interface.
 *
 * Config imports own the static policy fields (mode, VLANs, vPC). The NOC
 * collector owns live telemetry (state, counters, utilization, optics). Each
 * source updates only its columns so a fresh poll never erases config facts.
 */
export const netPortsTable = pgTable(
  "net_ports",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => netNodesTable.id, { onDelete: "cascade" }),
    interfaceName: varchar("interface_name", { length: 80 }).notNull(),
    ifIndex: integer("if_index"),
    isPhysical: boolean("is_physical").notNull().default(true),
    description: text("description"),
    ifType: integer("if_type"),
    mtu: integer("mtu"),
    macAddress: varchar("mac_address", { length: 32 }),
    adminStatus: varchar("admin_status", { length: 12 }),
    operStatus: varchar("oper_status", { length: 12 }),
    speedMbps: integer("speed_mbps"),
    duplex: varchar("duplex", { length: 12 }),
    portMode: varchar("port_mode", { length: 12 }),
    nativeVlan: integer("native_vlan"),
    allowedVlans: integer("allowed_vlans").array(),
    portchannel: varchar("portchannel", { length: 40 }),
    vpcId: integer("vpc_id"),
    inErrors: bigint("in_errors", { mode: "number" }),
    outErrors: bigint("out_errors", { mode: "number" }),
    inDiscards: bigint("in_discards", { mode: "number" }),
    outDiscards: bigint("out_discards", { mode: "number" }),
    inOctets: numeric("in_octets", { precision: 30, scale: 0 }),
    outOctets: numeric("out_octets", { precision: 30, scale: 0 }),
    inBps: bigint("in_bps", { mode: "number" }),
    outBps: bigint("out_bps", { mode: "number" }),
    utilizationPct: real("utilization_pct"),
    rxPowerDbm: real("rx_power_dbm"),
    txPowerDbm: real("tx_power_dbm"),
    temperatureC: real("temperature_c"),
    opticsStatus: varchar("optics_status", { length: 20 }),
    configEvidence: varchar("config_evidence", { length: 300 }),
    telemetryEvidence: varchar("telemetry_evidence", { length: 300 }),
    configUpdatedAt: timestamp("config_updated_at", { withTimezone: true }),
    telemetryUpdatedAt: timestamp("telemetry_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("net_ports_node_interface_uq").on(t.nodeId, t.interfaceName),
    index("net_ports_node_idx").on(t.nodeId),
    index("net_ports_telemetry_updated_idx").on(t.telemetryUpdatedAt),
  ],
);

export const insertNetPortSchema = createInsertSchema(netPortsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertNetPort = z.infer<typeof insertNetPortSchema>;
export type NetPort = typeof netPortsTable.$inferSelect;
