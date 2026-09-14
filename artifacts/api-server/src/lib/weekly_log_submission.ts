/**
 * Only change a weekly log's submission state when the caller made an explicit
 * Save Draft / Submit choice. This keeps older API clients from silently
 * returning an already-submitted log to draft during an upsert.
 */
export function explicitWeeklyLogSubmissionUpdate(
  isSubmitted: boolean | undefined,
): { isSubmitted?: boolean } {
  return isSubmitted === undefined ? {} : { isSubmitted };
}
