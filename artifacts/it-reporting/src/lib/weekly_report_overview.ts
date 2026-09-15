export type WeeklyReportTicketResponse = {
  count?: unknown;
  configured?: unknown;
  tickets?: unknown;
};

export type WeeklyReportSubmissionStatus = {
  userId: number;
  userName: string;
  userRole: string;
  entryCount: number;
  isSubmitted: boolean;
};

/** Use the group-wide Zendesk result that also feeds report exports. */
export function resolvedTicketCount(
  response: WeeklyReportTicketResponse | null | undefined,
): number | null {
  if (!response) return null;
  if (response.configured === false) return null;
  if (
    typeof response.count === "number" &&
    Number.isInteger(response.count) &&
    response.count >= 0
  ) {
    return response.count;
  }
  return Array.isArray(response.tickets) ? response.tickets.length : null;
}

export function missingWeeklyLogSubmissions(
  submissions: readonly WeeklyReportSubmissionStatus[] | null | undefined,
): WeeklyReportSubmissionStatus[] {
  return (submissions ?? []).filter((submission) => !submission.isSubmitted);
}

export function weeklyLogSubmissionLabel(
  submission: Pick<WeeklyReportSubmissionStatus, "entryCount">,
): "Draft not submitted" | "No weekly log" {
  return submission.entryCount > 0 ? "Draft not submitted" : "No weekly log";
}
