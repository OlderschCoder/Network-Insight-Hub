import { pgTable, varchar, real, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const networkLayoutPositionsTable = pgTable("network_layout_positions", {
  nodeId: varchar("node_id", { length: 255 }).primaryKey(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  width: real("width"),
  height: real("height"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => usersTable.id),
});

export const insertNetworkLayoutPositionSchema = createInsertSchema(networkLayoutPositionsTable).omit({
  updatedAt: true,
});
export type InsertNetworkLayoutPosition = z.infer<typeof insertNetworkLayoutPositionSchema>;
export type NetworkLayoutPosition = typeof networkLayoutPositionsTable.$inferSelect;
