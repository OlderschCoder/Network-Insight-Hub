import { Router } from "express";
import { db, entriesTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { z } from "zod";

// Compute ISO Monday for a YYYY-MM-DD date string in America/Chicago.
function isoWeekStartCentral(dateStr: string): string {
  // Treat the input as a Central-time calendar date (no time component).
  // We can do the math purely on the calendar: parse Y-M-D, build a UTC date,
  // and shift back by (dow - 1) days. This is timezone-stable for date-only inputs.
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7; // Mon=1..Sun=7
  const monday = new Date(dt.getTime() - (dow - 1) * 86400000);
  return monday.toISOString().slice(0, 10);
}

function todayInCentral(): string {
  // en-CA gives YYYY-MM-DD format
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const router = Router();

async function entryWithUser(entry: any, userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return {
    ...entry,
    userName: user?.name ?? "Unknown",
    userRole: user?.role ?? "unknown",
  };
}

router.get("/", requireAuth, async (req: any, res) => {
  const { weekOf, userId: queryUserId, category } = req.query;
  let conditions: any[] = [];
  if (req.user.role !== "cio") {
    conditions.push(eq(entriesTable.userId, req.user.id));
  } else if (queryUserId) {
    conditions.push(eq(entriesTable.userId, parseInt(queryUserId as string)));
  }
  if (weekOf) conditions.push(eq(entriesTable.weekOf, weekOf as string));
  if (category) conditions.push(eq(entriesTable.category, category as string));

  const entries = conditions.length > 0
    ? await db.select().from(entriesTable).where(and(...conditions)).orderBy(desc(entriesTable.createdAt))
    : await db.select().from(entriesTable).orderBy(desc(entriesTable.createdAt));

  const result = await Promise.all(entries.map(e => entryWithUser(e, e.userId)));
  return res.json(result);
});

router.post("/", requireAuth, async (req: any, res) => {
  const schema = z.object({
    category: z.enum(["helpdesk", "network", "security", "general"]),
    title: z.string().min(1),
    description: z.string().min(1),
    accomplishments: z.string().optional(),
    challenges: z.string().optional(),
    supportNeeded: z.string().optional(),
    ticketCount: z.number().optional(),
    weekOf: z.string(),
    entryDate: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isSubmitted: z.boolean().optional(),
    completedItems: z.array(z.object({
      title: z.string().min(1),
      notes: z.string().optional(),
      category: z.string().optional(),
      itemDate: z.string().optional(),
    })).optional(),
    zendeskTicketIds: z.array(z.number()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  // Upsert on (user_id, week_of) so re-saving a weekly log overwrites it
  // instead of failing on the unique index.
  const values = {
    ...parsed.data,
    userId: req.user.id,
    tags: parsed.data.tags ?? [],
    completedItems: parsed.data.completedItems ?? [],
    zendeskTicketIds: parsed.data.zendeskTicketIds ?? [],
    ticketCount: parsed.data.zendeskTicketIds?.length ?? parsed.data.ticketCount ?? 0,
  };
  const [entry] = await db
    .insert(entriesTable)
    .values(values)
    .onConflictDoUpdate({
      target: [entriesTable.userId, entriesTable.weekOf],
      set: {
        category: values.category,
        title: values.title,
        description: values.description,
        accomplishments: values.accomplishments,
        challenges: values.challenges,
        supportNeeded: values.supportNeeded,
        entryDate: values.entryDate,
        tags: values.tags,
        completedItems: values.completedItems,
        zendeskTicketIds: values.zendeskTicketIds,
        ticketCount: values.ticketCount,
        updatedAt: new Date(),
      },
    })
    .returning();
  // Stably link this user's items for the same week to this weekly log,
  // so future item edits don't retroactively change historical logs.
  await db.execute(sql`
    UPDATE log_items
       SET weekly_entry_id = ${entry.id}
     WHERE user_id = ${entry.userId}
       AND week_of = ${entry.weekOf}
       AND weekly_entry_id IS NULL
  `);
  const result = await entryWithUser(entry, entry.userId);
  return res.status(201).json(result);
});

// Quick-add a single completed item to the user's daily log for a date.
// Creates the entry if one doesn't exist for that date, otherwise appends.
router.post("/quick-item", requireAuth, async (req: any, res) => {
  const schema = z.object({
    title: z.string().min(1),
    notes: z.string().optional(),
    category: z.string().optional(),
    itemDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  }
  const itemDate = parsed.data.itemDate || todayInCentral();
  const weekStart = isoWeekStartCentral(itemDate);

  const newItem = {
    title: parsed.data.title,
    notes: parsed.data.notes,
    category: parsed.data.category,
    itemDate,
  };

  // Atomic upsert: relies on unique (user_id, week_of) index.
  // On conflict, append the new item to the existing JSON array in a single statement.
  const result: any = await db.execute(sql`
    INSERT INTO entries
      (user_id, category, title, description, week_of, entry_date, completed_items, zendesk_ticket_ids, tags, ticket_count)
    VALUES
      (${req.user.id}, 'general',
       ${'Weekly Log – week of ' + weekStart},
       '(Quick-added items)',
       ${weekStart}, ${itemDate},
       ${JSON.stringify([newItem])}::json,
       '[]'::json, '[]'::json, 0)
    ON CONFLICT (user_id, week_of) DO UPDATE
      SET completed_items =
            (COALESCE(entries.completed_items::jsonb, '[]'::jsonb) ||
             ${JSON.stringify(newItem)}::jsonb)::json,
          updated_at = NOW()
    RETURNING *, (xmax = 0) AS inserted;
  `);
  const row: any = Array.isArray(result) ? result[0] : result.rows?.[0];
  if (!row) return res.status(500).json({ error: "Upsert failed" });
  const inserted = !!row.inserted;
  const entry = {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    title: row.title,
    description: row.description,
    weekOf: row.week_of,
    entryDate: row.entry_date,
    headline: row.headline,
    accomplishments: row.accomplishments,
    challenges: row.challenges,
    supportNeeded: row.support_needed,
    ticketCount: row.ticket_count,
    tags: row.tags,
    completedItems: row.completed_items,
    zendeskTicketIds: row.zendesk_ticket_ids,
    isSubmitted: row.is_submitted,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const enriched = await entryWithUser(entry, entry.userId);
  return res.status(inserted ? 201 : 200).json(enriched);
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.id, id));
  if (!entry) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && entry.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await entryWithUser(entry, entry.userId);
  return res.json(result);
});

router.put("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(entriesTable).where(eq(entriesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const schema = z.object({
    category: z.enum(["helpdesk", "network", "security", "general"]).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    accomplishments: z.string().optional(),
    challenges: z.string().optional(),
    supportNeeded: z.string().optional(),
    ticketCount: z.number().optional(),
    weekOf: z.string().optional(),
    entryDate: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isSubmitted: z.boolean().optional(),
    completedItems: z.array(z.object({
      title: z.string().min(1),
      notes: z.string().optional(),
      category: z.string().optional(),
      itemDate: z.string().optional(),
    })).optional(),
    zendeskTicketIds: z.array(z.number()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error" });
  const updates: any = { ...parsed.data, updatedAt: new Date() };
  // Keep ticketCount in sync with zendeskTicketIds when ids are provided
  if (parsed.data.zendeskTicketIds !== undefined && parsed.data.ticketCount === undefined) {
    updates.ticketCount = parsed.data.zendeskTicketIds.length;
  }
  const [entry] = await db.update(entriesTable).set(updates)
    .where(eq(entriesTable.id, id)).returning();
  // Re-link items for the (possibly changed) week to this entry.
  await db.execute(sql`
    UPDATE log_items
       SET weekly_entry_id = ${entry.id}
     WHERE user_id = ${entry.userId}
       AND week_of = ${entry.weekOf}
       AND (weekly_entry_id IS NULL OR weekly_entry_id = ${entry.id})
  `);
  const result = await entryWithUser(entry, entry.userId);
  return res.json(result);
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(entriesTable).where(eq(entriesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "cio" && existing.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  await db.delete(entriesTable).where(eq(entriesTable.id, id));
  return res.status(204).send();
});

export default router;
