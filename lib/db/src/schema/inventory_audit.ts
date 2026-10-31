import { pgTable, serial, integer, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type AuditFieldChange = {
  field: string;
  from: unknown;
  to: unknown;
};

export const inventoryAuditTable = pgTable("inventory_audit", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 20 }).notNull(),
  entityId: integer("entity_id").notNull(),
  entityLabel: varchar("entity_label", { length: 255 }).notNull(),
  action: varchar("action", { length: 20 }).notNull(),
  source: varchar("source", { length: 20 }).notNull(),
  actorId: integer("actor_id"),
  actorName: varchar("actor_name", { length: 255 }),
  changes: jsonb("changes").$type<AuditFieldChange[]>().default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInventoryAuditSchema = createInsertSchema(inventoryAuditTable).omit({
  id: true,
  createdAt: true,
});

export type InsertInventoryAudit = z.infer<typeof insertInventoryAuditSchema>;
export type InventoryAudit = typeof inventoryAuditTable.$inferSelect;
