export type ZendeskConversationLogEvent = {
  id: string;
  type: string;
  created_at: string;
  author?: { display_name?: string; type?: string };
  content?: {
    type?: string;
    text?: string;
    body?: string;
    actions?: Array<{ reply?: { text?: string } }>;
  };
  metadata?: { public?: boolean };
  attachments?: Array<{ file_name?: string }>;
};

export type NormalizedZendeskConversationEntry = {
  id: string;
  author: string;
  authorType: string;
  public: boolean;
  body: string;
  createdAt: string;
  eventType: string;
};

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function plainText(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function eventBody(event: ZendeskConversationLogEvent) {
  const content = event.content;
  if (typeof content?.text === "string" && content.text.trim()) {
    return content.text.trim();
  }
  if (typeof content?.body === "string" && content.body.trim()) {
    return plainText(content.body);
  }
  const quickReplies = (content?.actions ?? [])
    .map((action) => action.reply?.text?.trim())
    .filter((value): value is string => !!value);
  if (quickReplies.length > 0) return `Options: ${quickReplies.join(", ")}`;
  const attachments = (event.attachments ?? [])
    .map((attachment) => attachment.file_name?.trim())
    .filter((value): value is string => !!value);
  if (attachments.length > 0) {
    return `[Attachment${attachments.length === 1 ? "" : "s"}: ${attachments.join(", ")}]`;
  }
  return "";
}

export function normalizeZendeskConversationLog(
  events: ZendeskConversationLogEvent[],
): NormalizedZendeskConversationEntry[] {
  return events
    .map((event) => ({
      id: event.id,
      author: event.author?.display_name?.trim() || "Zendesk",
      authorType: event.author?.type?.trim() || "system",
      public:
        event.type === "Messaging::ConversationMessage" ||
        event.metadata?.public === true,
      body: eventBody(event),
      createdAt: event.created_at,
      eventType: event.type,
    }))
    .filter((event) => event.body.length > 0);
}

export function isZendeskMessagingChannel(channel: unknown) {
  const value = String(channel ?? "")
    .trim()
    .toLowerCase();
  return (
    value === "native_messaging" || value === "messaging" || value === "chat"
  );
}
