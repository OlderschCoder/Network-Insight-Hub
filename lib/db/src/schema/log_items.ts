import { pgTable, serial, integer, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { entriesTable } from "./entries";

export const logItemsTable = pgTable("log_items", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  itemDate: varchar("item_date", { length: 20 }).notNull(),
  weekOf: varchar("week_of", { length: 20 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  category: varchar("category", { length: 50 }).default("task"),
  notes: text("notes"),
  weeklyEntryId: integer("weekly_entry_id").references(() => entriesTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userWeekIdx: index("log_items_user_week_idx").on(table.userId, table.weekOf),
  userDateIdx: index("log_items_user_date_idx").on(table.userId, table.itemDate),
}));

export type LogItem = typeof logItemsTable.$inferSelect;
