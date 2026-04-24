import { pgTable, serial, integer, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const afterActionReportsTable = pgTable("after_action_reports", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: varchar("title", { length: 500 }).notNull(),
  incident: text("incident").notNull(),
  building: varchar("building", { length: 255 }),
  deviceType: varchar("device_type", { length: 255 }),
  affectedSystems: text("affected_systems"),
  timeline: text("timeline"),
  rootCause: text("root_cause"),
  resolution: text("resolution"),
  lessonsLearned: text("lessons_learned"),
  preventionMeasures: text("prevention_measures"),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  severity: varchar("severity", { length: 20 }).notNull(),
  zendeskTicketId: integer("zendesk_ticket_id"),
  incidentDate: timestamp("incident_date"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAfterActionSchema = createInsertSchema(afterActionReportsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAfterAction = z.infer<typeof insertAfterActionSchema>;
export type AfterAction = typeof afterActionReportsTable.$inferSelect;
