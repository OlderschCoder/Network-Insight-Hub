export type ZendeskDraftComment = {
  author: string;
  authorType?: string;
  public: boolean;
  body: string;
};

export type ZendeskDraftCandidate = {
  status: string;
  assigneeName?: string | null;
  comments: ZendeskDraftComment[];
};

export type ZendeskDraftAssessment =
  | { shouldDraft: true; reason: "requester_waiting" }
  | { shouldDraft: false; reason: string };

const TEAM_AUTHOR_TYPES = new Set(["agent", "admin", "team_member"]);
const AUTOMATED_AUTHOR_TYPES = new Set(["bot", "system", "automation"]);

function normalized(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function assessZendeskTicketForDraft(
  ticket: ZendeskDraftCandidate,
): ZendeskDraftAssessment {
  const status = normalized(ticket.status);
  if (status === "pending") {
    return { shouldDraft: false, reason: "Waiting on the requester" };
  }
  if (status === "solved" || status === "closed") {
    return { shouldDraft: false, reason: "Ticket is already resolved" };
  }

  const latestPublic = [...ticket.comments]
    .reverse()
    .find((comment) => comment.public && comment.body.trim().length > 0);
  if (!latestPublic) {
    return { shouldDraft: false, reason: "No public requester message" };
  }

  const authorType = normalized(latestPublic.authorType);
  const author = normalized(latestPublic.author);
  const assignee = normalized(ticket.assigneeName);
  if (TEAM_AUTHOR_TYPES.has(authorType) || (assignee && author === assignee)) {
    return { shouldDraft: false, reason: "The latest public reply is from staff" };
  }
  if (AUTOMATED_AUTHOR_TYPES.has(authorType)) {
    return { shouldDraft: false, reason: "Waiting after an automated response" };
  }

  return { shouldDraft: true, reason: "requester_waiting" };
}

export function cleanFredDraft(value: string) {
  return value
    .replace(/^\*\*?Draft public reply[^\n]*\*\*?:?\s*/i, "")
    .replace(/^Draft public reply[^\n]*:?\s*/i, "")
    .replace(/\n+No (comments|reply|changes)[\s\S]*$/i, "")
    .trim();
}

export function parseFredDraftDecision(value: string) {
  const cleaned = cleanFredDraft(value);
  const noDraft = cleaned.match(/^NO_DRAFT\s*:?\s*(.*)$/is);
  if (noDraft) {
    return {
      body: null,
      reason: noDraft[1]?.trim() || "Fred found no safe reply to prepare",
    };
  }
  if (!cleaned) {
    return { body: null, reason: "Fred returned an empty draft" };
  }
  return { body: cleaned, reason: null };
}
