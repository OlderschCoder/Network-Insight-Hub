import { pgTable, serial, integer, text, varchar, timestamp, boolean, json, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const entriesTable = pgTable("entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  category: varchar("category", { length: 50 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description").notNull(),
  accomplishments: text("accomplishments"),
  challenges: text("challenges"),
  supportNeeded: text("support_needed"),
  ticketCount: integer("ticket_count").default(0),
  weekOf: varchar("week_of", { length: 20 }).notNull(),
  entryDate: varchar("entry_date", { length: 30 }),
  tags: json("tags").$type<string[]>().default([]),
  completedItems: json("completed_items").$type<{ title: string; notes?: string; category?: string; itemDate?: string }[]>().default([]),
  zendeskTicketIds: json("zendesk_ticket_ids").$type<number[]>().default([]),
  isSubmitted: boolean("is_submitted").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userWeekUnique: uniqueIndex("entries_user_week_unique").on(table.userId, table.weekOf),
}));

export const insertEntrySchema = createInsertSchema(entriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type Entry = typeof entriesTable.$inferSelect;
