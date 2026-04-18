import { pgTable, serial, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const networkSwitchesTable = pgTable("network_switches", {
  id: serial("id").primaryKey(),
  hostname: varchar("hostname", { length: 255 }).notNull(),
  building: varchar("building", { length: 255 }).notNull(),
  ipAddress: varchar("ip_address", { length: 50 }).notNull(),
  model: varchar("model", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull().default("unknown"),
  configFile: varchar("config_file", { length: 500 }),
  notes: text("notes"),
  location: varchar("location", { length: 255 }),
  lastSeen: timestamp("last_seen"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertNetworkSwitchSchema = createInsertSchema(networkSwitchesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertNetworkSwitch = z.infer<typeof insertNetworkSwitchSchema>;
export type NetworkSwitch = typeof networkSwitchesTable.$inferSelect;
