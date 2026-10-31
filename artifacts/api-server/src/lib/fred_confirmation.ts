export function normalizeForComparison(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Destructive actions are authorized only by an exact, standalone line in the
 * current user message. A model-generated or quoted phrase in surrounding
 * prose cannot satisfy this check.
 */
export function deleteConfirmationMatches(
  latestUserMessage: string | undefined,
  resource: string,
  identifier: string | number,
): boolean {
  const expected = normalizeForComparison(`CONFIRM DELETE ${resource} ${identifier}`);
  return String(latestUserMessage || "")
    .split(/\r?\n/)
    .some((line) => normalizeForComparison(line) === expected);
}

export function deleteConfirmationMessage(
  resource: string,
  identifier: string | number,
  label: string,
): string {
  return `Confirmation required before deleting ${label}. Reply with exactly this line:\nCONFIRM DELETE ${resource} ${identifier}`;
}
