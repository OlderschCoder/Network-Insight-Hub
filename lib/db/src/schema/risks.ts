import { pgTable, serial, integer, text, varchar, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const risksTable = pgTable("risks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  type: varchar("type", { length: 20 }).notNull(),
  severity: varchar("severity", { length: 20 }).notNull(),
  probability: varchar("probability", { length: 20 }).default("medium"),
  category: varchar("category", { length: 30 }).default("other"),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description").notNull(),
  impact: text("impact"),
  mitigation: text("mitigation"),
  relatedBuilding: varchar("related_building", { length: 255 }),
  relatedDevice: varchar("related_device", { length: 255 }),
  sharedWith: json("shared_with").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRiskSchema = createInsertSchema(risksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRisk = z.infer<typeof insertRiskSchema>;
export type Risk = typeof risksTable.$inferSelect;
