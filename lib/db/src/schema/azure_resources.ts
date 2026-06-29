import { pgTable, serial, text, varchar, timestamp, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Full Azure inventory across every resource type (VMs, disks, storage
 * accounts, networking, databases, web apps, etc.). Populated by the Resource
 * Graph-style sync; `type` holds the ARM resource type
 * (e.g. `Microsoft.Compute/virtualMachines`) which the UI groups/filters on.
 */
export const azureResourcesTable = pgTable("azure_resources", {
  id: serial("id").primaryKey(),
  azureResourceId: varchar("azure_resource_id", { length: 512 }).unique().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 255 }).notNull(),
  resourceGroup: varchar("resource_group", { length: 255 }),
  location: varchar("location", { length: 100 }),
  kind: varchar("kind", { length: 255 }),
  sku: varchar("sku", { length: 255 }),
  tags: json("tags").$type<Record<string, string>>(),
  subscription: varchar("subscription", { length: 255 }),
  status: varchar("status", { length: 50 }).default("active").notNull(),
  source: varchar("source", { length: 20 }).default("azure").notNull(),
  notes: text("notes"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAzureResourceSchema = createInsertSchema(azureResourcesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAzureResource = z.infer<typeof insertAzureResourceSchema>;
export type AzureResource = typeof azureResourcesTable.$inferSelect;
