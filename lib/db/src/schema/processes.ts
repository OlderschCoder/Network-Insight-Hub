import { pgTable, serial, integer, text, varchar, timestamp, json, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const processesTable = pgTable("processes", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  category: varchar("category", { length: 50 }).notNull().default("general"),
  summary: text("summary"),
  content: text("content").notNull().default(""),
  tags: json("tags").$type<string[]>().default([]),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  slugUnique: uniqueIndex("processes_slug_unique").on(table.slug),
  categoryIdx: index("processes_category_idx").on(table.category),
}));

export type Process = typeof processesTable.$inferSelect;
