import { createHash, createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EUP_ACCEPTED_MANIFEST_AUTHORITY_CONTRACT,
  EUP_ACCEPTED_MANIFEST_RESPONSE_CONTEXT,
} from "../lib/eup_accepted_manifest";
import internalReportsRouter from "./internal_reports";

const key = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const personId = "11111111-2222-4333-8444-555555555555";
const udcIdentifier = "AAAA1111-BBBB-4CCC-8DDD-EEEEEEEEEEEE";

let workingDirectory = "";
let monitorPath = "";
let verificationPath = "";

function currentIso(): string {
  return new Date().toISOString();
}

function monitorStudent(overrides: Record<string, unknown> = {}) {
  return {
    BannerId: "800000001",
    PersonId: personId,
    UdcIdentifier: udcIdentifier,
    BannerUserName: "untrusted.fullname",
    DisplayName: "Observed Student",
    GivenName: "Observed",
    FamilyName: "Student",
    EntraUpn: "different.observation@sccc.edu",
    CollegeEmail: "different.observation@g.sccc.edu",
    Status: "accepted",
    DecidedOnUtc: "2026-09-15T19:00:00.000Z",
    ...overrides,
  };
}

function verificationAccount(overrides: Record<string, unknown> = {}) {
  const checkedUtc = currentIso();
  return {
    BannerId: "800000001",
    BannerUserName: "alexandria.longname1",
    PersonId: personId,
    ExpectedPersonId: personId,
    ExpectedUdcIdentifier: udcIdentifier,
    ProfileUdcIdentifier: udcIdentifier,
    CheckedUtc: checkedUtc,
    UserNameVerified: true,
    IdentityLinkVerified: true,
    ExpectedUserNameSource: "live_ethos_banner_username",
    ...overrides,
  };
}

async function writeSources(
  students: Record<string, unknown>[],
  accounts: Record<string, unknown>[],
  generatedUtc = currentIso(),
): Promise<void> {
  await writeFile(
    monitorPath,
    JSON.stringify({ GeneratedUtc: generatedUtc, Students: students }),
    "utf8",
  );
  await writeFile(
    verificationPath,
    JSON.stringify({ GeneratedUtc: currentIso(), Accounts: accounts }),
    "utf8",
  );
}

function makeApp(remoteAddress: string) {
  const app = express();
  app.use((req, _res, next) => {
    Object.defineProperty(req.socket, "remoteAddress", {
      configurable: true,
      value: remoteAddress,
    });
    next();
  });
  app.use("/api/internal", internalReportsRouter);
  return app;
}

function requestSignature(timestamp: string): string {
  return createHmac("sha256", key)
    .update(`${timestamp}\naccepted-manifest`, "utf8")
    .digest("hex");
}

async function getManifest(
  remoteAddress = "10.0.0.15",
  signatureOverride?: string,
) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const response = await request(makeApp(remoteAddress))
    .get("/api/internal/eup-accepted-manifest")
    .set("Host", "10.0.0.44:8080")
    .set("X-SCCC-EUP-Timestamp", timestamp)
    .set(
      "X-SCCC-EUP-Signature",
      signatureOverride ?? requestSignature(timestamp),
    );
  return { response, requestTimestamp: timestamp };
}

beforeEach(async () => {
  workingDirectory = await mkdtemp(join(tmpdir(), "sccc-eup-manifest-"));
  monitorPath = join(workingDirectory, "accepted.json");
  verificationPath = join(workingDirectory, "verification.json");
  const keyPath = join(workingDirectory, "monitor.key");
  await writeFile(keyPath, key);
  vi.stubEnv("EUP_MONITOR_KEY_PATH", keyPath);
  vi.stubEnv("EUP_ACCEPTED_MONITOR_PATH", monitorPath);
  vi.stubEnv("EUP_BANNER_VERIFICATION_PATH", verificationPath);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (workingDirectory) {
    await rm(workingDirectory, { recursive: true, force: true });
  }
});

