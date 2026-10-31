import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const teamTodosTable = pgTable(
  "team_todos",
  {
    id: serial("id").primaryKey(),
    assigneeId: integer("assignee_id")
      .notNull()
      .references(() => usersTable.id),
    createdById: integer("created_by_id")
      .notNull()
      .references(() => usersTable.id),
    title: varchar("title", { length: 500 }).notNull(),
    details: text("details"),
    dueDate: varchar("due_date", { length: 20 }),
    priority: varchar("priority", { length: 20 }).notNull().default("normal"),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    assigneeStatusIdx: index("team_todos_assignee_status_idx").on(
      table.assigneeId,
      table.status,
    ),
    dueDateIdx: index("team_todos_due_date_idx").on(table.dueDate),
  }),
);

export type TeamTodo = typeof teamTodosTable.$inferSelect;
