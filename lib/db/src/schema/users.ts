import { boolean, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  // Nullable: SSO (Microsoft Entra) users have no local password. Local
  // break-glass accounts still set this via bcrypt.
  passwordHash: text("password_hash"),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().default("helpdesk"),
  department: varchar("department", { length: 255 }),
  // Job title synced from the Entra profile; shown in the user's profile.
  jobTitle: varchar("job_title", { length: 255 }),
  // Entra (Azure AD) directory object id — links an SSO identity to this row.
  entraObjectId: varchar("entra_object_id", { length: 64 }).unique(),
  zendeskEmail: varchar("zendesk_email", { length: 255 }),
  isActive: boolean("is_active").notNull().default(true),
  // Break-glass flag: ONLY accounts with this set may use local email/password
  // login (and password reset). All other users must sign in via Entra SSO.
  isBreakGlass: boolean("is_break_glass").notNull().default(false),
  passwordResetToken: varchar("password_reset_token", { length: 128 }),
  passwordResetExpires: timestamp("password_reset_expires"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
