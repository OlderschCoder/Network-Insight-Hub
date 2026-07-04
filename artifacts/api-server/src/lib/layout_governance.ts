import {
  db,
  networkLayoutPositionsTable,
  networkLayoutEventsTable,
  networkLayoutLockTable,
} from "@workspace/db";
import type { LayoutPositionSnapshot } from "@workspace/db";
import { and, desc, eq, lte, or, sql } from "drizzle-orm";
import { logger } from "./logger";

// Advisory edit lock: a single row (id = 1) marks the current layout editor.
// A short TTL means a crashed/closed editor's lock self-expires without any
// manual cleanup; active editors refresh it by re-acquiring on each drag.
const LOCK_ID = 1;
export const LOCK_TTL_MS = 90_000;

export interface LayoutActor {
  id: number | null;
  name: string | null;
}

export interface LockStatus {
  locked: boolean;
  lockedById: number | null;
  lockedByName: string | null;
  expiresAt: string | null;
  heldByMe: boolean;
}

const UNLOCKED: LockStatus = {
  locked: false,
  lockedById: null,
  lockedByName: null,
  expiresAt: null,
  heldByMe: false,
};

export async function getLockStatus(
  userId: number | null,
  now: Date = new Date(),
): Promise<LockStatus> {
  const [row] = await db
    .select()
    .from(networkLayoutLockTable)
    .where(eq(networkLayoutLockTable.id, LOCK_ID));
  if (!row || row.lockedById == null || row.expiresAt <= now) return { ...UNLOCKED };
  return {
    locked: true,
    lockedById: row.lockedById,
    lockedByName: row.lockedByName ?? null,
    expiresAt: row.expiresAt.toISOString(),
    heldByMe: userId != null && row.lockedById === userId,
  };
}

// Acquire or refresh the lock for `actor`. Succeeds when the lock is free,
// expired, or already held by the same user; fails (ok:false) when another user
// currently holds a live lock. The conditional upsert makes this atomic.
export async function acquireLock(
  actor: LayoutActor,
  now: Date = new Date(),
): Promise<{ ok: boolean; status: LockStatus }> {
  if (actor.id == null) {
    return { ok: false, status: await getLockStatus(null, now) };
  }
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  await db
    .insert(networkLayoutLockTable)
    .values({
      id: LOCK_ID,
      lockedById: actor.id,
      lockedByName: actor.name,
      acquiredAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: networkLayoutLockTable.id,
      set: {
        lockedById: actor.id,
        lockedByName: actor.name,
        acquiredAt: now,
        expiresAt,
      },
      where: or(
        lte(networkLayoutLockTable.expiresAt, now),
        eq(networkLayoutLockTable.lockedById, actor.id),
      ),
    });
  const status = await getLockStatus(actor.id, now);
  return { ok: status.heldByMe, status };
}

export async function releaseLock(actor: LayoutActor): Promise<void> {
  if (actor.id == null) return;
  await db
    .delete(networkLayoutLockTable)
    .where(and(eq(networkLayoutLockTable.id, LOCK_ID), eq(networkLayoutLockTable.lockedById, actor.id)));
}

// ---- Reset / restore change log -------------------------------------------

function snapshotPositions(
  rows: { nodeId: string; x: number; y: number; width: number | null; height: number | null }[],
): LayoutPositionSnapshot[] {
  return rows.map((r) => ({
    nodeId: r.nodeId,
    x: r.x,
    y: r.y,
    width: r.width ?? null,
    height: r.height ?? null,
  }));
}

// Snapshot every saved position into the change log, then wipe the shared
// layout. The snapshot makes the reset recoverable via restoreLayout().
export async function resetLayout(
  actor: LayoutActor,
): Promise<{ removed: number; eventId: number | null }> {
  // Snapshot + delete must be atomic: a concurrent PUT /layout between the two
  // could otherwise be wiped without being captured, making restore lossy.
  const { removed, eventId } = await db.transaction(async (tx) => {
    const rows = await tx.select().from(networkLayoutPositionsTable);
    const snapshot = snapshotPositions(rows);
    const [ev] = await tx
      .insert(networkLayoutEventsTable)
      .values({
        action: "reset",
        actorId: actor.id ?? undefined,
        actorName: actor.name ?? undefined,
        nodeCount: snapshot.length,
        snapshot,
      })
      .returning({ id: networkLayoutEventsTable.id });
    await tx.delete(networkLayoutPositionsTable);
    return { removed: snapshot.length, eventId: ev?.id ?? null };
  });
  logger.info({ actorId: actor.id, removed }, "Network layout reset");
  return { removed, eventId };
}

// Change-log list for the UI — omits the (potentially large) snapshot payload.
export async function listLayoutEvents(limit: number) {
  return db
    .select({
      id: networkLayoutEventsTable.id,
      action: networkLayoutEventsTable.action,
      actorId: networkLayoutEventsTable.actorId,
      actorName: networkLayoutEventsTable.actorName,
      nodeCount: networkLayoutEventsTable.nodeCount,
      createdAt: networkLayoutEventsTable.createdAt,
    })
    .from(networkLayoutEventsTable)
    .orderBy(desc(networkLayoutEventsTable.createdAt))
    .limit(limit);
}

type RestoreResult =
  | { ok: true; restored: number }
  | { ok: false; status: number; error: string };

// Re-apply a snapshotted layout (undo a reset). Records a "restore" event.
export async function restoreLayout(eventId: number, actor: LayoutActor): Promise<RestoreResult> {
  const [ev] = await db
    .select()
    .from(networkLayoutEventsTable)
    .where(eq(networkLayoutEventsTable.id, eventId));
  if (!ev) return { ok: false, status: 404, error: "Snapshot not found." };
  const snapshot = Array.isArray(ev.snapshot) ? ev.snapshot : [];
  if (snapshot.length === 0) {
    return { ok: false, status: 400, error: "This snapshot has no saved positions to restore." };
  }
  const now = new Date();
  const values = snapshot.map((p) => ({
    nodeId: p.nodeId,
    x: p.x,
    y: p.y,
    width: p.width ?? null,
    height: p.height ?? null,
    updatedAt: now,
    updatedBy: actor.id ?? null,
  }));
  await db
    .insert(networkLayoutPositionsTable)
    .values(values)
    .onConflictDoUpdate({
      target: networkLayoutPositionsTable.nodeId,
      set: {
        x: sql`excluded.x`,
        y: sql`excluded.y`,
        width: sql`excluded.width`,
        height: sql`excluded.height`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    });
  try {
    await db.insert(networkLayoutEventsTable).values({
      action: "restore",
      actorId: actor.id ?? undefined,
      actorName: actor.name ?? undefined,
      nodeCount: snapshot.length,
      snapshot,
    });
  } catch (err) {
    logger.error({ err }, "Failed to record layout restore event");
  }
  logger.info({ actorId: actor.id, restored: snapshot.length, eventId }, "Network layout restored");
  return { ok: true, restored: snapshot.length };
}
