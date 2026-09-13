import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveZendeskReplyDraft } from "./zendesk_reply_drafts";
import {
  buildIdentityRecoveryTicketReply,
  getZendeskRecoveryTicket,
  saveIdentityRecoveryTicketDraft,
  type ZendeskRecoveryTicket,
} from "./zendesk_recovery_draft";

const originalEnvironment = {
  drafts: process.env.ZENDESK_REPLY_DRAFTS_PATH,
  supervision: process.env.ZENDESK_SUPERVISION_CONFIG_PATH,
  subdomain: process.env.ZENDESK_SUBDOMAIN,
  email: process.env.ZENDESK_EMAIL,
  token: process.env.ZENDESK_API_TOKEN,
};

let testDirectory = "";
const ticket: ZendeskRecoveryTicket = {
  id: 7559,
  status: "open",
  subject: "Locked account",
  channel: "web",
  url: "https://example.zendesk.com/agent/tickets/7559",
};

beforeEach(async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), "zendesk-recovery-"));
  process.env.ZENDESK_REPLY_DRAFTS_PATH = path.join(
    testDirectory,
    "drafts.json",
  );
  process.env.ZENDESK_SUPERVISION_CONFIG_PATH = path.join(
    testDirectory,
    "supervision.json",
  );
  process.env.ZENDESK_SUBDOMAIN = "example";
  process.env.ZENDESK_EMAIL = "agent@example.edu";
  process.env.ZENDESK_API_TOKEN = "test-token";
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const [name, value] of Object.entries(originalEnvironment)) {
    const key =
      name === "drafts"
        ? "ZENDESK_REPLY_DRAFTS_PATH"
        : name === "supervision"
          ? "ZENDESK_SUPERVISION_CONFIG_PATH"
          : name === "subdomain"
            ? "ZENDESK_SUBDOMAIN"
            : name === "email"
              ? "ZENDESK_EMAIL"
              : "ZENDESK_API_TOKEN";
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(testDirectory, { recursive: true, force: true });
});

describe("Zendesk assisted-recovery drafts", () => {
  it("builds a private-password response without inventing a default password", () => {
    const body = buildIdentityRecoveryTicketReply(
      "https://app-server2.centralus.cloudapp.azure.com/online-kiosk/assisted/example",
      "2026-09-13T18:10:00Z",
    );
    expect(body).toContain("single-use");
    expect(body).toContain("choose your new password privately");
    expect(body).toContain(
      "clears the current Microsoft Entra account lockout",
    );
    expect(body).not.toMatch(/SCCC@800/i);
    expect(body).not.toMatch(/your password is/i);
  });

  it("requires an active exact Zendesk ticket before recovery", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ticket: {
          id: 7559,
          subject: "Locked account",
          status: "open",
          via: { channel: "native_messaging" },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getZendeskRecoveryTicket(7559)).resolves.toEqual({
      ...ticket,
      channel: "native_messaging",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.zendesk.com/api/v2/tickets/7559.json",
      expect.objectContaining({ headers: expect.any(Object) }),
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ticket: { id: 7559, subject: "Done", status: "solved" },
      }),
    });
    await expect(getZendeskRecoveryTicket(7559)).rejects.toThrow(
      "use an active ticket",
    );
  });

  it("saves a Fred response for human review and does not send it", async () => {
    const result = await saveIdentityRecoveryTicketDraft({
      ticket,
      recoveryUrl:
        "https://app-server2.centralus.cloudapp.azure.com/online-kiosk/assisted/example",
      expiresUtc: "2026-09-13T18:10:00Z",
      actor: { id: 1, name: "Mark" },
    });
    expect(result.status).toBe("saved");

    const stored = JSON.parse(
      await readFile(process.env.ZENDESK_REPLY_DRAFTS_PATH!, "utf8"),
    );
    expect(stored.drafts).toHaveLength(1);
    expect(stored.drafts[0]).toMatchObject({
      ticketId: 7559,
      source: "fred",
      status: "pending",
      createdBy: "Fred",
      requestedBy: "Mark",
    });
  });

  it("does not overwrite a pending operator draft", async () => {
    await saveZendeskReplyDraft({
      ticketId: ticket.id,
      ticketSubject: ticket.subject,
      ticketUrl: ticket.url,
      channel: ticket.channel,
      body: "Operator wording that must be preserved.",
      source: "operator",
      actor: { id: 1, name: "Mark" },
    });

    const result = await saveIdentityRecoveryTicketDraft({
      ticket,
      recoveryUrl:
        "https://app-server2.centralus.cloudapp.azure.com/online-kiosk/assisted/example",
      actor: { id: 1, name: "Mark" },
    });
    expect(result.status).toBe("existing_draft");
    if (result.status === "existing_draft") {
      expect(result.draft.body).toBe(
        "Operator wording that must be preserved.",
      );
    }
  });

  it("honors the supervisor Fred-off control", async () => {
    await writeFile(
      process.env.ZENDESK_SUPERVISION_CONFIG_PATH!,
      JSON.stringify({ fredEnabled: false, repliesEnabled: true }),
      "utf8",
    );
    const result = await saveIdentityRecoveryTicketDraft({
      ticket,
      recoveryUrl:
        "https://app-server2.centralus.cloudapp.azure.com/online-kiosk/assisted/example",
      actor: { id: 1, name: "Mark" },
    });
    expect(result).toEqual({ status: "fred_disabled" });
  });
});
