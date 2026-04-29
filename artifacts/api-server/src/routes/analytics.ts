import { Router } from "express";
import {
  db,
  usersTable,
  entriesTable,
  risksTable,
  processesTable,
  projectsTable,
  reportsTable,
  afterActionReportsTable,
  logItemsTable,
  azureVmsTable,
  strategicObjectivesTable,
} from "@workspace/db";
import { sql, gte } from "drizzle-orm";
import { requireAuth, requireCIO } from "./auth";

const router = Router();

const FEATURE_KEYS = [
  "entries",
  "risks",
  "processes",
  "projects",
  "reports",
  "afterActions",
  "items",
  "azureVms",
  "objectives",
] as const;
type FeatureKey = (typeof FEATURE_KEYS)[number];

function clampDays(input: unknown): number {
  const n = typeof input === "string" ? parseInt(input, 10) : Number(input);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(365, Math.max(1, Math.floor(n)));
}

function startOfDayUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

router.get("/usage", requireAuth, requireCIO, async (req, res) => {
  const days = clampDays(req.query.days);
  // "last N days" means N calendar days INCLUDING today.
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const userIdCol = (col: any) => col;

  const groupCount = async (
    table: any,
    userCol: any,
    createdCol: any,
  ): Promise<Map<number, number>> => {
    const rows = await db
      .select({
        userId: userIdCol(userCol),
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(table)
      .where(gte(createdCol, since))
      .groupBy(userCol);
    const map = new Map<number, number>();
    for (const r of rows as Array<{ userId: number | null; count: number }>) {
      if (typeof r.userId === "number") map.set(r.userId, r.count);
    }
    return map;
  };

  const dailyCount = async (
    table: any,
    createdCol: any,
  ): Promise<Map<string, number>> => {
    const rows = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${createdCol}), 'YYYY-MM-DD')`.as(
          "day",
        ),
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(table)
      .where(gte(createdCol, since))
      .groupBy(sql`date_trunc('day', ${createdCol})`);
    const map = new Map<string, number>();
    for (const r of rows as Array<{ day: string; count: number }>) {
      map.set(r.day, (map.get(r.day) ?? 0) + r.count);
    }
    return map;
  };

  const [
    users,
    entriesByUser,
    risksByUser,
    processesByUser,
    projectsByUser,
    reportsByUser,
    afterActionsByUser,
    itemsByUser,
    azureVmsByUser,
    objectivesByUser,
    dailyEntries,
    dailyRisks,
    dailyProcesses,
    dailyProjects,
    dailyReports,
    dailyAfterActions,
    dailyItems,
    dailyAzureVms,
    dailyObjectives,
  ] = await Promise.all([
    db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        isActive: usersTable.isActive,
      })
      .from(usersTable),
    groupCount(entriesTable, entriesTable.userId, entriesTable.createdAt),
    groupCount(risksTable, risksTable.userId, risksTable.createdAt),
    groupCount(
      processesTable,
      processesTable.createdBy,
      processesTable.createdAt,
    ),
    groupCount(projectsTable, projectsTable.createdBy, projectsTable.createdAt),
    groupCount(reportsTable, reportsTable.createdBy, reportsTable.createdAt),
    groupCount(
      afterActionReportsTable,
      afterActionReportsTable.userId,
      afterActionReportsTable.createdAt,
    ),
    groupCount(logItemsTable, logItemsTable.userId, logItemsTable.createdAt),
    groupCount(azureVmsTable, azureVmsTable.createdBy, azureVmsTable.createdAt),
    groupCount(
      strategicObjectivesTable,
      strategicObjectivesTable.createdBy,
      strategicObjectivesTable.createdAt,
    ),
    dailyCount(entriesTable, entriesTable.createdAt),
    dailyCount(risksTable, risksTable.createdAt),
    dailyCount(processesTable, processesTable.createdAt),
    dailyCount(projectsTable, projectsTable.createdAt),
    dailyCount(reportsTable, reportsTable.createdAt),
    dailyCount(afterActionReportsTable, afterActionReportsTable.createdAt),
    dailyCount(logItemsTable, logItemsTable.createdAt),
    dailyCount(azureVmsTable, azureVmsTable.createdAt),
    dailyCount(strategicObjectivesTable, strategicObjectivesTable.createdAt),
  ]);

  const featureMaps: Record<FeatureKey, Map<number, number>> = {
    entries: entriesByUser,
    risks: risksByUser,
    processes: processesByUser,
    projects: projectsByUser,
    reports: reportsByUser,
    afterActions: afterActionsByUser,
    items: itemsByUser,
    azureVms: azureVmsByUser,
    objectives: objectivesByUser,
  };

  const perUser = users.map((u) => {
    const counts: Record<FeatureKey, number> = {
      entries: featureMaps.entries.get(u.id) ?? 0,
      risks: featureMaps.risks.get(u.id) ?? 0,
      processes: featureMaps.processes.get(u.id) ?? 0,
      projects: featureMaps.projects.get(u.id) ?? 0,
      reports: featureMaps.reports.get(u.id) ?? 0,
      afterActions: featureMaps.afterActions.get(u.id) ?? 0,
      items: featureMaps.items.get(u.id) ?? 0,
      azureVms: featureMaps.azureVms.get(u.id) ?? 0,
      objectives: featureMaps.objectives.get(u.id) ?? 0,
    };
    const total = FEATURE_KEYS.reduce((s, k) => s + counts[k], 0);
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive !== false,
      counts,
      total,
    };
  });

  const featureTotals: Record<FeatureKey, number> = Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, 0]),
  ) as Record<FeatureKey, number>;
  for (const row of perUser) {
    for (const k of FEATURE_KEYS) featureTotals[k] += row.counts[k];
  }

  const roleMap = new Map<string, { role: string; users: number; total: number }>();
  for (const row of perUser) {
    const r = roleMap.get(row.role) ?? { role: row.role, users: 0, total: 0 };
    r.users += 1;
    r.total += row.total;
    roleMap.set(row.role, r);
  }
  const roleBreakdown = Array.from(roleMap.values()).sort(
    (a, b) => b.total - a.total,
  );

  const dailyMap = new Map<string, number>();
  const addDaily = (m: Map<string, number>) => {
    for (const [k, v] of m.entries()) dailyMap.set(k, (dailyMap.get(k) ?? 0) + v);
  };
  addDaily(dailyEntries);
  addDaily(dailyRisks);
  addDaily(dailyProcesses);
  addDaily(dailyProjects);
  addDaily(dailyReports);
  addDaily(dailyAfterActions);
  addDaily(dailyItems);
  addDaily(dailyAzureVms);
  addDaily(dailyObjectives);

  const dailyActivity: { day: string; count: number }[] = [];
  const cursor = new Date(since);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= today.getTime()) {
    const day = startOfDayUtc(cursor);
    dailyActivity.push({ day, count: dailyMap.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const grandTotal = FEATURE_KEYS.reduce((s, k) => s + featureTotals[k], 0);
  const activeContributors = perUser.filter((u) => u.total > 0).length;

  return res.json({
    range: {
      days,
      start: since.toISOString(),
      end: new Date().toISOString(),
    },
    summary: {
      totalContributions: grandTotal,
      activeContributors,
      totalUsers: perUser.length,
    },
    perUser,
    featureTotals,
    roleBreakdown,
    dailyActivity,
  });
});

export default router;
