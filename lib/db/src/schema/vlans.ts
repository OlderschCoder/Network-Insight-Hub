import { pgTable, serial, integer, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vlansTable = pgTable("vlans", {
  id: serial("id").primaryKey(),
  vlanId: integer("vlan_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  building: varchar("building", { length: 255 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  subnet: varchar("subnet", { length: 100 }),
  gateway: varchar("gateway", { length: 50 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertVlanSchema = createInsertSchema(vlansTable).omit({
  id: true,
  createdAt: true,
});

export type InsertVlan = z.infer<typeof insertVlanSchema>;
export type Vlan = typeof vlansTable.$inferSelect;
