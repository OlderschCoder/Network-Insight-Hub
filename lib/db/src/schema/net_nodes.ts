import { pgTable, uuid, varchar, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const netNodesTable = pgTable(
  "net_nodes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    hostname: varchar("hostname", { length: 80 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    nodeKind: varchar("node_kind", { length: 20 }).notNull(), // switch|firewall|router|server|svi|patch_panel|isp|other
    vendor: varchar("vendor", { length: 20 }), // Cisco|Aruba|Fortinet|Dell|Unknown
    model: varchar("model", { length: 80 }),
    mgmtIp: varchar("mgmt_ip", { length: 45 }), // null OK for patch_panel/logical
    building: varchar("building", { length: 80 }).notNull(),
    location: varchar("location", { length: 120 }),
    role: varchar("role", { length: 20 }).notNull(), // core|distribution|access|edge|firewall|controller|svi
    function: varchar("function", { length: 30 }), // general|dorms|athletics|public_safety|hvac|cameras|access_control|voice|student_union|health_center
    criticality: varchar("criticality", { length: 10 }).notNull().default("medium"), // critical|high|medium|low
    tags: text("tags").array(),
    status: varchar("status", { length: 10 }), // online|offline|unknown
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("net_nodes_mgmt_ip_idx").on(t.mgmtIp),
    index("net_nodes_building_idx").on(t.building),
    uniqueIndex("net_nodes_hostname_uq").on(t.hostname),
  ],
);

export const insertNetNodeSchema = createInsertSchema(netNodesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertNetNode = z.infer<typeof insertNetNodeSchema>;
export type NetNode = typeof netNodesTable.$inferSelect;
