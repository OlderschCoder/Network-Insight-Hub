import { describe, expect, it, vi } from "vitest";
import {
  confirmZendeskControlUpdate,
  getZendeskControls,
  withFreshZendeskReplyPermission,
  ZendeskRepliesDisabledError,
  zendeskControlStatusText,
} from "./zendesk_controls";

const endpoint = "/api/zendesk/controls";
const controls = {
  fredEnabled: false,
  repliesEnabled: true,
  canManage: true,
  updatedAt: "2026-09-08T20:00:00.000Z",
  updatedBy: "Supervisor",
};

describe("Zendesk control API", () => {
  it("loads the authenticated GET contract without inventing defaults", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(controls), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    await expect(getZendeskControls(fetcher, endpoint)).resolves.toEqual(
      controls,
    );
    expect(fetcher).toHaveBeenCalledWith(endpoint, { method: "GET" });
  });

  it("rejects an incomplete GET response instead of displaying controls as on", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ canManage: true }), { status: 200 }),
    );

    await expect(getZendeskControls(fetcher, endpoint)).rejects.toThrow(
      "invalid control status",
    );
  });

  it("does not send a PUT when the supervisor cancels confirmation", async () => {
    const confirm = vi.fn(async () => false);
    const fetcher = vi.fn();

    await expect(
      confirmZendeskControlUpdate(
        confirm,
        fetcher,
        endpoint,
        "repliesEnabled",
        false,
      ),
    ).resolves.toBeNull();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Turn Zendesk replies off?",
        confirmText: "Turn off",
        destructive: true,
      }),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends only the confirmed control in the authenticated PUT contract", async () => {
    const confirm = vi.fn(async () => true);
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(controls), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    await expect(
      confirmZendeskControlUpdate(
        confirm,
        fetcher,
        endpoint,
        "fredEnabled",
        false,
      ),
    ).resolves.toEqual(controls);
    expect(fetcher).toHaveBeenCalledWith(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fredEnabled: false }),
    });
  });

  it("surfaces authorization failures from PUT", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "Only a Zendesk supervisor may change these controls.",
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
    );

    await expect(
      confirmZendeskControlUpdate(
        async () => true,
        fetcher,
        endpoint,
        "fredEnabled",
        true,
      ),
    ).rejects.toThrow("Only a Zendesk supervisor");
  });

  it("rechecks reply permission and blocks a stale Messaging handoff", async () => {
    const staleControls = { ...controls, repliesEnabled: true };
    const freshControls = { ...controls, repliesEnabled: false };
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(freshControls), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const handoff = vi.fn();

    expect(staleControls.repliesEnabled).toBe(true);
    await expect(
      withFreshZendeskReplyPermission(fetcher, endpoint, handoff),
    ).rejects.toBeInstanceOf(ZendeskRepliesDisabledError);
    expect(fetcher).toHaveBeenCalledWith(endpoint, { method: "GET" });
    expect(handoff).not.toHaveBeenCalled();
  });
});

describe("Zendesk control status copy", () => {
  const readyText = {
    on: "ON — supervised drafts allowed",
    off: "OFF — Zendesk actions blocked",
  };

  it("uses truthful loading and unavailable states before a successful GET", () => {
    expect(zendeskControlStatusText("loading", false, readyText)).toBe(
      "Loading control status…",
    );
    expect(zendeskControlStatusText("error", false, readyText)).toBe(
      "Unavailable — status unknown",
    );
  });

  it("uses ON or OFF only after controls are ready", () => {
    expect(zendeskControlStatusText("ready", true, readyText)).toBe(
      readyText.on,
    );
    expect(zendeskControlStatusText("ready", false, readyText)).toBe(
      readyText.off,
    );
  });
});
