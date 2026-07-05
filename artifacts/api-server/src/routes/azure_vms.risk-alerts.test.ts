import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";

// Mock the Azure client so the sync route never touches the network. We control
// exactly which VMs "come back from Azure" per test and keep AZURE_* unset.
vi.mock("../lib/azure", () => ({
  getAzureConfig: () => ({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    subscriptionId: "sub",
  }),
  fetchAzureVms: vi.fn(),
}));

import {
  db,
  azureVmsTable,
  azureSyncRunsTable,
  cioShadowNotesTable,
  usersTable,
  sessionsTable,
} from "@workspace/db";
import { fetchAzureVms } from "../lib/azure";
import azureVmsRouter from "./azure_vms";
import cioShadowNotesRouter from "./cio_shadow_notes";

const mockFetchAzureVms = vi.mocked(fetchAzureVms);

// Same ISO-week-start (Monday) computation the sync route uses to scope the note.
function isoWeekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7;
  const monday = new Date(dt.getTime() - (dow - 1) * 86400000);
  return monday.toISOString().slice(0, 10);
}

function baseVm(overrides: Record<string, unknown>) {
  return {
    azureResourceId: "res-default",
    name: "vm-default",
    resourceGroup: "rg-test",
    subscription: "sub",
    location: "eastus",
    size: "Standard_D2s_v3",
    os: "Linux",
    status: "running",
    privateIp: "10.0.0.4",
    publicIp: null,
    vnet: "vnet-test",
    subnet: "subnet-test",
    ...overrides,
  };
}

// Minimal app mounting just the two routers under test. A no-op req.log avoids
// spinning up pino worker threads in the test process.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { info() {}, error() {}, warn() {}, debug() {} };
    next();
  });
  app.use("/api/azure-vms", azureVmsRouter);
  app.use("/api/cio-shadow-notes", cioShadowNotesRouter);
  return app;
}

const app = makeApp();

// Snapshots of the shared tables so this suite fully restores them afterwards —
// the sync route mutates azure_vms in place (marking unseen rows "deleted").
let vmSnapshot: any[] = [];
let noteSnapshot: any[] = [];
const testUserIds: number[] = [];

let cio: { id: number; token: string };
let staff: { id: number; token: string };

async function makeUser(role: string): Promise<{ id: number; token: string }> {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `risk-alert-test-${crypto.randomUUID()}@example.com`,
      name: `Test ${role}`,
      role,
      isActive: true,
    })
    .returning();
  testUserIds.push(user.id);
  const token = crypto.randomBytes(24).toString("hex");
  await db.insert(sessionsTable).values({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { id: user.id, token };
}

async function countAzureRiskNotes(): Promise<any[]> {
  return db
    .select()
    .from(cioShadowNotesTable)
    .where(sql`${cioShadowNotesTable.category} = 'azure_risk'`);
}

beforeAll(async () => {
  vmSnapshot = await db.select().from(azureVmsTable);
  noteSnapshot = await db.select().from(cioShadowNotesTable);
  cio = await makeUser("cio");
  staff = await makeUser("helpdesk");
});

beforeEach(async () => {
  mockFetchAzureVms.mockReset();
  // Deterministic slate: no VMs, no shadow notes (restored in afterAll).
  await db.delete(cioShadowNotesTable);
  await db.delete(azureVmsTable);
});

afterAll(async () => {
  // Restore the shared tables to their pre-test contents.
  await db.delete(cioShadowNotesTable);
  await db.delete(azureVmsTable);
  if (vmSnapshot.length > 0) await db.insert(azureVmsTable).values(vmSnapshot as any);
  if (noteSnapshot.length > 0) await db.insert(cioShadowNotesTable).values(noteSnapshot as any);
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('azure_vms', 'id'), (SELECT COALESCE(MAX(id), 1) FROM azure_vms))`,
  );
  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('cio_shadow_notes', 'id'), (SELECT COALESCE(MAX(id), 1) FROM cio_shadow_notes))`,
  );
  // Remove sync-run rows the sync route created (they FK to the test user),
  // then delete the test users (their sessions cascade).
  for (const id of testUserIds) {
    await db.delete(azureSyncRunsTable).where(sql`${azureSyncRunsTable.actorId} = ${id}`);
    await db.delete(usersTable).where(sql`${usersTable.id} = ${id}`);
  }
});

