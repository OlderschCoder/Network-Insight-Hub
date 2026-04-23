import { pgTable, serial, integer, text, varchar, timestamp, json, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export type ProjectAttachment = {
  name: string;
  url: string;
  addedAt?: string;
};

export type ProjectDecision = {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "decided";
  decidedBy?: string;
  decidedAt?: string;
  createdAt?: string;
};

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default("planning"),
  progress: integer("progress").notNull().default(0),
  targetDate: varchar("target_date", { length: 20 }),
  newEstimatedDate: varchar("new_estimated_date", { length: 20 }),
  attachments: json("attachments").$type<ProjectAttachment[]>().default([]),
  pendingDecisions: json("pending_decisions").$type<ProjectDecision[]>().default([]),
  strategicObjectiveIds: json("strategic_objective_ids").$type<number[]>().default([]),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectAssigneesTable = pgTable("project_assignees", {
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.userId] }),
}));

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
export type ProjectAssignee = typeof projectAssigneesTable.$inferSelect;
