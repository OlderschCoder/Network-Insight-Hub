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

router.post("/events", requireAuth, async (req: any, res) => {
  const eventType = String(req.body?.eventType ?? "");
  const path = String(req.body?.path ?? "").trim().slice(0, 500);
  const clientSessionId = String(req.body?.clientSessionId ?? "").trim().slice(0, 64);
  const durationSeconds = Math.max(0, Math.min(120, Math.floor(Number(req.body?.durationSeconds) || 0)));
  if (!['page_view', 'heartbeat', 'fred_message'].includes(eventType) || !path || !clientSessionId) {
    return res.status(400).json({ error: "valid eventType, path, and clientSessionId are required" });
  }
  await db.execute(sql`
    INSERT INTO product_usage_events (user_id, client_session_id, event_type, path, duration_seconds)
    VALUES (${req.user.id}, ${clientSessionId}, ${eventType}, ${path}, ${durationSeconds})
  `);
  return res.status(204).end();
});

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

  const engagementResult: any = await db.execute(sql`
    WITH session_counts AS (
      SELECT user_id, count(*)::int AS session_starts
        FROM sessions WHERE created_at >= ${since} GROUP BY user_id
    ), event_counts AS (
      SELECT user_id,
             count(*) FILTER (WHERE event_type = 'page_view')::int AS page_views,
             coalesce(sum(duration_seconds) FILTER (WHERE event_type = 'heartbeat'), 0)::int AS active_seconds,
             count(*) FILTER (WHERE event_type = 'fred_message')::int AS fred_messages,
             max(created_at) AS last_seen_at
        FROM product_usage_events WHERE created_at >= ${since} GROUP BY user_id
    )
    SELECT u.id AS user_id,
           coalesce(s.session_starts, 0)::int AS session_starts,
           coalesce(e.page_views, 0)::int AS page_views,
           coalesce(e.active_seconds, 0)::int AS active_seconds,
           coalesce(e.fred_messages, 0)::int AS fred_messages,
           e.last_seen_at
      FROM users u
      LEFT JOIN session_counts s ON s.user_id = u.id
      LEFT JOIN event_counts e ON e.user_id = u.id
  `);
  const engagementRows = Array.isArray(engagementResult?.rows) ? engagementResult.rows : engagementResult;
  const engagementByUser = new Map<number, any>();
  for (const row of engagementRows ?? []) engagementByUser.set(Number(row.user_id), row);

  const topPagesResult: any = await db.execute(sql`
    SELECT path, count(*)::int AS views, count(DISTINCT user_id)::int AS users
      FROM product_usage_events
     WHERE event_type = 'page_view' AND created_at >= ${since}
     GROUP BY path
     ORDER BY views DESC, path ASC
     LIMIT 20
  `);
  const topPages = (Array.isArray(topPagesResult?.rows) ? topPagesResult.rows : topPagesResult ?? []).map((row: any) => ({
    path: row.path,
    views: Number(row.views),
    users: Number(row.users),
  }));

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
    const engagement = engagementByUser.get(u.id);
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive !== false,
      counts,
      total,
      engagement: {
        sessionStarts: Number(engagement?.session_starts ?? 0),
        pageViews: Number(engagement?.page_views ?? 0),
        activeSeconds: Number(engagement?.active_seconds ?? 0),
        fredMessages: Number(engagement?.fred_messages ?? 0),
        lastSeenAt: engagement?.last_seen_at ? new Date(engagement.last_seen_at).toISOString() : null,
      },
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
  const engagedUsers = perUser.filter((u) => u.engagement.sessionStarts > 0 || u.engagement.pageViews > 0).length;
  const sessionStarts = perUser.reduce((sum, u) => sum + u.engagement.sessionStarts, 0);
  const pageViews = perUser.reduce((sum, u) => sum + u.engagement.pageViews, 0);
  const activeSeconds = perUser.reduce((sum, u) => sum + u.engagement.activeSeconds, 0);
  const fredMessages = perUser.reduce((sum, u) => sum + u.engagement.fredMessages, 0);

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
      engagedUsers,
      sessionStarts,
      pageViews,
      activeMinutes: Math.round(activeSeconds / 60),
      fredMessages,
    },
    perUser,
    featureTotals,
    roleBreakdown,
    dailyActivity,
    topPages,
    measurementNote: "Product engagement comes from authenticated sessions and events. Work-record counts are contributions, not proof that an assignee opened the application.",
  });
});

export default router;
