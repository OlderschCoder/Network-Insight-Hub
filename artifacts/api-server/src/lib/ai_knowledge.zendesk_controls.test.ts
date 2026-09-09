import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { updateZendeskSupervisionConfig } from "./zendesk_supervision";

let supervisionDirectory: string | null = null;
let executeZendeskAddComment: (args: string) => Promise<string>;
let executeZendeskUpdateTicket: (args: string) => Promise<string>;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeAll(async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";
  ({ executeZendeskAddComment, executeZendeskUpdateTicket } = await import(
    "./ai_knowledge"
  ));
});

afterAll(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("Fred Zendesk tool controls", () => {
  beforeEach(async () => {
    process.env.ZENDESK_SUBDOMAIN = "example";
    process.env.ZENDESK_EMAIL = "fred@example.edu";
    process.env.ZENDESK_API_TOKEN = "test-token";
    supervisionDirectory = await mkdtemp(
      path.join(tmpdir(), "fred-zendesk-tool-controls-"),
    );
    process.env.ZENDESK_SUPERVISION_CONFIG_PATH = path.join(
      supervisionDirectory,
      "controls.json",
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.ZENDESK_SUBDOMAIN;
    delete process.env.ZENDESK_EMAIL;
    delete process.env.ZENDESK_API_TOKEN;
    delete process.env.ZENDESK_SUPERVISION_CONFIG_PATH;
    if (supervisionDirectory) {
      await rm(supervisionDirectory, { recursive: true, force: true });
      supervisionDirectory = null;
    }
  });

  it("blocks Fred internal notes and ticket updates when Fred is disabled", async () => {
    await updateZendeskSupervisionConfig(
      { fredEnabled: false },
      { id: 1, name: "CIO", role: "cio" },
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeZendeskAddComment(
        JSON.stringify({
          ticket_id: 12,
          body: "Private triage note",
          public: false,
          confirmed: true,
        }),
      ),
    ).resolves.toContain("turned off by a supervisor");
    await expect(
      executeZendeskUpdateTicket(
        JSON.stringify({
          ticket_id: 12,
          status: "pending",
          confirmed: true,
        }),
      ),
    ).resolves.toContain("turned off by a supervisor");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks Fred public replies while allowing a confirmed internal note", async () => {
    await updateZendeskSupervisionConfig(
      { fredEnabled: true, repliesEnabled: false },
      { id: 1, name: "CIO", role: "cio" },
    );
    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () =>
      new Response(JSON.stringify({ ticket: { id: 12 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeZendeskAddComment(
        JSON.stringify({
          ticket_id: 12,
          body: "Public response",
          public: true,
          confirmed: true,
        }),
      ),
    ).resolves.toContain("public replies are turned off");
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      executeZendeskAddComment(
        JSON.stringify({
          ticket_id: 12,
          body: "Private triage note",
          public: false,
          confirmed: true,
        }),
      ),
    ).resolves.toContain("Internal note");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      ticket: {
        comment: { body: "Private triage note", public: false },
      },
    });
  });
});
