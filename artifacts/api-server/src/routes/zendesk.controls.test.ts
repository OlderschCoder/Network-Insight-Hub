import express from "express";
import request, { type Test } from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supervision = vi.hoisted(() => ({
  current: {
    fredEnabled: true,
    repliesEnabled: true,
    updatedAt: null as string | null,
    updatedBy: null as string | null,
    updatedByUserId: null as number | null,
    updatedByEmail: null as string | null,
  },
  read: vi.fn(),
  update: vi.fn(),
}));

const drafts = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  getPending: vi.fn(),
  list: vi.fn(),
  release: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  usersTable: {},
}));

vi.mock("./auth", () => ({
  requireAuth(req: any, res: any, next: any) {
    if (req.headers.authorization !== "Bearer test") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = {
      id: 42,
      name: "Test Operator",
      email: "operator@sccc.edu",
      role: req.headers["x-test-role"] ?? "helpdesk",
      canManageTodos: req.headers["x-test-manager"] === "true",
    };
    next();
  },
}));

vi.mock("../lib/zendesk_dashboard_team", () => ({
  isZendeskDashboardTeamMember: () => true,
  zendeskDashboardTeamOrder: () => 0,
}));

vi.mock("../lib/zendesk_conversation_log", () => ({
  isZendeskMessagingChannel: (channel: unknown) =>
    String(channel ?? "").toLowerCase().includes("messaging"),
  normalizeZendeskConversationLog: () => [],
}));

vi.mock("../lib/zendesk_reply_drafts", () => ({
  claimZendeskReplyDraftForSend: drafts.claim,
  completeZendeskReplyDraftSend: drafts.complete,
  getPendingZendeskReplyDraft: drafts.getPending,
  listZendeskReplyDrafts: drafts.list,
  releaseZendeskReplyDraftSend: drafts.release,
  saveZendeskReplyDraft: drafts.save,
}));

vi.mock("../lib/zendesk_supervision", () => {
  class TestZendeskSupervisionUnavailableError extends Error {
    constructor(cause: unknown) {
      super("Zendesk supervision controls are unavailable.", { cause });
    }
  }
  return {
    canManageZendeskControls: (actor: any) =>
      actor?.role === "cio" || actor?.canManageTodos === true,
    readZendeskSupervisionConfig: supervision.read,
    updateZendeskSupervisionConfig: supervision.update,
    ZendeskSupervisionUnavailableError:
      TestZendeskSupervisionUnavailableError,
    withZendeskSupervisionConfig: async (work: (controls: any) => unknown) => {
      let controls;
      try {
        controls = await supervision.read();
      } catch (error) {
        throw new TestZendeskSupervisionUnavailableError(error);
      }
      return work(controls);
    },
  };
});

import zendeskRouter from "./zendesk";

const auth = (testRequest: Test) =>
  testRequest.set("Authorization", "Bearer test");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use("/api/zendesk", zendeskRouter);
  return app;
}

