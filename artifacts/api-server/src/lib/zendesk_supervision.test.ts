import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canManageZendeskControls,
  readZendeskSupervisionConfig,
  updateZendeskSupervisionConfig,
  withZendeskSupervisionConfig,
} from "./zendesk_supervision";

const originalPath = process.env.ZENDESK_SUPERVISION_CONFIG_PATH;
let testDirectory: string | null = null;

afterEach(async () => {
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
  testDirectory = null;
  if (originalPath === undefined) {
    delete process.env.ZENDESK_SUPERVISION_CONFIG_PATH;
  } else {
    process.env.ZENDESK_SUPERVISION_CONFIG_PATH = originalPath;
  }
});

async function useTemporaryConfig() {
  testDirectory = await mkdtemp(path.join(tmpdir(), "zendesk-supervision-"));
  process.env.ZENDESK_SUPERVISION_CONFIG_PATH = path.join(
    testDirectory,
    "controls.json",
  );
}

describe("Zendesk supervision controls", () => {
  it("allows only the CIO and explicitly delegated supervisors", () => {
    expect(canManageZendeskControls({ id: 1, role: "cio" })).toBe(true);
    expect(
      canManageZendeskControls({
        id: 2,
        role: "helpdesk",
        canManageTodos: true,
      }),
    ).toBe(true);
    expect(canManageZendeskControls({ name: "Mark Bojeun" })).toBe(false);
    expect(canManageZendeskControls({ email: "tracy@sccc.edu" })).toBe(false);
    expect(canManageZendeskControls({ role: "helpdesk" })).toBe(false);
  });

  it("defaults Fred and Zendesk replies to disabled when no state exists", async () => {
    await useTemporaryConfig();
    await expect(readZendeskSupervisionConfig()).resolves.toMatchObject({
      fredEnabled: false,
      repliesEnabled: false,
    });
  });

  it("persists supervisor changes with an audit stamp", async () => {
    await useTemporaryConfig();
    const result = await updateZendeskSupervisionConfig(
      { fredEnabled: false, repliesEnabled: false },
      {
        id: 42,
        name: "Mark Bojeun",
        email: "MARK.BOJEUN@sccc.edu",
        role: "helpdesk",
        canManageTodos: true,
      },
    );

    expect(result).toMatchObject({
      fredEnabled: false,
      repliesEnabled: false,
      updatedBy: "Mark Bojeun",
      updatedByUserId: 42,
      updatedByEmail: "mark.bojeun@sccc.edu",
    });
    expect(result.updatedAt).toBeTruthy();
    expect(
      JSON.parse(
        await readFile(process.env.ZENDESK_SUPERVISION_CONFIG_PATH!, "utf8"),
      ),
    ).toEqual(result);
  });

  it("serializes partial updates so concurrent supervisors cannot lose a change", async () => {
    await useTemporaryConfig();
    await updateZendeskSupervisionConfig(
      { fredEnabled: true, repliesEnabled: true },
      { id: 1, name: "Test setup", role: "cio" },
    );

    await Promise.all([
      updateZendeskSupervisionConfig(
        { fredEnabled: false },
        { id: 1, name: "CIO", role: "cio" },
      ),
      updateZendeskSupervisionConfig(
        { repliesEnabled: false },
        { id: 2, name: "Supervisor", canManageTodos: true },
      ),
    ]);

    await expect(readZendeskSupervisionConfig()).resolves.toMatchObject({
      fredEnabled: false,
      repliesEnabled: false,
    });
  });

  it("does not report an OFF update complete before an in-flight controlled action finishes", async () => {
    await useTemporaryConfig();
    await updateZendeskSupervisionConfig(
      { fredEnabled: true, repliesEnabled: true },
      { id: 1, name: "Test setup", role: "cio" },
    );
    let allowActionToFinish!: () => void;
    let reportActionStarted!: () => void;
    const actionCanFinish = new Promise<void>((resolve) => {
      allowActionToFinish = resolve;
    });
    const actionStarted = new Promise<void>((resolve) => {
      reportActionStarted = resolve;
    });

    const action = withZendeskSupervisionConfig(async (controls) => {
      expect(controls.repliesEnabled).toBe(true);
      reportActionStarted();
      await actionCanFinish;
    });
    await actionStarted;

    let offUpdateCompleted = false;
    const turnOff = updateZendeskSupervisionConfig(
      { repliesEnabled: false },
      { id: 1, name: "CIO", role: "cio" },
    ).then(() => {
      offUpdateCompleted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(offUpdateCompleted).toBe(false);

    allowActionToFinish();
    await Promise.all([action, turnOff]);
    let laterWriteRan = false;
    await withZendeskSupervisionConfig(async (controls) => {
      if (controls.repliesEnabled) laterWriteRan = true;
    });
    expect(laterWriteRan).toBe(false);
  });

  it("fails closed when persisted control state is malformed", async () => {
    await useTemporaryConfig();
    await writeFile(
      process.env.ZENDESK_SUPERVISION_CONFIG_PATH!,
      "{ definitely-not-valid-json",
      "utf8",
    );

    await expect(readZendeskSupervisionConfig()).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });

  it("fails closed when persisted control switches are missing or invalid", async () => {
    await useTemporaryConfig();
    await writeFile(
      process.env.ZENDESK_SUPERVISION_CONFIG_PATH!,
      JSON.stringify({ fredEnabled: false }),
      "utf8",
    );

    await expect(readZendeskSupervisionConfig()).rejects.toThrow(
      /boolean fredEnabled and repliesEnabled/,
    );

    await writeFile(
      process.env.ZENDESK_SUPERVISION_CONFIG_PATH!,
      JSON.stringify({ fredEnabled: false, repliesEnabled: "yes" }),
      "utf8",
    );

    await expect(readZendeskSupervisionConfig()).rejects.toThrow(
      /boolean fredEnabled and repliesEnabled/,
    );
  });
});
