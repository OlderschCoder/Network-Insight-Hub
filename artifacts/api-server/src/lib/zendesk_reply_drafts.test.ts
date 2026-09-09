import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimZendeskReplyDraftForSend,
  completeZendeskReplyDraftSend,
  getPendingZendeskReplyDraft,
  listZendeskReplyDrafts,
  releaseZendeskReplyDraftSend,
  saveZendeskReplyDraft,
} from "./zendesk_reply_drafts";

describe("Zendesk reply drafts", () => {
  beforeEach(async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zendesk-drafts-"));
    process.env.ZENDESK_REPLY_DRAFTS_PATH = path.join(directory, "drafts.json");
  });

  afterEach(() => {
    delete process.env.ZENDESK_REPLY_DRAFTS_PATH;
  });

  it("persists a Fred draft for another operator", async () => {
    const saved = await saveZendeskReplyDraft({
      ticketId: 7549,
      ticketSubject: "Conversation with Jim Jones",
      ticketUrl: "https://sccc.zendesk.com/agent/tickets/7549",
      channel: "native_messaging",
      body: "I can help you connect to the SCCC wireless network.",
      source: "fred",
      actor: { id: 1, name: "Mark" },
    });
    expect(saved.createdBy).toBe("Fred");
    expect(saved.requestedBy).toBe("Mark");
    expect((await getPendingZendeskReplyDraft(7549))?.body).toContain(
      "wireless",
    );
    expect(
      JSON.parse(
        await readFile(process.env.ZENDESK_REPLY_DRAFTS_PATH!, "utf8"),
      ),
    ).toBeTruthy();
  });

  it("rotates the approval token when a pending draft body changes", async () => {
    const base = {
      ticketId: 12,
      ticketSubject: "Printer",
      ticketUrl: "https://sccc.zendesk.com/agent/tickets/12",
      channel: "email",
      source: "operator" as const,
      actor: { id: 2, name: "Tracy" },
    };
    const original = await saveZendeskReplyDraft({ ...base, body: "First" });
    const revised = await saveZendeskReplyDraft({ ...base, body: "Revised" });
    expect(await listZendeskReplyDrafts()).toHaveLength(1);
    expect(revised.id).not.toBe(original.id);
    await expect(
      claimZendeskReplyDraftForSend(12, original.id, { name: "Mark" }),
    ).resolves.toBeNull();
    const claimed = await claimZendeskReplyDraftForSend(12, revised.id, {
      name: "Mark",
    });
    expect(claimed?.body).toBe("Revised");
    await releaseZendeskReplyDraftSend(12, revised.id);
  });

  it("allows only one concurrent claim for an immutable draft revision", async () => {
    const draft = await saveZendeskReplyDraft({
      ticketId: 32,
      ticketSubject: "Login",
      ticketUrl: "https://sccc.zendesk.com/agent/tickets/32",
      channel: "email",
      body: "Please try again.",
      source: "fred",
      actor: { name: "Mark" },
    });

    const claims = await Promise.all([
      claimZendeskReplyDraftForSend(32, draft.id, { name: "Tracy" }),
      claimZendeskReplyDraftForSend(32, draft.id, { name: "Craig" }),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await listZendeskReplyDrafts("sending")).toHaveLength(1);
  });

  it("rejects edits during a send and records the claimed body and approver", async () => {
    const draft = await saveZendeskReplyDraft({
      ticketId: 33,
      ticketSubject: "Login",
      ticketUrl: "https://sccc.zendesk.com/agent/tickets/33",
      channel: "email",
      body: "Please try again.",
      source: "fred",
      actor: { name: "Mark" },
    });
    const claimed = await claimZendeskReplyDraftForSend(33, draft.id, {
      name: "Tracy",
    });

    await expect(
      saveZendeskReplyDraft({
        ticketId: 33,
        ticketSubject: "Login",
        ticketUrl: "https://sccc.zendesk.com/agent/tickets/33",
        channel: "email",
        body: "A different, unreviewed reply.",
        source: "operator",
        actor: { name: "Craig" },
      }),
    ).rejects.toMatchObject({ code: "ZENDESK_REPLY_DRAFT_IN_FLIGHT" });

    expect(claimed?.body).toBe("Please try again.");
    await completeZendeskReplyDraftSend(33, draft.id, { name: "Tracy" });
    expect(await listZendeskReplyDrafts("pending")).toHaveLength(0);
    expect((await listZendeskReplyDrafts("sent"))[0]).toMatchObject({
      body: "Please try again.",
      sendStartedBy: "Tracy",
      sentBy: "Tracy",
    });
  });
});
