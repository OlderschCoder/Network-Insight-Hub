import { pgTable, serial, integer, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

// A single saved React Flow node position captured in a layout snapshot.
export type LayoutPositionSnapshot = {
  nodeId: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
};

// Change log for the shared network-diagram layout. Every full "reset" (and any
// subsequent "restore") is recorded here together with a snapshot of the exact
// positions that were removed, so an accidental reset can be undone and there is
// an auditable record of who wiped the shared layout and when.
export const networkLayoutEventsTable = pgTable("network_layout_events", {
  id: serial("id").primaryKey(),
  action: varchar("action", { length: 20 }).notNull(), // 'reset' | 'restore'
  actorId: integer("actor_id"),
  actorName: varchar("actor_name", { length: 255 }),
  nodeCount: integer("node_count").default(0).notNull(),
  snapshot: jsonb("snapshot").$type<LayoutPositionSnapshot[]>().default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type NetworkLayoutEvent = typeof networkLayoutEventsTable.$inferSelect;

// Advisory single-writer edit lock for the shared network diagram. One physical
// row (id = 1) records who currently holds the lock and when it expires, so
// concurrent editors don't silently overwrite each other's dragged positions.
export const networkLayoutLockTable = pgTable("network_layout_lock", {
  id: integer("id").primaryKey(), // singleton — always 1
  lockedById: integer("locked_by_id"),
  lockedByName: varchar("locked_by_name", { length: 255 }),
  acquiredAt: timestamp("acquired_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export type NetworkLayoutLock = typeof networkLayoutLockTable.$inferSelect;
