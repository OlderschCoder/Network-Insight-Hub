import { describe, expect, it } from "vitest";
import {
  isZendeskMessagingChannel,
  normalizeZendeskConversationLog,
} from "./zendesk_conversation_log";

describe("Zendesk conversation log normalization", () => {
  it("keeps live messaging text and its author", () => {
    expect(
      normalizeZendeskConversationLog([
        {
          id: "message-1",
          type: "Messaging::ConversationMessage",
          created_at: "2026-09-07T17:28:00Z",
          author: { display_name: "Jim Jones", type: "user" },
          content: { type: "text", text: "How do I connect to Wi-Fi?" },
          attachments: [],
        },
      ]),
    ).toEqual([
      {
        id: "message-1",
        author: "Jim Jones",
        authorType: "user",
        public: true,
        body: "How do I connect to Wi-Fi?",
        createdAt: "2026-09-07T17:28:00Z",
        eventType: "Messaging::ConversationMessage",
      },
    ]);
  });

  it("converts ticket-event HTML to readable text", () => {
    const [entry] = normalizeZendeskConversationLog([
      {
        id: "comment-1",
        type: "Comment",
        created_at: "2026-09-07T17:29:00Z",
        author: { display_name: "Agent", type: "agent" },
        content: {
          type: "html",
          body: "<p>Hello &amp; welcome</p><p>Next line</p>",
        },
        metadata: { public: false },
      },
    ]);
    expect(entry.body).toBe("Hello & welcome\nNext line");
    expect(entry.public).toBe(false);
  });

  it("recognizes Zendesk live channels", () => {
    expect(isZendeskMessagingChannel("native_messaging")).toBe(true);
    expect(isZendeskMessagingChannel("email")).toBe(false);
  });
});
