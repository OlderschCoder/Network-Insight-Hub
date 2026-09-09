import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request, { type Test } from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const tables = {
    reports: { name: "reports" },
    entries: { name: "entries" },
    users: { name: "users" },
    risks: { name: "risks" },
    afterActions: { name: "after-actions" },
    processes: { name: "processes" },
    projects: { name: "projects" },
    projectAssignees: { name: "project-assignees" },
  };
  return {
    tables,
    rows: new Map<object, unknown[]>(),
    select: vi.fn(),
  };
});

vi.mock("@workspace/db", () => ({
  db: { select: database.select },
  reportsTable: database.tables.reports,
  entriesTable: database.tables.entries,
  usersTable: database.tables.users,
  risksTable: database.tables.risks,
  afterActionReportsTable: database.tables.afterActions,
  processesTable: database.tables.processes,
  projectsTable: database.tables.projects,
  projectAssigneesTable: database.tables.projectAssignees,
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  desc: () => ({}),
}));

vi.mock("./auth", () => ({
  requireAuth(req: any, res: any, next: any) {
    if (req.headers.authorization !== "Bearer test") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = { id: 42, name: "Test Operator", role: "cio" };
    next();
  },
  requireCIO(_req: any, _res: any, next: any) {
    next();
  },
}));

vi.mock("../lib/pdf", () => ({ streamPdf: vi.fn() }));
vi.mock("../lib/report_export", () => ({
  gatherReportExportData: vi.fn(),
  buildReportDocxBuffer: vi.fn(),
  buildReportPdfSections: vi.fn(),
}));

import { updateZendeskSupervisionConfig } from "../lib/zendesk_supervision";
import exportRouter from "./export";

let supervisionDirectory: string | null = null;

const auth = (testRequest: Test) =>
  testRequest.set("Authorization", "Bearer test");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use("/api/export", exportRouter);
  return app;
}

describe("Zendesk supervision for report exports", () => {
  beforeEach(async () => {
    supervisionDirectory = await mkdtemp(
      path.join(tmpdir(), "export-zendesk-controls-"),
    );
    process.env.ZENDESK_SUPERVISION_CONFIG_PATH = path.join(
      supervisionDirectory,
      "controls.json",
    );
    process.env.ZENDESK_SUBDOMAIN = "example";
    process.env.ZENDESK_EMAIL = "service@example.edu";
    process.env.ZENDESK_API_TOKEN = "test-token";
    database.rows.clear();
    database.rows.set(database.tables.reports, [
      { id: 7, weekOf: "2026-09-07", summary: "Weekly summary" },
    ]);
    database.rows.set(database.tables.entries, [
      {
        id: 8,
        userId: 42,
        weekOf: "2026-09-07",
        title: "Printer repair",
        category: "support",
        description: "Repaired the printer.",
      },
    ]);
    database.rows.set(database.tables.users, [
      { id: 42, name: "Test Operator" },
    ]);
    database.select.mockReset().mockImplementation(() => ({
      from: (table: object) => ({
        where: async () => database.rows.get(table) ?? [],
      }),
    }));
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.ZENDESK_SUPERVISION_CONFIG_PATH;
    delete process.env.ZENDESK_SUBDOMAIN;
    delete process.env.ZENDESK_EMAIL;
    delete process.env.ZENDESK_API_TOKEN;
    if (supervisionDirectory) {
      await rm(supervisionDirectory, { recursive: true, force: true });
      supervisionDirectory = null;
    }
  });

  it("blocks report and entry ticket creation while public replies are disabled", async () => {
    await updateZendeskSupervisionConfig(
      { repliesEnabled: false },
      { id: 1, name: "CIO", role: "cio" },
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = makeApp();

    const report = await auth(
      request(app).post("/api/export/report/7/zendesk"),
    ).send({
      subject: "Weekly report",
      priority: "normal",
      requesterEmail: "requester@example.edu",
    });
    const entry = await auth(
      request(app).post("/api/export/entry/8/zendesk"),
    ).send({ subject: "Entry", priority: "normal" });

    expect(report.status).toBe(423);
    expect(entry.status).toBe(423);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when export routes cannot read persisted controls", async () => {
    await writeFile(
      process.env.ZENDESK_SUPERVISION_CONFIG_PATH!,
      "{ corrupt",
      "utf8",
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await auth(
      request(makeApp()).post("/api/export/report/7/zendesk"),
    ).send({ subject: "Weekly report", priority: "normal" });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("ZENDESK_SUPERVISION_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
