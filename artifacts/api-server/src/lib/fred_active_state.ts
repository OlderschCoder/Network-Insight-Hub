type FredMessage = { role?: string; content?: unknown };

const ACTIVE_STATE_PATTERN = /\b(?:bypass(?:ed|ing)?|temporar(?:y|ily)|right now|currently|for now|until|disconnect(?:ed|ing)?|unplugged|plugged|connect(?:ed|ing)? directly|moved|removed|restor(?:e|ed|ing)|reconnect(?:ed|ing)?|back to normal|returned to normal)\b/i;

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && typeof part === "object" && (part as any).type === "text")
    .map((part) => String((part as any).text ?? ""))
    .join("\n");
}

function candidateLines(text: string): string[] {
  return text
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 8 && line.length <= 800 && ACTIVE_STATE_PATTERN.test(line));
}

/** Preserve temporary operational changes separately from durable memory. */
export function extractActiveIncidentState(messages: FredMessage[], checkpoint = ""): string {
  const checkpointUserLines = checkpoint
    .split(/\r?\n/)
    .filter((line) => /^Mark\/team:/i.test(line))
    .flatMap(candidateLines);
  const currentUserLines = messages
    .filter((message) => message?.role === "user")
    .flatMap((message) => candidateLines(textContent(message.content)));

  return Array.from(new Set([...checkpointUserLines, ...currentUserLines]))
    .slice(-10)
    .join("\n")
    .slice(-3000);
}
