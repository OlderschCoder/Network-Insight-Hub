import { Router } from "express";
import { db, entriesTable, reportsTable, risksTable, networkSwitchesTable, afterActionReportsTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { logger } from "../lib/logger";

const router = Router();
// Cisco retired analytics.webexapis.com for Calling CDRs in February 2026.
const WEBEX_CDR_BASE_URL = "https://analytics-calling.webexapis.com/v1";
const DEFAULT_IT_HUNT_GROUP_NAME = "Information Technology";
const DEFAULT_IT_HUNT_GROUP_EXTENSION = "1200";
const DEFAULT_IT_HUNT_GROUP_PHONE_NUMBER = "+16204171200";
// The CDR feed accepts a maximum 12-hour interval per initial request.
const DEFAULT_IT_HUNT_GROUP_WINDOW_HOURS = 12;
let webexDashboardAccessToken = process.env.WEBEX_CDR_ACCESS_TOKEN || "";
type CachedCdrResult = { items: Array<Record<string, unknown>>; error: string | null };
let webexCdrCache: { expiresAt: number; result: CachedCdrResult } | null = null;
let webexCdrInFlight: Promise<CachedCdrResult> | null = null;

type ItHuntGroupSummary = {
  itHuntGroupConfigured: boolean;
  itHuntGroupName: string;
  itHuntGroupExtension: string;
  itHuntGroupPhoneNumber: string;
  itHuntGroupWindowHours: number;
  itHuntGroupCalls: number;
  itHuntGroupAnswered: number;
  itHuntGroupUnanswered: number;
  itHuntGroupAnswerRate: number;
  itHuntGroupLastRefreshedAt: string | null;
  itHuntGroupError: string | null;
};

function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

function getItHuntGroupWindowHours(): number {
  const raw = Number(process.env.WEBEX_IT_HUNT_GROUP_WINDOW_HOURS ?? DEFAULT_IT_HUNT_GROUP_WINDOW_HOURS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_IT_HUNT_GROUP_WINDOW_HOURS;
  return Math.min(Math.trunc(raw), 12);
}

function hasWebexDashboardConfig() {
  return !!(
    process.env.WEBEX_CDR_ACCESS_TOKEN ||
    (process.env.WEBEX_CDR_REFRESH_TOKEN && process.env.WEBEX_CDR_CLIENT_ID && process.env.WEBEX_CDR_CLIENT_SECRET)
  );
}

async function refreshWebexDashboardAccessToken(): Promise<boolean> {
  const refreshToken = process.env.WEBEX_CDR_REFRESH_TOKEN;
  const clientId = process.env.WEBEX_CDR_CLIENT_ID;
  const clientSecret = process.env.WEBEX_CDR_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) return false;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const response = await fetch("https://webexapis.com/v1/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return false;
  const tokens = await response.json() as { access_token?: string; refresh_token?: string };
  if (!tokens.access_token) return false;
  webexDashboardAccessToken = tokens.access_token;
  if (tokens.refresh_token) process.env.WEBEX_CDR_REFRESH_TOKEN = tokens.refresh_token;
  return true;
}

async function webexDashboardFetch(pathname: string, retry = true): Promise<Response> {
  if (!webexDashboardAccessToken) webexDashboardAccessToken = process.env.WEBEX_CDR_ACCESS_TOKEN || "";
  if (!webexDashboardAccessToken && !(await refreshWebexDashboardAccessToken())) {
    throw new Error("Webex is not configured");
  }
  const response = await fetch(`${WEBEX_CDR_BASE_URL}${pathname}`, {
    headers: {
      Authorization: `Bearer ${webexDashboardAccessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401 && retry && await refreshWebexDashboardAccessToken()) {
    return webexDashboardFetch(pathname, false);
  }
  return response;
}

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeComparableValue(value: string): string {
  return value.replace(/[^\da-z+]/gi, "").toLowerCase();
}

function buildRecordLookup(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>;
}

function getRecordString(record: Record<string, unknown>, candidates: string[]): string {
  const lookup = buildRecordLookup(record);
  for (const candidate of candidates) {
    const value = lookup[candidate.toLowerCase()];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function recordTargetsItHuntGroup(record: Record<string, unknown>, targets: { fullNumberDigits: string; extension: string }) {
  const candidateValues = [
    getRecordString(record, ["Called Number", "calledNumber"]),
    getRecordString(record, ["Original Called Number", "originalCalledNumber"]),
    getRecordString(record, ["Called Number URI", "calledNumberUri"]),
    getRecordString(record, ["Original Called Number URI", "originalCalledNumberUri"]),
    getRecordString(record, ["Called Line ID", "calledLineId"]),
    getRecordString(record, ["Called Party Number", "calledPartyNumber"]),
    getRecordString(record, ["Dialed Digits", "dialedDigits"]),
    getRecordString(record, ["Redirecting number", "redirectingNumber"]),
    getRecordString(record, ["Redirecting party number", "redirectingPartyNumber"]),
    getRecordString(record, ["Original called party number", "originalCalledPartyNumber"]),
  ].filter(Boolean);

  if (!candidateValues.length) return false;

  return candidateValues.some((value) => {
    const digits = normalizeDigits(value);
    if (targets.fullNumberDigits && digits.includes(targets.fullNumberDigits)) return true;
    const comparable = normalizeComparableValue(value);
    return !!targets.extension && comparable.includes(targets.extension.toLowerCase());
  });
}

function recordWasAnswered(record: Record<string, unknown>) {
  const answer = getRecordString(record, ["Answer Indicator", "answerIndicator", "Answered", "answered"]);
  if (!answer) return false;
  const normalized = answer.trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "answered";
}

async function getCachedWebexCdr(windowHours: number): Promise<CachedCdrResult> {
  if (webexCdrCache && webexCdrCache.expiresAt > Date.now()) return webexCdrCache.result;
  if (webexCdrInFlight) return webexCdrInFlight;
  webexCdrInFlight = (async () => {
    try {
      const endTime = new Date(Date.now() - 6 * 60 * 1000);
      const startTime = new Date(endTime.getTime() - windowHours * 60 * 60 * 1000);
      const params = new URLSearchParams({ startTime: startTime.toISOString(), endTime: endTime.toISOString(), max: "2000" });
      const response = await webexDashboardFetch(`/cdr_feed?${params.toString()}`);
      if (!response.ok) {
        const error = response.status === 403 ? "Webex authorization required"
          : response.status === 429 ? "Webex is temporarily rate limiting call history; retrying automatically"
          : `Webex call history unavailable (${response.status})`;
        return { items: [], error };
      }
      const payload = await response.json() as { items?: Array<Record<string, unknown>> };
      return { items: Array.isArray(payload.items) ? payload.items : [], error: null };
    } catch (err: any) {
      return { items: [], error: err?.message || "Webex call history unavailable" };
    }
  })();
  const result = await webexCdrInFlight;
  webexCdrInFlight = null;
  webexCdrCache = { expiresAt: Date.now() + (result.error ? 60_000 : 5 * 60_000), result };
  return result;
}

function numberValue(record: Record<string, unknown>, candidates: string[]): number {
  const value = Number(getRecordString(record, candidates));
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function nullableDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function persistTargetCallLegs(items: Array<Record<string, unknown>>): Promise<number> {
  const phoneNumber = process.env.WEBEX_IT_HUNT_GROUP_PHONE_NUMBER || DEFAULT_IT_HUNT_GROUP_PHONE_NUMBER;
  const extension = process.env.WEBEX_IT_HUNT_GROUP_EXTENSION || DEFAULT_IT_HUNT_GROUP_EXTENSION;
  const targets = { fullNumberDigits: normalizeDigits(phoneNumber), extension: normalizeDigits(extension) || extension };
  const targetCorrelations = new Set(items.filter((item) => recordTargetsItHuntGroup(item, targets)).map((item) => getRecordString(item, ["Correlation ID"])).filter(Boolean));
  const legs = items.filter((item) => targetCorrelations.has(getRecordString(item, ["Correlation ID"])));
  let stored = 0;
  for (const record of legs) {
    const correlationId = getRecordString(record, ["Correlation ID"]);
    const startTime = nullableDate(getRecordString(record, ["Start time"]));
    if (!correlationId || !startTime) continue;
    const reportId = getRecordString(record, ["Report ID"]) || [correlationId, getRecordString(record, ["Local call ID", "Remote call ID"]), startTime.toISOString(), getRecordString(record, ["User UUID"])].join(":");
    await db.execute(sql`
      INSERT INTO "webex_it_call_legs" (
        "report_id", "correlation_id", "start_time", "answer_time", "release_time",
        "answered", "ring_duration_seconds", "duration_seconds", "user_id", "user_name",
        "user_type", "called_number", "redirecting_number", "is_hunt_group_leg", "ingested_at"
      ) VALUES (
        ${reportId}, ${correlationId}, ${startTime}, ${nullableDate(getRecordString(record, ["Answer time"]))},
        ${nullableDate(getRecordString(record, ["Release time"]))}, ${recordWasAnswered(record)},
        ${numberValue(record, ["Ring duration"])}, ${numberValue(record, ["Duration"])},
        ${getRecordString(record, ["User UUID"]) || null}, ${getRecordString(record, ["User"]) || null},
        ${getRecordString(record, ["User type"]) || null}, ${getRecordString(record, ["Called number"]) || null},
        ${getRecordString(record, ["Redirecting number"]) || null}, ${recordTargetsItHuntGroup(record, targets)}, now()
      ) ON CONFLICT ("report_id") DO UPDATE SET
        "answered" = EXCLUDED."answered", "answer_time" = EXCLUDED."answer_time",
        "release_time" = EXCLUDED."release_time", "ring_duration_seconds" = EXCLUDED."ring_duration_seconds",
        "duration_seconds" = EXCLUDED."duration_seconds", "user_name" = EXCLUDED."user_name",
        "is_hunt_group_leg" = EXCLUDED."is_hunt_group_leg", "ingested_at" = now()
    `);
    stored++;
  }
  return stored;
}

async function fetchCdrWindow(startTime: Date, endTime: Date): Promise<CachedCdrResult> {
  const params = new URLSearchParams({ startTime: startTime.toISOString(), endTime: endTime.toISOString(), max: "2000" });
  try {
    const response = await webexDashboardFetch(`/cdr_feed?${params.toString()}`);
    if (!response.ok) return { items: [], error: `Webex call history unavailable (${response.status})` };
    const payload = await response.json() as { items?: Array<Record<string, unknown>> };
    return { items: Array.isArray(payload.items) ? payload.items : [], error: null };
  } catch (err: any) {
    return { items: [], error: err?.message || "Webex call history unavailable" };
  }
}

let historySyncRunning = false;
let syncRecentNext = true;
async function syncWebexCallHistory(): Promise<void> {
  if (historySyncRunning || !hasWebexDashboardConfig()) return;
  historySyncRunning = true;
  try {
    const end = new Date(Date.now() - 6 * 60 * 1000);
    const stateResult: any = await db.execute(sql`SELECT "backfill_cursor" FROM "webex_it_call_sync_state" WHERE "id" = 1`);
    const cursorRaw = stateResult?.rows?.[0]?.backfill_cursor;
    const cursor = cursorRaw ? new Date(cursorRaw) : new Date(end.getTime() - 4 * 60 * 60 * 1000);
    const minimum = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    if (syncRecentNext) {
      const recent = await fetchCdrWindow(new Date(end.getTime() - 4 * 60 * 60 * 1000), end);
      if (recent.error) throw new Error(recent.error);
      await persistTargetCallLegs(recent.items);
      await db.execute(sql`UPDATE "webex_it_call_sync_state" SET "backfill_cursor"=COALESCE("backfill_cursor", ${cursor}), "last_success_at"=now(), "last_error"=NULL, "updated_at"=now() WHERE "id"=1`);
      syncRecentNext = false;
    } else if (cursor > minimum) {
      const backfillEnd = cursor;
      const backfillStart = new Date(Math.max(minimum.getTime(), backfillEnd.getTime() - 4 * 60 * 60 * 1000));
      const backfill = await fetchCdrWindow(backfillStart, backfillEnd);
      if (backfill.error) throw new Error(backfill.error);
      await persistTargetCallLegs(backfill.items);
      await db.execute(sql`UPDATE "webex_it_call_sync_state" SET "backfill_cursor"=${backfillStart}, "last_success_at"=now(), "last_error"=NULL, "updated_at"=now() WHERE "id"=1`);
      syncRecentNext = true;
    } else {
      await db.execute(sql`UPDATE "webex_it_call_sync_state" SET "last_success_at"=now(), "last_error"=NULL, "updated_at"=now() WHERE "id"=1`);
      syncRecentNext = true;
    }
    await db.execute(sql`DELETE FROM "webex_it_call_legs" WHERE "start_time" < now() - interval '100 days'`);
  } catch (err: any) {
    logger.warn({ err }, "Webex call history sync failed");
    await db.execute(sql`UPDATE "webex_it_call_sync_state" SET "last_error"=${err?.message || "Sync failed"}, "updated_at"=now() WHERE "id"=1`).catch(() => undefined);
  } finally {
    historySyncRunning = false;
  }
}

export function startWebexCallHistorySync(): void {
  setTimeout(() => void syncWebexCallHistory(), 15_000);
  setInterval(() => void syncWebexCallHistory(), 3 * 60 * 1000).unref();
}

async function getItHuntGroupSummary(): Promise<ItHuntGroupSummary> {
  const name = process.env.WEBEX_IT_HUNT_GROUP_NAME || DEFAULT_IT_HUNT_GROUP_NAME;
  const extension = process.env.WEBEX_IT_HUNT_GROUP_EXTENSION || DEFAULT_IT_HUNT_GROUP_EXTENSION;
  const phoneNumber = process.env.WEBEX_IT_HUNT_GROUP_PHONE_NUMBER || DEFAULT_IT_HUNT_GROUP_PHONE_NUMBER;
  const windowHours = getItHuntGroupWindowHours();

  const baseSummary: ItHuntGroupSummary = {
    itHuntGroupConfigured: hasWebexDashboardConfig(),
    itHuntGroupName: name,
    itHuntGroupExtension: extension,
    itHuntGroupPhoneNumber: phoneNumber,
    itHuntGroupWindowHours: windowHours,
    itHuntGroupCalls: 0,
    itHuntGroupAnswered: 0,
    itHuntGroupUnanswered: 0,
    itHuntGroupAnswerRate: 0,
    itHuntGroupLastRefreshedAt: null,
    itHuntGroupError: null,
  };

  if (!baseSummary.itHuntGroupConfigured) {
    return baseSummary;
  }

  try {
    const cdr = await getCachedWebexCdr(windowHours);
    if (cdr.error) return { ...baseSummary, itHuntGroupError: cdr.error };
    const items = cdr.items;
    const targets = {
      fullNumberDigits: normalizeDigits(phoneNumber),
      extension: normalizeDigits(extension) || extension,
    };
    const matching = items.filter((record) => recordTargetsItHuntGroup(record, targets));
    const answered = matching.filter(recordWasAnswered).length;
    const unanswered = Math.max(0, matching.length - answered);
    const answerRate = matching.length > 0 ? Math.round((answered / matching.length) * 100) : 0;

    return {
      ...baseSummary,
      itHuntGroupCalls: matching.length,
      itHuntGroupAnswered: answered,
      itHuntGroupUnanswered: unanswered,
      itHuntGroupAnswerRate: answerRate,
      itHuntGroupLastRefreshedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    logger.warn({ err }, "Webex hunt group summary unavailable");
    return {
      ...baseSummary,
      itHuntGroupError: err?.message || "Webex call history unavailable",
    };
  }
}

const SUBMITTING_ROLES = new Set([
  "helpdesk",
  "network",
  "security",
  "network_engineer",
  "security_engineer",
]);

router.get("/it-calls", requireAuth, async (req: any, res) => {
  const name = process.env.WEBEX_IT_HUNT_GROUP_NAME || DEFAULT_IT_HUNT_GROUP_NAME;
  const extension = process.env.WEBEX_IT_HUNT_GROUP_EXTENSION || DEFAULT_IT_HUNT_GROUP_EXTENSION;
  const phoneNumber = process.env.WEBEX_IT_HUNT_GROUP_PHONE_NUMBER || DEFAULT_IT_HUNT_GROUP_PHONE_NUMBER;
  const today = new Date();
  const defaultStart = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const requestedStart = nullableDate(String(req.query.start || "")) || defaultStart;
  const requestedEnd = nullableDate(String(req.query.end || "")) || today;
  const minimum = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const start = requestedStart < minimum ? minimum : requestedStart;
  const end = requestedEnd > today ? today : requestedEnd;
  const empty = { name, extension, phoneNumber, retentionDays: 90, start: start.toISOString(), end: end.toISOString(), calls: 0, answered: 0, unanswered: 0, unansweredRingAttempts: 0, answerRate: 0, averageRingSeconds: 0, daily: [], employees: [] };
  if (!hasWebexDashboardConfig()) return res.json({ ...empty, configured: false, error: "Webex Calling Reports is awaiting authorization" });
  try {
    void syncWebexCallHistory();
    const report: any = await db.execute(sql`
      WITH eligible AS (
        SELECT DISTINCT "correlation_id" FROM "webex_it_call_legs"
        WHERE "is_hunt_group_leg" AND "start_time" >= ${start} AND "start_time" < ${end}
      ), calls AS (
        SELECT l."correlation_id", min(l."start_time") AS call_time,
          bool_or(l."answered" AND l."user_type" = 'User' AND regexp_replace(COALESCE(l."redirecting_number", ''), '\D', '', 'g') LIKE ${`%${normalizeDigits(extension)}`}) AS answered,
          max(l."ring_duration_seconds") FILTER (WHERE l."answered" AND l."user_type" = 'User' AND regexp_replace(COALESCE(l."redirecting_number", ''), '\D', '', 'g') LIKE ${`%${normalizeDigits(extension)}`}) AS ring_seconds
        FROM "webex_it_call_legs" l JOIN eligible e USING ("correlation_id") GROUP BY l."correlation_id"
      )
      SELECT count(*)::int AS calls,
        count(*) FILTER (WHERE answered)::int AS answered,
        count(*) FILTER (WHERE NOT answered)::int AS unanswered,
        COALESCE(round(avg(ring_seconds) FILTER (WHERE answered), 1), 0) AS average_ring_seconds,
        (SELECT count(*)::int FROM "webex_it_call_legs" l JOIN eligible e USING ("correlation_id")
          WHERE l."user_type"='User' AND NOT l."answered" AND l."ring_duration_seconds" > 0
          AND regexp_replace(COALESCE(l."redirecting_number", ''), '\D', '', 'g') LIKE ${`%${normalizeDigits(extension)}`}) AS unanswered_ring_attempts
      FROM calls
    `);
    const dailyResult: any = await db.execute(sql`
      WITH eligible AS (
        SELECT DISTINCT "correlation_id" FROM "webex_it_call_legs"
        WHERE "is_hunt_group_leg" AND "start_time" >= ${start} AND "start_time" < ${end}
      ), calls AS (
        SELECT l."correlation_id", min(l."start_time") AS call_time,
          bool_or(l."answered" AND l."user_type" = 'User' AND regexp_replace(COALESCE(l."redirecting_number", ''), '\D', '', 'g') LIKE ${`%${normalizeDigits(extension)}`}) AS answered
        FROM "webex_it_call_legs" l JOIN eligible e USING ("correlation_id") GROUP BY l."correlation_id"
      )
      SELECT to_char(date_trunc('day', call_time AT TIME ZONE 'America/Chicago'), 'YYYY-MM-DD') AS day,
        count(*)::int AS calls, count(*) FILTER (WHERE answered)::int AS answered,
        count(*) FILTER (WHERE NOT answered)::int AS unanswered
      FROM calls GROUP BY 1 ORDER BY 1
    `);
    const employeeResult: any = await db.execute(sql`
      WITH eligible AS (
        SELECT DISTINCT "correlation_id" FROM "webex_it_call_legs"
        WHERE "is_hunt_group_leg" AND "start_time" >= ${start} AND "start_time" < ${end}
      ), answered_legs AS (
        SELECT l.*, row_number() OVER (PARTITION BY l."correlation_id" ORDER BY l."answer_time" NULLS LAST, l."start_time") AS rn
        FROM "webex_it_call_legs" l JOIN eligible e USING ("correlation_id")
        WHERE l."answered" AND l."user_type" = 'User' AND COALESCE(l."user_name", '') <> ''
          AND regexp_replace(COALESCE(l."redirecting_number", ''), '\D', '', 'g') LIKE ${`%${normalizeDigits(extension)}`}
      )
      SELECT "user_name" AS employee, count(*)::int AS answered,
        COALESCE(round(avg("ring_duration_seconds"), 1), 0) AS average_ring_seconds
      FROM answered_legs WHERE rn = 1 GROUP BY "user_name" ORDER BY answered DESC, employee
    `);
    const statusResult: any = await db.execute(sql`
      SELECT min("start_time") AS data_from, max("start_time") AS data_through,
        (SELECT "backfill_cursor" FROM "webex_it_call_sync_state" WHERE "id"=1) AS backfill_cursor,
        (SELECT "last_success_at" FROM "webex_it_call_sync_state" WHERE "id"=1) AS last_success_at,
        (SELECT "last_error" FROM "webex_it_call_sync_state" WHERE "id"=1) AS sync_error
      FROM "webex_it_call_legs"
    `);
    const totals = report?.rows?.[0] || {};
    const calls = Number(totals.calls || 0);
    const answered = Number(totals.answered || 0);
    return res.json({ ...empty, configured: true, calls, answered, unanswered: Number(totals.unanswered || 0), unansweredRingAttempts: Number(totals.unanswered_ring_attempts || 0), answerRate: calls ? Math.round(answered / calls * 100) : 0, averageRingSeconds: Number(totals.average_ring_seconds || 0), daily: dailyResult?.rows || [], employees: employeeResult?.rows || [], ...(statusResult?.rows?.[0] || {}), lastRefreshedAt: new Date().toISOString(), error: null });
  } catch (err: any) {
    logger.warn({ err }, "Webex IT calls report unavailable");
    return res.json({ ...empty, configured: true, error: err?.message || "Webex call history unavailable" });
  }
});

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
      itHuntGroup,
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
      getItHuntGroupSummary(),
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
      ...itHuntGroup,
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
