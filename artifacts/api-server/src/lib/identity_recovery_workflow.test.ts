import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareIdentityRecovery,
  type IdentityRecoveryInput,
} from "./identity_recovery";

const managedEnvironment = [
  "IDENTITY_RECOVERY_HMAC_KEY_PATH",
  "IDENTITY_RECOVERY_BROKER_URL",
  "IDENTITY_RECOVERY_PUBLIC_HOST",
  "ZENDESK_REPLY_DRAFTS_PATH",
  "ZENDESK_SUPERVISION_CONFIG_PATH",
  "ZENDESK_SUBDOMAIN",
  "ZENDESK_EMAIL",
  "ZENDESK_API_TOKEN",
] as const;
const originalEnvironment = Object.fromEntries(
  managedEnvironment.map((key) => [key, process.env[key]]),
);

const input: IdentityRecoveryInput = {
  legalFirstName: "Ada",
  legalLastName: "Lovelace",
  studentId: "800123456",
  username: "ada.lovelace",
  zendeskTicketId: 7559,
  verificationMethod: "callback_to_number_on_file",
  identityVerified: true,
  confirmed: true,
};

let testDirectory = "";

beforeEach(async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), "identity-recovery-flow-"));
  const keyPath = path.join(testDirectory, "recovery.key");
  await writeFile(keyPath, "0123456789abcdef0123456789abcdef", "utf8");
  process.env.IDENTITY_RECOVERY_HMAC_KEY_PATH = keyPath;
  process.env.IDENTITY_RECOVERY_BROKER_URL =
    "http://online-kiosk.test/internal/admin-recovery-link";
  process.env.IDENTITY_RECOVERY_PUBLIC_HOST =
    "app-server2.centralus.cloudapp.azure.com";
  process.env.ZENDESK_REPLY_DRAFTS_PATH = path.join(
    testDirectory,
    "drafts.json",
  );
  process.env.ZENDESK_SUPERVISION_CONFIG_PATH = path.join(
    testDirectory,
    "supervision.json",
  );
  process.env.ZENDESK_SUBDOMAIN = "example";
  process.env.ZENDESK_EMAIL = "agent@example.edu";
  process.env.ZENDESK_API_TOKEN = "test-token";
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const key of managedEnvironment) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(testDirectory, { recursive: true, force: true });
});

describe("Fred identity-recovery ticket workflow", () => {
  it("verifies the active ticket, creates the link, and saves one pending response", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("zendesk.com/api/v2/tickets/7559.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ticket: {
              id: 7559,
              status: "open",
              subject: "Locked account",
              via: { channel: "web" },
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          recoveryUrl:
            "https://app-server2.centralus.cloudapp.azure.com/online-kiosk/assisted/example",
          expiresUtc: "2026-09-13T18:10:00Z",
          displayName: "Ada Lovelace",
          upn: "ada.lovelace@sccc.edu",
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareIdentityRecovery(input, {
      id: 1,
      name: "Mark",
      role: "cio",
    });
    expect(result).toContain("saved the exact recovery response");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const stored = JSON.parse(
      await readFile(process.env.ZENDESK_REPLY_DRAFTS_PATH!, "utf8"),
    );
    expect(stored.drafts).toHaveLength(1);
    expect(stored.drafts[0]).toMatchObject({
      ticketId: 7559,
      source: "fred",
      status: "pending",
    });
  });

  it("stops before the broker when the cited ticket is already solved", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ticket: { id: 7559, status: "solved", subject: "Already handled" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareIdentityRecovery(input, {
      id: 1,
      name: "Mark",
      role: "cio",
    });
    expect(result).toContain("use an active ticket");
    expect(result).toContain("No account was changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops before the broker when a supervisor turns Fred drafting off", async () => {
    await writeFile(
      process.env.ZENDESK_SUPERVISION_CONFIG_PATH!,
      JSON.stringify({ fredEnabled: false, repliesEnabled: true }),
      "utf8",
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ticket: { id: 7559, status: "open", subject: "Locked account" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareIdentityRecovery(input, {
      id: 1,
      name: "Mark",
      role: "cio",
    });
    expect(result).toContain("Fred drafting is turned off");
    expect(result).toContain("No recovery link was created");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
