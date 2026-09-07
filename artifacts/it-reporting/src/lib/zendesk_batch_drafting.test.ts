import { describe, expect, it } from "vitest";
import {
  assessZendeskTicketForDraft,
  parseFredDraftDecision,
} from "./zendesk_batch_drafting";

describe("assessZendeskTicketForDraft", () => {
  it("prepares a draft when the latest public message is from the requester", () => {
    expect(
      assessZendeskTicketForDraft({
        status: "open",
        assigneeName: "Mark Bojeun",
        comments: [
          { author: "Mark Bojeun", authorType: "agent", public: true, body: "How can I help?" },
          { author: "Student", authorType: "user", public: true, body: "I still cannot sign in." },
        ],
      }),
    ).toEqual({ shouldDraft: true, reason: "requester_waiting" });
  });

  it("skips pending tickets and tickets already answered by staff", () => {
    expect(
      assessZendeskTicketForDraft({
        status: "pending",
        comments: [{ author: "Student", authorType: "user", public: true, body: "Hello" }],
      }).shouldDraft,
    ).toBe(false);
    expect(
      assessZendeskTicketForDraft({
        status: "open",
        comments: [{ author: "Agent", authorType: "agent", public: true, body: "Please try again." }],
      }).shouldDraft,
    ).toBe(false);
  });

  it("skips internal-only and automated-only activity", () => {
    expect(
      assessZendeskTicketForDraft({
        status: "open",
        comments: [{ author: "Agent", authorType: "agent", public: false, body: "Private note" }],
      }).shouldDraft,
    ).toBe(false);
    expect(
      assessZendeskTicketForDraft({
        status: "new",
        comments: [{ author: "Auto Reply", authorType: "bot", public: true, body: "We received it." }],
      }).shouldDraft,
    ).toBe(false);
  });
});

describe("parseFredDraftDecision", () => {
  it("returns a reviewable draft body", () => {
    expect(parseFredDraftDecision("Draft public reply:\nHello! How can we help?")).toEqual({
      body: "Hello! How can we help?",
      reason: null,
    });
  });

  it("supports Fred declining an unsafe or unnecessary draft", () => {
    expect(parseFredDraftDecision("NO_DRAFT: Needs a security escalation.")).toEqual({
      body: null,
      reason: "Needs a security escalation.",
    });
  });
});
