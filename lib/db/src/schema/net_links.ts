import { pgTable, uuid, varchar, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { netNodesTable } from "./net_nodes";

export const netLinksTable = pgTable(
  "net_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    aNodeId: uuid("a_node_id")
      .notNull()
      .references(() => netNodesTable.id, { onDelete: "cascade" }),
    aPort: varchar("a_port", { length: 40 }).notNull(),
    bNodeId: uuid("b_node_id")
      .notNull()
      .references(() => netNodesTable.id, { onDelete: "cascade" }),
    bPort: varchar("b_port", { length: 40 }).notNull(),
    linkKind: varchar("link_kind", { length: 12 }).notNull(), // fiber|dac|copper|wireless|vpn|virtual|unknown
    speedMbps: integer("speed_mbps"),
    portMode: varchar("port_mode", { length: 12 }), // trunk|access|routed|peerlink|heartbeat|unknown
    nativeVlan: integer("native_vlan"),
    allowedVlans: integer("allowed_vlans").array(),
    portchannel: varchar("portchannel", { length: 20 }), // Po15, vPC Peer-Link
    lldpPeerHostname: varchar("lldp_peer_hostname", { length: 80 }),
    lldpPeerMgmtIp: varchar("lldp_peer_mgmt_ip", { length: 45 }),
    confidence: varchar("confidence", { length: 20 }).notNull(), // confirmed_lldp|confirmed_cdp|confirmed_manual|inferred|stale
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).notNull(),
    evidenceRef: varchar("evidence_ref", { length: 200 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("net_links_a_node_idx").on(t.aNodeId),
    index("net_links_b_node_idx").on(t.bNodeId),
    index("net_links_last_verified_idx").on(t.lastVerifiedAt),
  ],
);

export const insertNetLinkSchema = createInsertSchema(netLinksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertNetLink = z.infer<typeof insertNetLinkSchema>;
export type NetLink = typeof netLinksTable.$inferSelect;