describe("Azure VM sync → CIO risky-VM shadow-note alerts", () => {
  it("creates exactly one azure_risk shadow note (source ai, current week) when a synced VM becomes high-severity", async () => {
    mockFetchAzureVms.mockResolvedValue([
      baseVm({
        azureResourceId: "res-newly-exposed",
        name: "vm-newly-exposed",
        publicIp: "20.1.2.3",
      }),
    ] as any);

    const res = await request(app)
      .post("/api/azure-vms/sync")
      .set("Authorization", `Bearer ${cio.token}`);

    expect(res.status).toBe(200);
    expect(res.body.newlyFlagged).toBe(1);

    const notes = await countAzureRiskNotes();
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.source).toBe("ai");
    expect(note.status).toBe("open");
    expect(note.createdBy).toBe(cio.id);
    expect(note.weekOf).toBe(isoWeekStart(new Date().toISOString().slice(0, 10)));
    expect(note.content).toContain("vm-newly-exposed");
  });

  it("does NOT create a duplicate note when a VM was already high-severity before the sync", async () => {
    // Pre-seed a VM that is already high-severity (public IP) with a matching
    // azureResourceId, so the sync sees priorHadHigh === true.
    await db.insert(azureVmsTable).values({
      azureResourceId: "res-already-exposed",
      name: "vm-already-exposed",
      resourceGroup: "rg-test",
      status: "running",
      publicIp: "20.9.9.9",
      source: "azure",
      createdBy: cio.id,
    });

    mockFetchAzureVms.mockResolvedValue([
      baseVm({
        azureResourceId: "res-already-exposed",
        name: "vm-already-exposed",
        publicIp: "20.9.9.9",
      }),
    ] as any);

    const res = await request(app)
      .post("/api/azure-vms/sync")
      .set("Authorization", `Bearer ${cio.token}`);

    expect(res.status).toBe(200);
    expect(res.body.newlyFlagged).toBe(0);

    const notes = await countAzureRiskNotes();
    expect(notes).toHaveLength(0);
  });

  it("keeps the created note visible to CIO sessions only (non-CIO GET stays forbidden)", async () => {
    mockFetchAzureVms.mockResolvedValue([
      baseVm({
        azureResourceId: "res-cio-only",
        name: "vm-cio-only",
        publicIp: "20.4.5.6",
      }),
    ] as any);

    const syncRes = await request(app)
      .post("/api/azure-vms/sync")
      .set("Authorization", `Bearer ${cio.token}`);
    expect(syncRes.status).toBe(200);
    expect(syncRes.body.newlyFlagged).toBe(1);

    // Non-CIO is forbidden from reading shadow notes at all.
    const staffRes = await request(app)
      .get("/api/cio-shadow-notes")
      .set("Authorization", `Bearer ${staff.token}`);
    expect(staffRes.status).toBe(403);

    // Unauthenticated is rejected too.
    const anonRes = await request(app).get("/api/cio-shadow-notes");
    expect(anonRes.status).toBe(401);

    // CIO can see the alert note.
    const cioRes = await request(app)
      .get("/api/cio-shadow-notes")
      .set("Authorization", `Bearer ${cio.token}`);
    expect(cioRes.status).toBe(200);
    const azureNotes = (cioRes.body as any[]).filter((n) => n.category === "azure_risk");
    expect(azureNotes).toHaveLength(1);
    expect(azureNotes[0].source).toBe("ai");
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
