import { Router } from "express";
import { db, entriesTable, reportsTable, risksTable, networkSwitchesTable, afterActionReportsTable, usersTable } from "@workspace/db";
import { eq, and, desc, gte, count } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

router.get("/summary", requireAuth, async (req: any, res) => {
  const weekOf = getWeekStart();

  const thisWeekEntries = await db.select().from(entriesTable).where(eq(entriesTable.weekOf, weekOf));
  const contributors = new Set(thisWeekEntries.map(e => e.userId));
  const totalTickets = thisWeekEntries.reduce((sum, e) => sum + (e.ticketCount ?? 0), 0);

  const openRisks = await db.select().from(risksTable).where(eq(risksTable.status, "open"));
  const criticalRisks = openRisks.filter(r => r.severity === "critical");

  const openAfterActions = await db.select().from(afterActionReportsTable)
    .where(eq(afterActionReportsTable.status, "open"));

  const allSwitches = await db.select().from(networkSwitchesTable);
  const onlineSwitches = allSwitches.filter(s => s.status === "online");
  const offlineSwitches = allSwitches.filter(s => s.status === "offline");

  const allReports = await db.select().from(reportsTable);

  const allUsers = await db.select().from(usersTable);
  const submittedUsers = new Set(thisWeekEntries.filter(e => e.isSubmitted).map(e => e.userId));
  const pendingSubmissions = allUsers.length - submittedUsers.size;

  return res.json({
    thisWeekEntries: thisWeekEntries.length,
    thisWeekContributors: contributors.size,
    openRisks: openRisks.length,
    criticalRisks: criticalRisks.length,
    openAfterActions: openAfterActions.length,
    totalSwitches: allSwitches.length,
    onlineSwitches: onlineSwitches.length,
    offlineSwitches: offlineSwitches.length,
    totalReports: allReports.length,
    pendingSubmissions: Math.max(0, pendingSubmissions),
    totalTickets,
  });
});

router.get("/activity", requireAuth, async (req: any, res) => {
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
});

router.get("/week-status", requireAuth, async (req: any, res) => {
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
});

export default router;
