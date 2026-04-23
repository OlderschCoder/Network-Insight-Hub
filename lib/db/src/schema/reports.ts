import { pgTable, serial, integer, text, varchar, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  weekOf: varchar("week_of", { length: 20 }).notNull(),
  title: varchar("title", { length: 500 }),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  summary: text("summary"),
  accomplishments: text("accomplishments"),
  challenges: text("challenges"),
  strategicProgress: text("strategic_progress"),
  nextWeekPlans: text("next_week_plans"),
  metrics: json("metrics").$type<Record<string, unknown>>().default({}),
  selectedItemIds: json("selected_item_ids").$type<number[] | null>().default(null),
  contributorCount: integer("contributor_count").default(0),
  entryCount: integer("entry_count").default(0),
  createdBy: integer("created_by").references(() => usersTable.id),
  finalizedAt: timestamp("finalized_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
