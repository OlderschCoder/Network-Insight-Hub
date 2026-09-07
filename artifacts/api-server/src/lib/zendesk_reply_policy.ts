export type ValidatedZendeskReply = {
  body: string;
  public: boolean;
};

export type ZendeskReplyValidation =
  | { ok: true; value: ValidatedZendeskReply }
  | { ok: false; status: 400 | 409; error: string };

export type ZendeskEscalationValidation =
  | {
      ok: true;
      value: { assigneeEmail: string; note: string | null };
    }
  | { ok: false; status: 400 | 409; error: string };

export type ZendeskControlRequest = {
  fredEnabled?: boolean;
  repliesEnabled?: boolean;
};

export type ZendeskControlValidation =
  | { ok: true; value: ZendeskControlRequest }
  | { ok: false; status: 400; error: string };

const MAX_REPLY_LENGTH = 10_000;

/**
 * Server-side guard for replies created in the supervised Zendesk monitor.
 * The browser confirmation is useful UX; this check is the actual safety
 * boundary that prevents a missing or forged UI step from posting a reply.
 */
export function validateZendeskReplyRequest(
  input: unknown,
): ZendeskReplyValidation {
  const payload =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const body = typeof payload.body === "string" ? payload.body.trim() : "";

  if (!body) {
    return { ok: false, status: 400, error: "Reply body is required." };
  }
  if (body.length > MAX_REPLY_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Reply body must be ${MAX_REPLY_LENGTH.toLocaleString()} characters or fewer.`,
    };
  }
  if (payload.confirmed !== true) {
    return {
      ok: false,
      status: 409,
      error: "Explicit confirmation is required before posting to Zendesk.",
    };
  }

  return {
    ok: true,
    value: { body, public: payload.public !== false },
  };
}

export function validateZendeskEscalationRequest(
  input: unknown,
): ZendeskEscalationValidation {
  const payload =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const assigneeEmail =
    typeof payload.assigneeEmail === "string"
      ? payload.assigneeEmail.trim().toLowerCase()
      : "";
  const note = typeof payload.note === "string" ? payload.note.trim() : "";

  if (!/^\S+@\S+\.\S+$/.test(assigneeEmail)) {
    return {
      ok: false,
      status: 400,
      error: "A valid assignee email is required.",
    };
  }
  if (note.length > 4_000) {
    return {
      ok: false,
      status: 400,
      error: "Escalation note must be 4,000 characters or fewer.",
    };
  }
  if (payload.confirmed !== true) {
    return {
      ok: false,
      status: 409,
      error:
        "Explicit confirmation is required before escalating a Zendesk ticket.",
    };
  }

  return {
    ok: true,
    value: { assigneeEmail, note: note || null },
  };
}

export function validateZendeskControlRequest(
  input: unknown,
): ZendeskControlValidation {
  if (!input || typeof input !== "object") {
    return { ok: false, status: 400, error: "Control settings are required." };
  }
  const body = input as Record<string, unknown>;
  const updates: ZendeskControlRequest = {};
  if (body.fredEnabled !== undefined) {
    if (typeof body.fredEnabled !== "boolean") {
      return {
        ok: false,
        status: 400,
        error: "fredEnabled must be a boolean.",
      };
    }
    updates.fredEnabled = body.fredEnabled;
  }
  if (body.repliesEnabled !== undefined) {
    if (typeof body.repliesEnabled !== "boolean") {
      return {
        ok: false,
        status: 400,
        error: "repliesEnabled must be a boolean.",
      };
    }
    updates.repliesEnabled = body.repliesEnabled;
  }
  if (Object.keys(updates).length === 0) {
    return {
      ok: false,
      status: 400,
      error: "At least one control must be supplied.",
    };
  }
  return { ok: true, value: updates };
}
