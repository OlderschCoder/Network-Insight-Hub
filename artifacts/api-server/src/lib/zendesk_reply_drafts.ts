import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ZendeskReplyDraftStatus = "pending" | "sent";

export type ZendeskReplyDraft = {
  id: string;
  ticketId: number;
  ticketSubject: string;
  ticketUrl: string;
  channel: string;
  body: string;
  source: "fred" | "operator";
  status: ZendeskReplyDraftStatus;
  createdAt: string;
  createdBy: string;
  createdByUserId: number | null;
  requestedBy: string;
  updatedAt: string;
  sentAt: string | null;
  sentBy: string | null;
};

type DraftFile = { drafts: ZendeskReplyDraft[] };

type DraftActor = {
  id?: number | null;
  name?: string | null;
  email?: string | null;
};

type SaveDraftInput = {
  ticketId: number;
  ticketSubject: string;
  ticketUrl: string;
  channel: string;
  body: string;
  source: "fred" | "operator";
  actor: DraftActor;
};

const MAX_DRAFTS = 500;
let draftMutation = Promise.resolve();

function draftFilePath() {
  return (
    process.env.ZENDESK_REPLY_DRAFTS_PATH?.trim() ||
    path.resolve(process.cwd(), "data", "zendesk-reply-drafts.json")
  );
}

function actorName(actor: DraftActor) {
  return actor.name?.trim() || actor.email?.trim() || "Unknown operator";
}

async function readDraftFile(): Promise<DraftFile> {
  try {
    const raw = await readFile(draftFilePath(), "utf8");
    const value = JSON.parse(raw) as Partial<DraftFile>;
    return { drafts: Array.isArray(value.drafts) ? value.drafts : [] };
  } catch (error: any) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError)
      return { drafts: [] };
    throw error;
  }
}

async function writeDraftFile(value: DraftFile) {
  const target = draftFilePath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function mutateDrafts<T>(
  work: (file: DraftFile) => Promise<T> | T,
): Promise<T> {
  let resolveResult: (value: T | PromiseLike<T>) => void = () => undefined;
  let rejectResult: (reason?: unknown) => void = () => undefined;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  draftMutation = draftMutation
    .then(async () => {
      try {
        const file = await readDraftFile();
        const output = await work(file);
        await writeDraftFile({ drafts: file.drafts.slice(-MAX_DRAFTS) });
        resolveResult(output);
      } catch (error) {
        rejectResult(error);
      }
    })
    .catch(() => undefined);
  return result;
}

export async function listZendeskReplyDrafts(
  status: ZendeskReplyDraftStatus = "pending",
) {
  const file = await readDraftFile();
  return file.drafts
    .filter((draft) => draft.status === status)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getPendingZendeskReplyDraft(ticketId: number) {
  const drafts = await listZendeskReplyDrafts("pending");
  return drafts.find((draft) => draft.ticketId === ticketId) ?? null;
}

export async function saveZendeskReplyDraft(input: SaveDraftInput) {
  return mutateDrafts(async (file) => {
    const now = new Date().toISOString();
    const existing = file.drafts.find(
      (draft) =>
        draft.ticketId === input.ticketId && draft.status === "pending",
    );
    const requester = actorName(input.actor);
    if (existing) {
      existing.ticketSubject = input.ticketSubject;
      existing.ticketUrl = input.ticketUrl;
      existing.channel = input.channel;
      existing.body = input.body;
      existing.source = input.source;
      existing.createdBy = input.source === "fred" ? "Fred" : requester;
      existing.createdByUserId =
        input.source === "fred" ? null : (input.actor.id ?? null);
      existing.updatedAt = now;
      existing.requestedBy = requester;
      return existing;
    }
    const draft: ZendeskReplyDraft = {
      id: randomUUID(),
      ticketId: input.ticketId,
      ticketSubject: input.ticketSubject,
      ticketUrl: input.ticketUrl,
      channel: input.channel,
      body: input.body,
      source: input.source,
      status: "pending",
      createdAt: now,
      createdBy: input.source === "fred" ? "Fred" : requester,
      createdByUserId:
        input.source === "fred" ? null : (input.actor.id ?? null),
      requestedBy: requester,
      updatedAt: now,
      sentAt: null,
      sentBy: null,
    };
    file.drafts.push(draft);
    return draft;
  });
}

export async function markZendeskReplyDraftSent(
  ticketId: number,
  draftId: string,
  actor: DraftActor,
) {
  return mutateDrafts(async (file) => {
    const draft = file.drafts.find(
      (candidate) =>
        candidate.ticketId === ticketId &&
        candidate.id === draftId &&
        candidate.status === "pending",
    );
    if (!draft) return null;
    const now = new Date().toISOString();
    draft.status = "sent";
    draft.sentAt = now;
    draft.sentBy = actorName(actor);
    draft.updatedAt = now;
    return draft;
  });
}
