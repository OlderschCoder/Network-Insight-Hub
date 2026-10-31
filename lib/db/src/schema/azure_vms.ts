import { pgTable, serial, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const azureVmsTable = pgTable("azure_vms", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  resourceGroup: varchar("resource_group", { length: 255 }),
  subscription: varchar("subscription", { length: 255 }),
  location: varchar("location", { length: 100 }),
  size: varchar("size", { length: 100 }),
  os: varchar("os", { length: 100 }),
  privateIp: varchar("private_ip", { length: 50 }),
  publicIp: varchar("public_ip", { length: 50 }),
  vnet: varchar("vnet", { length: 255 }),
  subnet: varchar("subnet", { length: 255 }),
  status: varchar("status", { length: 50 }).default("unknown").notNull(),
  purpose: text("purpose"),
  notes: text("notes"),
  owner: varchar("owner", { length: 255 }),
  azureResourceId: varchar("azure_resource_id", { length: 512 }).unique(),
  source: varchar("source", { length: 20 }).default("manual").notNull(),
  lastSyncedAt: timestamp("last_synced_at"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAzureVmSchema = createInsertSchema(azureVmsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAzureVm = z.infer<typeof insertAzureVmSchema>;
export type AzureVm = typeof azureVmsTable.$inferSelect;
