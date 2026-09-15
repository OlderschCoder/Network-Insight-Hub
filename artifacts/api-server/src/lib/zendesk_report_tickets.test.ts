import { describe, expect, it, vi } from "vitest";
import {
  fetchCompleteZendeskSearch,
  trustedZendeskApiUrl,
} from "./zendesk_report_tickets";

const base = "https://sccc.zendesk.com/api/v2/";

describe("Zendesk report ticket pagination", () => {
  it("follows only trusted pages and returns a complete result", async () => {
    const fetchPage = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ id: 1 }],
            next_page: `${base}search.json?page=2`,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ id: 2 }], next_page: null })),
      );

    await expect(
      fetchCompleteZendeskSearch(
        base,
        `${base}search.json?page=1`,
        { Authorization: "test" },
        fetchPage,
      ),
    ).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("rejects an off-domain next page before forwarding credentials", async () => {
    const fetchPage = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [{ id: 1 }],
          next_page: "https://example.com/steal",
        }),
      ),
    );

    await expect(
      fetchCompleteZendeskSearch(
        base,
        `${base}search.json?page=1`,
        { Authorization: "test" },
        fetchPage,
      ),
    ).rejects.toThrow("untrusted URL");
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a repeated or truncated pagination chain", async () => {
    const repeated = `${base}search.json?page=1`;
    const fetchPage = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ results: [], next_page: repeated })),
      );

    await expect(
      fetchCompleteZendeskSearch(base, repeated, {}, fetchPage),
    ).rejects.toThrow("repeated a page");
    await expect(
      fetchCompleteZendeskSearch(base, repeated, {}, fetchPage, 1),
    ).rejects.toThrow(/repeated a page|safe page limit/);
  });

  it("rejects API paths outside the configured v2 root", () => {
    expect(() =>
      trustedZendeskApiUrl(base, "https://sccc.zendesk.com/agent/tickets/1"),
    ).toThrow("untrusted URL");
  });
});
