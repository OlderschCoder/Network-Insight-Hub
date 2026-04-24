import { Router } from "express";
import { db, entriesTable, reportsTable, risksTable, networkSwitchesTable, afterActionReportsTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

const SUBMITTING_ROLES = new Set([
  "helpdesk",
  "network",
  "security",
  "network_engineer",
  "security_engineer",
]);

router.get("/summary", requireAuth, async (_req: any, res) => {
  try {
    const weekOf = getWeekStart();

    const thisWeekEntries = await db
      .select({
        userId: entriesTable.userId,
        ticketCount: entriesTable.ticketCount,
        isSubmitted: entriesTable.isSubmitted,
      })
      .from(entriesTable)
      .where(eq(entriesTable.weekOf, weekOf));

    const contributorIds = new Set<number>();
    const submittedUserIds = new Set<number>();
    let totalTickets = 0;
    for (const e of thisWeekEntries) {
      if (typeof e.userId === "number") contributorIds.add(e.userId);
      totalTickets += e.ticketCount ?? 0;
      if (e.isSubmitted && typeof e.userId === "number") submittedUserIds.add(e.userId);
    }

    const [
      openRisksRows,
      criticalRisksRows,
      openAfterActionsRows,
      totalSwitchesRows,
      onlineSwitchesRows,
      offlineSwitchesRows,
      totalReportsRows,
      submittingUsersRows,
    ] = await Promise.all([
      db.select({ value: sql<number>`count(*)::int` }).from(risksTable).where(eq(risksTable.status, "open")),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(risksTable)
        .where(and(eq(risksTable.status, "open"), eq(risksTable.severity, "critical"))),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(afterActionReportsTable)
        .where(eq(afterActionReportsTable.status, "open")),
      db.select({ value: sql<number>`count(*)::int` }).from(networkSwitchesTable),
      db.select({ value: sql<number>`count(*)::int` }).from(networkSwitchesTable).where(eq(networkSwitchesTable.status, "online")),
      db.select({ value: sql<number>`count(*)::int` }).from(networkSwitchesTable).where(eq(networkSwitchesTable.status, "offline")),
      db.select({ value: sql<number>`count(*)::int` }).from(reportsTable),
      db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable),
    ]);

    const submittingUserCount = submittingUsersRows.filter((u) => SUBMITTING_ROLES.has(u.role)).length;
    const submittingSubmittedCount = submittingUsersRows
      .filter((u) => SUBMITTING_ROLES.has(u.role) && submittedUserIds.has(u.id))
      .length;
    const pendingSubmissions = Math.max(0, submittingUserCount - submittingSubmittedCount);

    return res.json({
      thisWeekEntries: thisWeekEntries.length,
      thisWeekContributors: contributorIds.size,
      openRisks: openRisksRows[0]?.value ?? 0,
      criticalRisks: criticalRisksRows[0]?.value ?? 0,
      openAfterActions: openAfterActionsRows[0]?.value ?? 0,
      totalSwitches: totalSwitchesRows[0]?.value ?? 0,
      onlineSwitches: onlineSwitchesRows[0]?.value ?? 0,
      offlineSwitches: offlineSwitchesRows[0]?.value ?? 0,
      totalReports: totalReportsRows[0]?.value ?? 0,
      pendingSubmissions,
      totalTickets,
    });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/summary failed");
    return res.status(500).json({ error: "Failed to load dashboard summary" });
  }
});

router.get("/activity", requireAuth, async (req: any, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    const entries = await db.select({
      id: entriesTable.id,
      title: entriesTable.title,
      userId: entriesTable.userId,
      createdAt: entriesTable.createdAt,
    }).from(entriesTable).orderBy(desc(entriesTable.createdAt)).limit(limit);

    const risks = await db.select({
      id: risksTable.id,
      title: risksTable.title,
      userId: risksTable.userId,
      createdAt: risksTable.createdAt,
      type: risksTable.type,
    }).from(risksTable).orderBy(desc(risksTable.createdAt)).limit(10);

    const afterActions = await db.select({
      id: afterActionReportsTable.id,
      title: afterActionReportsTable.title,
      userId: afterActionReportsTable.userId,
      createdAt: afterActionReportsTable.createdAt,
    }).from(afterActionReportsTable).orderBy(desc(afterActionReportsTable.createdAt)).limit(10);

    const userIds = [...new Set([
      ...entries.map(e => e.userId),
      ...risks.map(r => r.userId),
      ...afterActions.map(a => a.userId),
    ])];

    const users = userIds.length > 0
      ? await db.select().from(usersTable)
      : [];

    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const activities = [
      ...entries.map(e => ({
        id: `entry-${e.id}`,
        type: "entry" as const,
        action: "created a log entry",
        title: e.title,
        userName: userMap[e.userId]?.name ?? "Unknown",
        userRole: userMap[e.userId]?.role ?? "unknown",
        createdAt: e.createdAt,
        entityId: e.id,
      })),
      ...risks.map(r => ({
        id: `risk-${r.id}`,
        type: "risk" as const,
        action: `submitted a ${r.type}`,
        title: r.title,
        userName: userMap[r.userId]?.name ?? "Unknown",
        userRole: userMap[r.userId]?.role ?? "unknown",
        createdAt: r.createdAt,
        entityId: r.id,
      })),
      ...afterActions.map(a => ({
        id: `aar-${a.id}`,
        type: "after-action" as const,
        action: "filed an after-action report",
        title: a.title,
        userName: userMap[a.userId]?.name ?? "Unknown",
        userRole: userMap[a.userId]?.role ?? "unknown",
        createdAt: a.createdAt,
        entityId: a.id,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

    return res.json(activities);
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/activity failed");
    return res.status(500).json({ error: "Failed to load recent activity" });
  }
});

router.get("/week-status", requireAuth, async (_req: any, res) => {
  try {
    const weekOf = getWeekStart();
    const allUsers = await db.select().from(usersTable);
    const entries = await db.select().from(entriesTable).where(eq(entriesTable.weekOf, weekOf));

    const submissions = allUsers.map(user => {
      const userEntries = entries.filter(e => e.userId === user.id);
      const isSubmitted = userEntries.some(e => e.isSubmitted);
      return {
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        entryCount: userEntries.length,
        isSubmitted,
      };
    });

    const [existingReport] = await db.select().from(reportsTable)
      .where(and(eq(reportsTable.weekOf, weekOf), eq(reportsTable.status, "finalized")));

    const nextFriday = new Date();
    const daysUntilFriday = (5 - nextFriday.getDay() + 7) % 7;
    if (daysUntilFriday === 0) nextFriday.setDate(nextFriday.getDate() + 7);
    else nextFriday.setDate(nextFriday.getDate() + daysUntilFriday);
    nextFriday.setHours(17, 0, 0, 0);

    return res.json({
      weekOf,
      deadline: nextFriday.toISOString(),
      isFinalized: !!existingReport,
      submissions,
    });
  } catch (err) {
    logger.error({ err }, "GET /api/dashboard/week-status failed");
    return res.status(500).json({ error: "Failed to load week status" });
  }
});

export default router;
