import {
  getPendingZendeskReplyDraft,
  saveZendeskReplyDraft,
  type ZendeskReplyDraft,
} from "./zendesk_reply_drafts";
import { readZendeskSupervisionConfig } from "./zendesk_supervision";

type RecoveryDraftActor = {
  id?: number | null;
  name?: string | null;
  email?: string | null;
};

type ZendeskTicketResponse = {
  ticket?: {
    id?: number;
    status?: string;
    subject?: string;
    via?: { channel?: string };
  };
};

export type ZendeskRecoveryTicket = {
  id: number;
  status: string;
  subject: string;
  channel: string;
  url: string;
};

export type ZendeskRecoveryDraftResult =
  | { status: "saved"; draft: ZendeskReplyDraft }
  | { status: "fred_disabled" }
  | { status: "existing_draft"; draft: ZendeskReplyDraft };

const ACTIVE_TICKET_STATUSES = new Set(["new", "open", "pending", "hold"]);

function zendeskConfig() {
  const subdomain = process.env.ZENDESK_SUBDOMAIN?.trim();
  const email = process.env.ZENDESK_EMAIL?.trim();
  const token = process.env.ZENDESK_API_TOKEN?.trim();
  if (!subdomain || !email || !token) return null;
  return {
    subdomain,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}/token:${token}`).toString("base64")}`,
      "Content-Type": "application/json",
    } as Record<string, string>,
  };
}

export async function getZendeskRecoveryTicket(
  ticketId: number,
): Promise<ZendeskRecoveryTicket> {
  const config = zendeskConfig();
  if (!config) throw new Error("Zendesk is not configured on this server.");

  const response = await fetch(
    `https://${config.subdomain}.zendesk.com/api/v2/tickets/${ticketId}.json`,
    {
      headers: config.headers,
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    if (response.status === 404)
      throw new Error(`Zendesk ticket #${ticketId} was not found.`);
    throw new Error(
      `Zendesk could not verify ticket #${ticketId} (HTTP ${response.status}).`,
    );
  }

  const result = (await response.json()) as ZendeskTicketResponse;
  const ticket = result.ticket;
  if (!ticket || ticket.id !== ticketId)
    throw new Error(
      `Zendesk returned an invalid record for ticket #${ticketId}.`,
    );

  const status = String(ticket.status || "")
    .trim()
    .toLowerCase();
  if (!ACTIVE_TICKET_STATUSES.has(status)) {
    throw new Error(
      `Zendesk ticket #${ticketId} is ${status || "in an unknown state"}; use an active ticket for assisted recovery.`,
    );
  }

  return {
    id: ticketId,
    status: status || "unknown",
    subject: String(ticket.subject || `Ticket #${ticketId}`).trim(),
    channel: String(ticket.via?.channel || "ticket").trim(),
    url: `https://${config.subdomain}.zendesk.com/agent/tickets/${ticketId}`,
  };
}

export function buildIdentityRecoveryTicketReply(
  recoveryUrl: string,
  expiresUtc?: string | null,
): string {
  const expiry = String(expiresUtc || "").trim();
  return [
    "Your identity verification is complete, and we prepared a secure, single-use SCCC OnlineKiosk password-reset link:",
    recoveryUrl,
    expiry
      ? `Open the link before ${expiry} and choose your new password privately.`
      : "Open the link within 10 minutes and choose your new password privately.",
    "Completing the password reset clears the current Microsoft Entra account lockout. It does not re-enable an account that was administratively disabled.",
    "Do not send your password, MFA code, or Temporary Access Pass in this ticket. If the link expires, reply here and we will prepare another one.",
  ].join("\n\n");
}

export async function isZendeskFredDraftingEnabled(): Promise<boolean> {
  return (await readZendeskSupervisionConfig()).fredEnabled;
}

export async function saveIdentityRecoveryTicketDraft(input: {
  ticket: ZendeskRecoveryTicket;
  recoveryUrl: string;
  expiresUtc?: string | null;
  actor: RecoveryDraftActor;
}): Promise<ZendeskRecoveryDraftResult> {
  if (!(await isZendeskFredDraftingEnabled()))
    return { status: "fred_disabled" };

  const existing = await getPendingZendeskReplyDraft(input.ticket.id);
  if (existing) return { status: "existing_draft", draft: existing };

  const draft = await saveZendeskReplyDraft({
    ticketId: input.ticket.id,
    ticketSubject: input.ticket.subject,
    ticketUrl: input.ticket.url,
    channel: input.ticket.channel,
    body: buildIdentityRecoveryTicketReply(input.recoveryUrl, input.expiresUtc),
    source: "fred",
    actor: input.actor,
  });
  return { status: "saved", draft };
}
