/**
 * Explicit draft/submit controls become authoritative at this release cutover.
 *
 * Before the cutover, Insights only exposed "Save Weekly Log" even though the
 * database column defaulted to false.  Treating those rows as drafts would make
 * historical reports disappear.  A legacy row remains report-eligible until it
 * is edited after the cutover; choosing Return to Draft updates `updatedAt` and
 * therefore removes it from department reporting.
 */
export const WEEKLY_LOG_SUBMISSION_CUTOVER_AT = "2026-09-14T17:30:00.000Z";

export type WeeklyReportEntryEligibility = {
  isSubmitted?: boolean | null;
  updatedAt?: Date | string | number | null;
};

export type WeeklyLogSubmissionStatus = {
  userId: number;
  userName: string;
  userRole: string;
  entryCount: number;
  isSubmitted: boolean;
};

function timestamp(value: WeeklyReportEntryEligibility["updatedAt"]): number {
  if (value == null) return Number.NaN;
  const parsed =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return parsed;
}

/**
 * One policy shared by report previews, finalization, exports, email, Zendesk,
 * dashboard submission state, and Fred's CIO report analysis.
 */
export function isWeeklyLogIncludedInDepartmentReport(
  entry: WeeklyReportEntryEligibility,
): boolean {
  if (entry.isSubmitted === true) return true;

  const updatedAt = timestamp(entry.updatedAt);
  return (
    Number.isFinite(updatedAt) &&
    updatedAt < Date.parse(WEEKLY_LOG_SUBMISSION_CUTOVER_AT)
  );
}

export function includedWeeklyLogs<T extends WeeklyReportEntryEligibility>(
  entries: readonly T[],
): T[] {
  return entries.filter(isWeeklyLogIncludedInDepartmentReport);
}

/**
 * Build the complete active-team checklist for a report week, including people
 * who have no weekly-log row at all. Without the zero-entry rows, a missing CIO
 * contribution is indistinguishable from someone outside the reporting team.
 */
export function weeklyLogSubmissionStatus<
  U extends { id: number; name?: string | null; role?: string | null },
  E extends WeeklyReportEntryEligibility & { userId: number },
>(users: readonly U[], entries: readonly E[]): WeeklyLogSubmissionStatus[] {
  return users.map((user) => {
    const userEntries = entries.filter((entry) => entry.userId === user.id);
    return {
      userId: user.id,
      userName: user.name ?? "Unknown",
      userRole: user.role ?? "unknown",
      entryCount: userEntries.length,
      isSubmitted: userEntries.some(isWeeklyLogIncludedInDepartmentReport),
    };
  });
}

export function includedWeeklyLogUserIds<
  T extends WeeklyReportEntryEligibility & { userId: number },
>(entries: readonly T[]): Set<number> {
  return new Set(includedWeeklyLogs(entries).map((entry) => entry.userId));
}

export function weeklyLogOwnerWeekKey(userId: number, weekOf: string): string {
  return `${userId}:${weekOf}`;
}

export function includedWeeklyLogOwnerWeeks<
  T extends WeeklyReportEntryEligibility & { userId: number; weekOf: string },
>(entries: readonly T[]): Set<string> {
  return new Set(
    includedWeeklyLogs(entries).map((entry) =>
      weeklyLogOwnerWeekKey(entry.userId, entry.weekOf),
    ),
  );
}

/**
 * A saved task selection can narrow an eligible user's items, but it cannot
 * force an item from a draft user's weekly log back into a department report.
 */
export function selectedItemsForIncludedWeeklyLogs<
  T extends { id: number; userId: number },
>(
  items: readonly T[],
  eligibleUserIds: ReadonlySet<number>,
  selectedItemIds: readonly number[] | null | undefined,
): T[] {
  const eligibleItems = items.filter((item) =>
    eligibleUserIds.has(item.userId),
  );
  if (selectedItemIds == null) return eligibleItems;

  const selected = new Set(selectedItemIds);
  return eligibleItems.filter((item) => selected.has(item.id));
}
