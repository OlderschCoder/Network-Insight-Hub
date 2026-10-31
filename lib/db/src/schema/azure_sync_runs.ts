import { pgTable, serial, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * One row per Azure sync run (VM inventory or full-resource inventory).
 * Records success/failure, error detail, per-run counts, and — for VM syncs —
 * a structured diff of what was added/removed/changed so the UI can show a
 * post-sync status indicator and change view without recomputing.
 */
export const azureSyncRunsTable = pgTable("azure_sync_runs", {
  id: serial("id").primaryKey(),
  kind: varchar("kind", { length: 20 }).notNull(), // 'vm' | 'resource'
  status: varchar("status", { length: 20 }).notNull(), // 'success' | 'failed'
  error: text("error"),
  createdCount: integer("created_count").default(0).notNull(),
  updatedCount: integer("updated_count").default(0).notNull(),
  removedCount: integer("removed_count").default(0).notNull(),
  totalCount: integer("total_count").default(0).notNull(),
  changedCount: integer("changed_count").default(0).notNull(),
  diff: jsonb("diff").$type<AzureSyncDiff>().default({ added: [], removed: [], changed: [] }).notNull(),
  actorId: integer("actor_id").references(() => usersTable.id),
  actorName: varchar("actor_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AzureSyncFieldChange = { field: string; from: string | null; to: string | null };
export type AzureSyncDiffAdded = {
  name: string;
  resourceGroup: string | null;
  status: string | null;
  publicIp: string | null;
};
export type AzureSyncDiffRemoved = { name: string; resourceGroup: string | null };
export type AzureSyncDiffChanged = { name: string; changes: AzureSyncFieldChange[] };
export type AzureSyncDiff = {
  added: AzureSyncDiffAdded[];
  removed: AzureSyncDiffRemoved[];
  changed: AzureSyncDiffChanged[];
};

export const insertAzureSyncRunSchema = createInsertSchema(azureSyncRunsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAzureSyncRun = z.infer<typeof insertAzureSyncRunSchema>;
export type AzureSyncRun = typeof azureSyncRunsTable.$inferSelect;
