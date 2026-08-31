export const FRED_MAX_RECENT_MESSAGES = 12;
export const FRED_MAX_CHECKPOINT_CHARS = 8000;

export function boundFredMessages<T>(messages: T[]): T[] {
  return messages.slice(-FRED_MAX_RECENT_MESSAGES);
}
