import { pgTable, serial, integer, text, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const aiKnowledgeTable = pgTable("ai_knowledge", {
  id: serial("id").primaryKey(),
  category: varchar("category", { length: 60 }).notNull().default("general"),
  title: varchar("title", { length: 300 }).notNull(),
  content: text("content").notNull(),
  source: varchar("source", { length: 20 }).notNull().default("manual"),
  // "team" = shared across all staff (default); "personal" = only visible to ownerId
  scope: varchar("scope", { length: 20 }).notNull().default("team"),
  ownerId: integer("owner_id").references(() => usersTable.id),
  isActive: boolean("is_active").notNull().default(true),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAiKnowledgeSchema = createInsertSchema(aiKnowledgeTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAiKnowledge = z.infer<typeof insertAiKnowledgeSchema>;
export type AiKnowledge = typeof aiKnowledgeTable.$inferSelect;
