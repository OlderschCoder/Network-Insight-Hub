import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { netNodesTable } from "./net_nodes";

export const netRoutingAdjacenciesTable = pgTable(
  "net_routing_adjacencies",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    deviceNodeId: uuid("device_node_id")
      .notNull()
      .references(() => netNodesTable.id, { onDelete: "cascade" }),
    protocol: varchar("protocol", { length: 10 }).notNull(), // ospf|bgp|static
    process: varchar("process", { length: 20 }), // e.g. "10"
    area: varchar("area", { length: 16 }), // e.g. "0.0.0.0"
    localInterface: varchar("local_interface", { length: 40 }).notNull(), // Vlan624
    localIp: varchar("local_ip", { length: 45 }), // 172.20.2.49
    peerRouterId: varchar("peer_router_id", { length: 45 }), // 10.80.48.1
    peerIp: varchar("peer_ip", { length: 45 }), // 172.20.2.50
    state: varchar("state", { length: 10 }).notNull(), // FULL|DOWN|INIT|2WAY
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    evidenceRef: varchar("evidence_ref", { length: 200 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("net_routing_adj_device_idx").on(t.deviceNodeId),
    index("net_routing_adj_state_idx").on(t.state),
  ],
);

export const insertNetRoutingAdjacencySchema = createInsertSchema(netRoutingAdjacenciesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertNetRoutingAdjacency = z.infer<typeof insertNetRoutingAdjacencySchema>;
export type NetRoutingAdjacency = typeof netRoutingAdjacenciesTable.$inferSelect;
