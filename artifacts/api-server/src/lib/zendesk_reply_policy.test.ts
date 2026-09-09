import { describe, expect, it } from "vitest";
import {
  validateZendeskControlRequest,
  validateZendeskEscalationRequest,
  validateZendeskReplyRequest,
} from "./zendesk_reply_policy";

describe("Zendesk supervised reply policy", () => {
  it("rejects a reply that was not explicitly confirmed", () => {
    expect(
      validateZendeskReplyRequest({ body: "Hello", public: true }),
    ).toEqual({
      ok: false,
      status: 409,
      error: "Explicit confirmation is required before posting to Zendesk.",
    });
  });

  it("rejects an empty reply", () => {
    expect(
      validateZendeskReplyRequest({ body: "   ", confirmed: true }),
    ).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("normalizes a confirmed public reply", () => {
    expect(
      validateZendeskReplyRequest({
        body: "  We can help with that.  ",
        public: true,
        confirmed: true,
      }),
    ).toEqual({
      ok: true,
      value: { body: "We can help with that.", public: true },
    });
  });

  it("retains a confirmed internal note", () => {
    expect(
      validateZendeskReplyRequest({
        body: "Escalated to networking.",
        public: false,
        confirmed: true,
      }),
    ).toEqual({
      ok: true,
      value: { body: "Escalated to networking.", public: false },
    });
  });
});

describe("Zendesk supervised escalation policy", () => {
  it("requires an exact confirmation", () => {
    expect(
      validateZendeskEscalationRequest({ assigneeEmail: "agent@sccc.edu" }),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("requires a valid assignee email", () => {
    expect(
      validateZendeskEscalationRequest({
        assigneeEmail: "agent",
        confirmed: true,
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("normalizes a confirmed escalation and optional handoff note", () => {
    expect(
      validateZendeskEscalationRequest({
        assigneeEmail: " Agent@SCCC.edu ",
        note: "  Please take the network follow-up. ",
        confirmed: true,
      }),
    ).toEqual({
      ok: true,
      value: {
        assigneeEmail: "agent@sccc.edu",
        note: "Please take the network follow-up.",
      },
    });
  });
});

describe("Zendesk supervision control policy", () => {
  it("requires at least one control", () => {
    expect(validateZendeskControlRequest({}).ok).toBe(false);
  });

  it("accepts explicit boolean switches", () => {
    expect(
      validateZendeskControlRequest({
        fredEnabled: false,
        repliesEnabled: true,
      }),
    ).toEqual({
      ok: true,
      value: { fredEnabled: false, repliesEnabled: true },
    });
  });

  it("rejects unexpected control properties", () => {
    expect(
      validateZendeskControlRequest({
        fredEnabled: false,
        force: true,
      }),
    ).toEqual({
      ok: false,
      status: 400,
      error: "Unexpected control setting: force.",
    });
  });
});
