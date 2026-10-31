import { pgTable, serial, integer, text, varchar, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const incidentRoomsTable = pgTable("incident_rooms", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  severity: varchar("severity", { length: 20 }).notNull().default("medium"), // low | medium | high | critical
  status: varchar("status", { length: 20 }).notNull().default("open"),       // open | resolved
  createdBy: integer("created_by").references(() => usersTable.id),
  resolvedBy: integer("resolved_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const incidentMessagesTable = pgTable("incident_messages", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").references(() => incidentRoomsTable.id, { onDelete: "cascade" }).notNull(),
  userId: integer("user_id").references(() => usersTable.id),   // null = Fred
  authorName: varchar("author_name", { length: 255 }).notNull(),
  isFred: boolean("is_fred").notNull().default(false),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const incidentMembersTable = pgTable("incident_members", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").references(() => incidentRoomsTable.id, { onDelete: "cascade" }).notNull(),
  userId: integer("user_id").references(() => usersTable.id).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export type IncidentRoom = typeof incidentRoomsTable.$inferSelect;
export type IncidentMessage = typeof incidentMessagesTable.$inferSelect;
export type IncidentMember = typeof incidentMembersTable.$inferSelect;
