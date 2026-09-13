import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  getZendeskRecoveryTicket,
  isZendeskFredDraftingEnabled,
  saveIdentityRecoveryTicketDraft,
} from "./zendesk_recovery_draft";
import { isZendeskMessagingChannel } from "./zendesk_conversation_log";

export type IdentityRecoveryActor = {
  id: number | null;
  name?: string | null;
  role?: string | null;
};

export type IdentityRecoveryInput = {
  legalFirstName: string;
  legalLastName: string;
  studentId: string;
  username: string;
  zendeskTicketId: number;
  verificationMethod: string;
  identityVerified: boolean;
  confirmed: boolean;
};

type BrokerResponse = {
  status?: string;
  recoveryUrl?: string;
  expiresUtc?: string;
  displayName?: string;
  upn?: string;
  error?: string;
  message?: string;
};

const DEFAULT_BROKER_URL = "http://10.0.0.45/internal/admin-recovery-link";
const DEFAULT_KEY_PATH = "/etc/sccc-identity-recovery.key";
const DEFAULT_ALLOWED_ROLES = new Set(["cio", "helpdesk"]);
const STUDENT_ID_PATTERN = /^800\d{6}$/;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}(?:@sccc\.edu)?$/i;
const NAME_PATTERN = /^[\p{L}][\p{L}' -]{0,79}$/u;

function allowedRoles(): Set<string> {
  const configured = process.env.IDENTITY_RECOVERY_ALLOWED_ROLES;
  if (!configured) return DEFAULT_ALLOWED_ROLES;
  return new Set(
    configured
      .split(",")
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function canPrepareIdentityRecovery(
  actor: IdentityRecoveryActor,
): boolean {
  return (
    actor.id != null &&
    allowedRoles().has(
      String(actor.role || "")
        .trim()
        .toLowerCase(),
    )
  );
}

export function identityRecoveryKeyPath(): string {
  return (
    process.env.IDENTITY_RECOVERY_HMAC_KEY_PATH?.trim() || DEFAULT_KEY_PATH
  );
}

export function isIdentityRecoveryConfigured(): boolean {
  const brokerUrl =
    process.env.IDENTITY_RECOVERY_BROKER_URL?.trim() || DEFAULT_BROKER_URL;
  return Boolean(brokerUrl && existsSync(identityRecoveryKeyPath()));
}

export function validateIdentityRecoveryInput(
  input: IdentityRecoveryInput,
): string | null {
  if (!NAME_PATTERN.test(input.legalFirstName))
    return "A valid legal first name is required.";
  if (!NAME_PATTERN.test(input.legalLastName))
    return "A valid legal last name is required.";
  if (!STUDENT_ID_PATTERN.test(input.studentId))
    return "The full nine-digit student number beginning with 800 is required.";
  if (!USERNAME_PATTERN.test(input.username))
    return "A valid SCCC username is required.";
  if (!Number.isInteger(input.zendeskTicketId) || input.zendeskTicketId < 1)
    return "A valid Zendesk ticket ID is required for the audit trail.";
  if (
    ![
      "in_person_photo_id",
      "callback_to_number_on_file",
      "live_video_photo_id",
    ].includes(input.verificationMethod)
  ) {
    return "Use an approved independent identity-verification method.";
  }
  if (!input.identityVerified)
    return "Independent identity verification must be completed before preparing a reset.";
  if (!input.confirmed)
    return "Confirmation required. Show the matched identifiers, Zendesk ticket ID, verification method, and that Fred will create a ten-minute private reset link; then ask the operator to confirm.";
  return null;
}

export function signIdentityRecoveryRequest(
  key: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return crypto
    .createHmac("sha256", key)
    .update(`${timestamp}\n${nonce}\n${body}`, "utf8")
    .digest("hex");
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function safeRecoveryUrl(value: unknown): string | null {
  try {
    const url = new URL(clean(value));
    const allowedHost =
      process.env.IDENTITY_RECOVERY_PUBLIC_HOST?.trim().toLowerCase() ||
      "app-server2.centralus.cloudapp.azure.com";
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== allowedHost ||
      !url.pathname.startsWith("/online-kiosk/assisted/")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function prepareIdentityRecovery(
  input: IdentityRecoveryInput,
  actor: IdentityRecoveryActor,
): Promise<string> {
  if (!canPrepareIdentityRecovery(actor))
    return "Error: only authorized CIO and help-desk staff may prepare an Entra recovery link.";
  const validationError = validateIdentityRecoveryInput(input);
  if (validationError) return `Error: ${validationError}`;

  let ticket;
  try {
    ticket = await getZendeskRecoveryTicket(input.zendeskTicketId);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : "Zendesk could not verify the ticket."} No account was changed.`;
  }
  if (!(await isZendeskFredDraftingEnabled())) {
    return "Error: Fred drafting is turned off by a supervisor. No recovery link was created and no account was changed.";
  }

  const key = (await readFile(identityRecoveryKeyPath(), "utf8")).trim();
  if (key.length < 32)
    return "Error: the identity-recovery signing key is missing or invalid.";

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(24).toString("hex");
  const username = input.username.includes("@")
    ? input.username.toLowerCase()
    : `${input.username.toLowerCase()}@sccc.edu`;
  const body = JSON.stringify({
    legalFirstName: input.legalFirstName,
    legalLastName: input.legalLastName,
    studentId: input.studentId,
    username,
    zendeskTicketId: input.zendeskTicketId,
    verificationMethod: input.verificationMethod,
    identityVerified: true,
    confirmed: true,
    actor: {
      id: actor.id,
      name: clean(actor.name) || "Authorized Insights user",
      role: clean(actor.role).toLowerCase(),
    },
  });
  const signature = signIdentityRecoveryRequest(key, timestamp, nonce, body);
  const brokerUrl =
    process.env.IDENTITY_RECOVERY_BROKER_URL?.trim() || DEFAULT_BROKER_URL;

  const response = await fetch(brokerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SCCC-Timestamp": timestamp,
      "X-SCCC-Nonce": nonce,
      "X-SCCC-Signature": signature,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json().catch(() => ({}))) as BrokerResponse;
  if (!response.ok) {
    return `Error: ${clean(result.message || result.error) || `the identity broker returned HTTP ${response.status}`}`;
  }

  const recoveryUrl = safeRecoveryUrl(result.recoveryUrl);
  if (!recoveryUrl)
    return "Error: the identity broker returned an invalid recovery link.";

  let draftMessage: string;
  try {
    const draftResult = await saveIdentityRecoveryTicketDraft({
      ticket,
      recoveryUrl,
      expiresUtc: result.expiresUtc,
      actor,
    });
    draftMessage =
      draftResult.status === "saved"
        ? isZendeskMessagingChannel(ticket.channel)
          ? `Fred saved the exact recovery response as a supervised draft for Zendesk ticket #${input.zendeskTicketId}. Review it in Troubleshooting → Zendesk Monitor, then use Copy & open Zendesk for the final Agent Workspace send.`
          : `Fred saved the exact recovery response as a supervised draft for Zendesk ticket #${input.zendeskTicketId}. Review it in Troubleshooting → Zendesk Monitor before explicitly approving the send.`
        : draftResult.status === "existing_draft"
          ? `Zendesk ticket #${input.zendeskTicketId} already has a pending draft, so Fred did not overwrite it. Review the existing draft and add this link manually if appropriate.`
          : "Fred drafting is turned off by a supervisor, so no Zendesk response draft was saved.";
  } catch {
    draftMessage = `The recovery link is ready, but Fred could not save the Zendesk draft. Copy the link into a supervised response for ticket #${input.zendeskTicketId}; no reply was sent automatically.`;
  }
  return [
    `✓ Identity matched for ${clean(result.displayName) || "the student"} (${clean(result.upn) || username}).`,
    `A single-use assisted Entra password-reset link is ready until ${clean(result.expiresUtc) || "ten minutes from now"}: ${recoveryUrl}`,
    draftMessage,
    "The student must open the link and choose the password privately. Fred cannot see, set, repeat, or place the password in Zendesk. Completing the reset clears Entra Smart Lockout; it does not re-enable an administratively disabled account.",
    `Audit reference: Zendesk ticket #${input.zendeskTicketId}.`,
  ].join("\n");
}