describe("GET /api/internal/eup-accepted-manifest", () => {
  it("publishes only explicit verifier-backed Banner authority and preserves observations", async () => {
    await writeSources(
      [monitorStudent({ CanvasLogin: "observed.canvas" })],
      [verificationAccount()],
    );

    const { response, requestTimestamp } = await getManifest();

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const bodyBytes = Buffer.from(response.text, "utf8");
    const bodySha256 = createHash("sha256").update(bodyBytes).digest("hex");
    const responseTimestamp = String(
      response.headers["x-sccc-manifest-timestamp"],
    );
    expect(Number.isSafeInteger(Number(responseTimestamp))).toBe(true);
    expect(
      Math.abs(Date.now() / 1000 - Number(responseTimestamp)),
    ).toBeLessThan(5);
    expect(response.headers["x-sccc-manifest-sha256"]).toBe(bodySha256);
    const responseCanonical = [
      requestTimestamp,
      responseTimestamp,
      EUP_ACCEPTED_MANIFEST_RESPONSE_CONTEXT,
      bodySha256,
    ].join("\n");
    expect(response.headers["x-sccc-manifest-signature"]).toBe(
      createHmac("sha256", key).update(responseCanonical, "utf8").digest("hex"),
    );

    const manifest = JSON.parse(response.text);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.authorityContract).toBe(
      EUP_ACCEPTED_MANIFEST_AUTHORITY_CONTRACT,
    );
    expect(Math.floor(Date.parse(manifest.servedUtc) / 1000).toString()).toBe(
      responseTimestamp,
    );
    expect(manifest.sourceCounts).toEqual({
      acceptedMonitorRows: 1,
      bannerVerificationRows: 1,
      usableRows: 1,
      omittedAcceptedRows: 0,
    });
    expect(manifest.students).toHaveLength(1);
    expect(manifest.students[0]).toMatchObject({
      BannerId: "800000001",
      BannerUserName: "alexandria.longname1",
      UserNameVerified: true,
      IdentityLinkVerified: true,
      PersonId: personId,
      ExpectedPersonId: personId,
      UdcIdentifier: udcIdentifier,
      ExpectedUdcIdentifier: udcIdentifier,
      ProfileUdcIdentifier: udcIdentifier,
      CanvasLogin: "observed.canvas",
      EntraUpn: "different.observation@sccc.edu",
      CollegeEmail: "different.observation@g.sccc.edu",
    });
    expect(manifest.students[0].BannerUserName).toHaveLength(20);
    expect(manifest.students[0].BannerIdentityCheckedUtc).toBeTruthy();
  });

  it("uses null for an unavailable Canvas observation instead of inventing the Banner username", async () => {
    await writeSources([monitorStudent()], [verificationAccount()]);

    const { response } = await getManifest();

    expect(response.status).toBe(200);
    const row = JSON.parse(response.text).students[0];
    expect(row.CanvasLogin).toBeNull();
    expect(row.CanvasLogin).not.toBe(row.BannerUserName);
  });

  it("omits a row whose live username is invalid rather than deriving it from email or name", async () => {
    await writeSources(
      [
        monitorStudent(),
        monitorStudent({
          BannerId: "800000002",
          PersonId: "22222222-3333-4444-8555-666666666666",
          UdcIdentifier: "BBBB2222-CCCC-4DDD-8EEE-FFFFFFFFFFFF",
          BannerUserName: "email.candidate",
          EntraUpn: "email.candidate@sccc.edu",
          CollegeEmail: "email.candidate@g.sccc.edu",
        }),
      ],
      [
        verificationAccount(),
        verificationAccount({
          BannerId: "800000002",
          BannerUserName: null,
          PersonId: "22222222-3333-4444-8555-666666666666",
          ExpectedPersonId: "22222222-3333-4444-8555-666666666666",
          ExpectedUdcIdentifier: "BBBB2222-CCCC-4DDD-8EEE-FFFFFFFFFFFF",
          ProfileUdcIdentifier: "BBBB2222-CCCC-4DDD-8EEE-FFFFFFFFFFFF",
        }),
      ],
    );

    const { response } = await getManifest();

    expect(response.status).toBe(200);
    const manifest = JSON.parse(response.text);
    expect(manifest.students.map((row: any) => row.BannerId)).toEqual([
      "800000001",
    ]);
    expect(manifest.sourceCounts.omittedAcceptedRows).toBe(1);
  });

  it("fails closed when no accepted row has fresh unique Banner authority", async () => {
    await writeSources(
      [monitorStudent()],
      [verificationAccount({ BannerUserName: "entire.lastnameislong" })],
    );

    const { response } = await getManifest();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "Accepted-student manifest unavailable",
    });
  });

  it("fails closed when the claimed EID/UDC is not a GUID", async () => {
    await writeSources(
      [monitorStudent({ UdcIdentifier: "not-a-guid" })],
      [
        verificationAccount({
          ExpectedUdcIdentifier: "not-a-guid",
          ProfileUdcIdentifier: "not-a-guid",
        }),
      ],
    );

    expect((await getManifest()).response.status).toBe(503);
  });

  it("fails closed when a verified Banner username has more than one owner", async () => {
    const secondPersonId = "22222222-3333-4444-8555-666666666666";
    const secondUdcIdentifier = "BBBB2222-CCCC-4DDD-8EEE-FFFFFFFFFFFF";
    await writeSources(
      [
        monitorStudent(),
        monitorStudent({
          BannerId: "800000002",
          PersonId: secondPersonId,
          UdcIdentifier: secondUdcIdentifier,
        }),
      ],
      [
        verificationAccount(),
        verificationAccount({
          BannerId: "800000002",
          PersonId: secondPersonId,
          ExpectedPersonId: secondPersonId,
          ExpectedUdcIdentifier: secondUdcIdentifier,
          ProfileUdcIdentifier: secondUdcIdentifier,
        }),
      ],
    );

    expect((await getManifest()).response.status).toBe(503);
  });

  it("fails closed for a stale accepted monitor or stale per-row verification", async () => {
    const stale = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    await writeSources([monitorStudent()], [verificationAccount()], stale);
    expect((await getManifest()).response.status).toBe(503);

    await writeSources(
      [monitorStudent()],
      [
        verificationAccount({
          CheckedUtc: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
        }),
      ],
    );
    expect((await getManifest()).response.status).toBe(503);

    await writeSources(
      [monitorStudent()],
      [
        verificationAccount({
          CheckedUtc: new Date(Date.now() + 6 * 60 * 1000).toISOString(),
        }),
      ],
    );
    expect((await getManifest()).response.status).toBe(503);
  });

  it("keeps the source/Host disguise and rejects an invalid request MAC", async () => {
    await writeSources([monitorStudent()], [verificationAccount()]);

    expect((await getManifest("127.0.0.1")).response.status).toBe(404);
    expect(
      (await getManifest("10.0.0.15", "0".repeat(64))).response.status,
    ).toBe(401);
  });
});
