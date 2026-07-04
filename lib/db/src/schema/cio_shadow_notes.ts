import { pgTable, serial, integer, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// CIO-only "shadow memory": a private scratchpad the AI (and the CIO) can write
// observations and suggestions into. Surfaced at reporting time as suggestions;
// it never modifies actual report deliverables.
export const cioShadowNotesTable = pgTable("cio_shadow_notes", {
  id: serial("id").primaryKey(),
  weekOf: varchar("week_of", { length: 20 }),
  category: varchar("category", { length: 50 }).notNull().default("general"),
  content: text("content").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  source: varchar("source", { length: 20 }).notNull().default("ai"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCioShadowNoteSchema = createInsertSchema(cioShadowNotesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCioShadowNote = z.infer<typeof insertCioShadowNoteSchema>;
export type CioShadowNote = typeof cioShadowNotesTable.$inferSelect;
