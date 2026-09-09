import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  aiKnowledgeTable: {},
  afterActionReportsTable: {},
  entriesTable: {},
  reportsTable: {},
  teamTodosTable: {},
  usersTable: {},
  db: {},
}));

import {
  canManageOwnedRecord,
  canManageWeeklyReports,
  executeManageTeamTodo,
  executeZendeskCreateTicket,
  executeZendeskSolveTickets,
  fredApplicationToolsForRole,
} from "./fred_application_actions";
import { updateZendeskSupervisionConfig } from "./zendesk_supervision";

let supervisionDirectory: string | null = null;

describe("Fred application actions", () => {
  beforeEach(async () => {
    process.env.ZENDESK_SUBDOMAIN = "example";
    process.env.ZENDESK_EMAIL = "fred@example.edu";
    process.env.ZENDESK_API_TOKEN = "test-token";
    supervisionDirectory = await mkdtemp(
      path.join(tmpdir(), "fred-zendesk-controls-"),
    );
    process.env.ZENDESK_SUPERVISION_CONFIG_PATH = path.join(
      supervisionDirectory,
      "controls.json",
    );
    await updateZendeskSupervisionConfig(
      { fredEnabled: true, repliesEnabled: true },
      { id: 1, name: "Test setup", role: "cio" },
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

  it("exposes CIO report management and staff-safe application tools", () => {
    const cioNames = fredApplicationToolsForRole("cio").map(
      (tool) => tool.type === "function" && tool.function.name,
    );
    const staffNames = fredApplicationToolsForRole("staff").map(
      (tool) => tool.type === "function" && tool.function.name,
    );

    expect(cioNames).toContain("manage_weekly_status_report");
    expect(staffNames).not.toContain("manage_weekly_status_report");
    expect(staffNames).toEqual(
      expect.arrayContaining([
        "zendesk_create_ticket",
        "zendesk_solve_tickets",
        "manage_post_incident_review",
        "manage_weekly_log",
        "query_team_todos",
        "manage_team_todo",
        "get_application_guidance",
      ]),
    );
  });

  it("requires exact confirmation before Fred changes a to-do", async () => {
    const result = await executeManageTeamTodo(
      JSON.stringify({ action: "complete", id: 42, confirmed: false }),
      { id: 7, role: "staff" },
    );

    expect(result).toContain("Confirmation required");
  });

  it("enforces owner and CIO boundaries", () => {
    expect(canManageOwnedRecord({ id: 7, role: "staff" }, 7)).toBe(true);
    expect(canManageOwnedRecord({ id: 7, role: "staff" }, 8)).toBe(false);
    expect(canManageOwnedRecord({ id: 7, role: "cio" }, 8)).toBe(true);
    expect(canManageWeeklyReports({ id: 7, role: "cio" })).toBe(true);
    expect(canManageWeeklyReports({ id: 7, role: "staff" })).toBe(false);
  });

  it("refuses ticket creation without exact confirmation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeZendeskCreateTicket(
      JSON.stringify({ subject: "Printer", body: "Offline", confirmed: false }),
    );

    expect(result).toContain("Confirmation required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks create and solve at the executor boundary when Fred is disabled", async () => {
    await updateZendeskSupervisionConfig(
      { fredEnabled: false },
      { id: 1, name: "CIO", role: "cio" },
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeZendeskCreateTicket(
        JSON.stringify({ subject: "Printer", body: "Offline", confirmed: true }),
      ),
    ).resolves.toContain("turned off by a supervisor");
    await expect(
      executeZendeskSolveTickets(
        JSON.stringify({ ticket_ids: [101], confirmed: true }),
      ),
    ).resolves.toContain("turned off by a supervisor");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks ticket creation when public Zendesk replies are disabled", async () => {
    await updateZendeskSupervisionConfig(
      { repliesEnabled: false },
      { id: 1, name: "CIO", role: "cio" },
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeZendeskCreateTicket(
        JSON.stringify({ subject: "Printer", body: "Offline", confirmed: true }),
      ),
    ).resolves.toContain("public replies are turned off by a supervisor");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a confirmed Zendesk ticket with the requested fields", async () => {
    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(JSON.stringify({ ticket: { id: 4312, status: "new" } }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeZendeskCreateTicket(
      JSON.stringify({
        subject: "Printer unavailable",
        body: "Hobble queue is offline.",
        priority: "high",
        ticket_type: "incident",
        confirmed: true,
      }),
    );

    expect(result).toContain("#4312 created");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      ticket: {
        subject: "Printer unavailable",
        priority: "high",
        type: "incident",
        comment: { body: "Hobble queue is offline.", public: true },
      },
    });
  });

  it("solves only the explicit confirmed ticket ids", async () => {
    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(JSON.stringify({ ticket: { status: "solved" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeZendeskSolveTickets(
      JSON.stringify({ ticket_ids: [101, 102, 102], confirmed: true }),
    );

    expect(result).toContain("Solved 2 tickets: #101, #102");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toMatch(/tickets\/(101|102)\.json$/);
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({
        ticket: { status: "solved" },
      });
    }
  });
});
