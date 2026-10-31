import { pgTable, serial, integer, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const strategicObjectivesTable = pgTable("strategic_objectives", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertStrategicObjectiveSchema = createInsertSchema(strategicObjectivesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStrategicObjective = z.infer<typeof insertStrategicObjectiveSchema>;
export type StrategicObjective = typeof strategicObjectivesTable.$inferSelect;