describe("Zendesk control routes and enforcement", () => {
  beforeEach(() => {
    process.env.ZENDESK_SUBDOMAIN = "example";
    process.env.ZENDESK_EMAIL = "service@example.edu";
    process.env.ZENDESK_API_TOKEN = "test-token";
    supervision.current = {
      fredEnabled: true,
      repliesEnabled: true,
      updatedAt: null,
      updatedBy: null,
      updatedByUserId: null,
      updatedByEmail: null,
    };
    supervision.read.mockReset().mockImplementation(async () => supervision.current);
    supervision.update.mockReset().mockImplementation(async (changes, actor) => {
      supervision.current = {
        ...supervision.current,
        ...changes,
        updatedAt: "2026-09-08T23:00:00.000Z",
        updatedBy: actor.name,
        updatedByUserId: actor.id,
        updatedByEmail: actor.email,
      };
      return supervision.current;
    });
    drafts.getPending.mockReset();
    drafts.list.mockReset().mockResolvedValue([]);
    drafts.claim.mockReset();
    drafts.complete.mockReset();
    drafts.release.mockReset().mockResolvedValue(null);
    drafts.save.mockReset();
    vi.unstubAllGlobals();
  });

  it("returns durable state to any authenticated user but marks managers explicitly", async () => {
    const ordinary = await auth(request(makeApp()).get("/api/zendesk/controls"));
    expect(ordinary.status).toBe(200);
    expect(ordinary.body).toMatchObject({
      fredEnabled: true,
      repliesEnabled: true,
      canManage: false,
    });

    const manager = await auth(request(makeApp()).get("/api/zendesk/controls"))
      .set("x-test-manager", "true");
    expect(manager.body.canManage).toBe(true);
  });

  it("allows only the CIO or an explicit delegated supervisor to update controls", async () => {
    const forbidden = await auth(request(makeApp()).put("/api/zendesk/controls"))
      .send({ fredEnabled: false });
    expect(forbidden.status).toBe(403);
    expect(supervision.update).not.toHaveBeenCalled();

    const delegated = await auth(request(makeApp()).put("/api/zendesk/controls"))
      .set("x-test-manager", "true")
      .send({ fredEnabled: false });
    expect(delegated.status).toBe(200);
    expect(delegated.body).toMatchObject({
      fredEnabled: false,
      updatedBy: "Test Operator",
      updatedByUserId: 42,
      updatedByEmail: "operator@sccc.edu",
      canManage: true,
    });

    const cio = await auth(request(makeApp()).put("/api/zendesk/controls"))
      .set("x-test-role", "cio")
      .send({ repliesEnabled: false });
    expect(cio.status).toBe(200);
    expect(supervision.update).toHaveBeenCalledTimes(2);
  });

  it("fails closed when persisted supervision state cannot be read", async () => {
    supervision.read.mockRejectedValueOnce(new SyntaxError("corrupt state"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await auth(
      request(makeApp()).post("/api/zendesk/ticket/12/comment"),
    ).send({ body: "Hello", public: true, confirmed: true });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("ZENDESK_SUPERVISION_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks Fred draft creation without blocking an operator-authored draft", async () => {
    supervision.current.fredEnabled = false;
    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () =>
      new Response(
        JSON.stringify({
          ticket: { id: 12, subject: "Printer", via: { channel: "email" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    drafts.save.mockResolvedValue({ id: "draft-1", ticketId: 12 });

    const blocked = await auth(
      request(makeApp()).put("/api/zendesk/ticket/12/draft"),
    ).send({ body: "Fred draft", source: "fred" });
    expect(blocked.status).toBe(423);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(drafts.save).not.toHaveBeenCalled();

    const operator = await auth(
      request(makeApp()).put("/api/zendesk/ticket/12/draft"),
    ).send({ body: "Operator draft", source: "operator" });
    expect(operator.status).toBe(200);
    expect(drafts.save).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 12, source: "operator" }),
    );
  });

  it("blocks the Fred ticket-update route while Fred actions are disabled", async () => {
    supervision.current.fredEnabled = false;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await auth(
      request(makeApp()).patch("/api/zendesk/ticket/12"),
    ).send({ status: "pending" });

    expect(response.status).toBe(423);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks both approved-draft sends and direct public replies when replies are disabled", async () => {
    supervision.current.repliesEnabled = false;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const approval = await auth(
      request(makeApp()).post("/api/zendesk/ticket/12/draft/approve-send"),
    ).send({ draftId: "draft-1", confirmed: true });
    expect(approval.status).toBe(423);

    const direct = await auth(
      request(makeApp()).post("/api/zendesk/ticket/12/comment"),
    ).send({ body: "Public response", public: true, confirmed: true });
    expect(direct.status).toBe(423);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(drafts.claim).not.toHaveBeenCalled();
    expect(drafts.complete).not.toHaveBeenCalled();
  });

  it("blocks approval of a Fred-authored draft after Fred is disabled", async () => {
    supervision.current.fredEnabled = false;
    const claimedDraft = {
      id: "draft-1",
      ticketId: 12,
      body: "Fred-authored response",
      source: "fred",
      ticketUrl: "https://example.zendesk.com/agent/tickets/12",
    };
    drafts.claim.mockResolvedValue(claimedDraft);
    drafts.release.mockResolvedValue({ ...claimedDraft, status: "pending" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await auth(
      request(makeApp()).post("/api/zendesk/ticket/12/draft/approve-send"),
    ).send({ draftId: "draft-1", confirmed: true });

    expect(response.status).toBe(423);
    expect(drafts.release).toHaveBeenCalledWith(12, "draft-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(drafts.complete).not.toHaveBeenCalled();
  });

  it("allows only one concurrent approval to post an immutable draft", async () => {
    const claimedDraft = {
      id: "draft-1",
      ticketId: 12,
      body: "Public response",
      ticketUrl: "https://example.zendesk.com/agent/tickets/12",
    };
    drafts.claim
      .mockResolvedValueOnce(claimedDraft)
      .mockResolvedValueOnce(null);
    drafts.complete.mockResolvedValue({
      ...claimedDraft,
      status: "sent",
      sentBy: "Test Operator",
    });
    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async (input, init) => {
      const url = String(input);
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ ticket: { id: 12 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("users/search.json")) {
        return new Response(
          JSON.stringify({ users: [{ id: 88, name: "Test Operator" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ ticket: { id: 12, via: { channel: "email" } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = makeApp();
    const [first, second] = await Promise.all([
      auth(request(app).post("/api/zendesk/ticket/12/draft/approve-send")).send({
        draftId: "draft-1",
        confirmed: true,
      }),
      auth(request(app).post("/api/zendesk/ticket/12/draft/approve-send")).send({
        draftId: "draft-1",
        confirmed: true,
      }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(1);
    expect(drafts.complete).toHaveBeenCalledOnce();
  });

  it("releases a claimed draft after a definite Zendesk rejection", async () => {
    const claimedDraft = {
      id: "draft-1",
      ticketId: 12,
      body: "Public response",
      ticketUrl: "https://example.zendesk.com/agent/tickets/12",
    };
    drafts.claim.mockResolvedValue(claimedDraft);
    drafts.release.mockResolvedValue(claimedDraft);
    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async (input, init) => {
      const url = String(input);
      if (init?.method === "PUT") {
        return new Response("rejected", { status: 422 });
      }
      if (url.includes("users/search.json")) {
        return new Response(JSON.stringify({ users: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ ticket: { id: 12, via: { channel: "email" } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await auth(
      request(makeApp()).post("/api/zendesk/ticket/12/draft/approve-send"),
    ).send({ draftId: "draft-1", confirmed: true });

    expect(response.status).toBe(502);
    expect(drafts.release).toHaveBeenCalledWith(12, "draft-1");
    expect(drafts.complete).not.toHaveBeenCalled();
  });

  it("allows a confirmed internal note when only public replies are disabled", async () => {
    supervision.current.repliesEnabled = false;
    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async (input, init) => {
      const url = String(input);
      if (url.includes("users/search.json")) {
        return new Response(JSON.stringify({ users: [{ id: 88, name: "Operator" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ ticket: { id: 12 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ ticket: { id: 12, via: { channel: "email" } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await auth(
      request(makeApp()).post("/api/zendesk/ticket/12/comment"),
    ).send({ body: "Private triage note", public: false, confirmed: true });

    expect(response.status).toBe(200);
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
      ticket: { comment: { body: "Private triage note", public: false } },
    });
  });
});
