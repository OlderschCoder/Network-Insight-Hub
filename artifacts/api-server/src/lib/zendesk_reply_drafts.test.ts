import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPendingZendeskReplyDraft,
  listZendeskReplyDrafts,
  markZendeskReplyDraftSent,
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

  it("updates one pending draft instead of duplicating it", async () => {
    const base = {
      ticketId: 12,
      ticketSubject: "Printer",
      ticketUrl: "https://sccc.zendesk.com/agent/tickets/12",
      channel: "email",
      source: "operator" as const,
      actor: { id: 2, name: "Tracy" },
    };
    await saveZendeskReplyDraft({ ...base, body: "First" });
    await saveZendeskReplyDraft({ ...base, body: "Revised" });
    expect(await listZendeskReplyDrafts()).toHaveLength(1);
    expect((await getPendingZendeskReplyDraft(12))?.body).toBe("Revised");
  });

  it("records the approving sender", async () => {
    const draft = await saveZendeskReplyDraft({
      ticketId: 33,
      ticketSubject: "Login",
      ticketUrl: "https://sccc.zendesk.com/agent/tickets/33",
      channel: "email",
      body: "Please try again.",
      source: "fred",
      actor: { name: "Mark" },
    });
    await markZendeskReplyDraftSent(33, draft.id, { name: "Tracy" });
    expect(await listZendeskReplyDrafts("pending")).toHaveLength(0);
    expect((await listZendeskReplyDrafts("sent"))[0].sentBy).toBe("Tracy");
  });
});
