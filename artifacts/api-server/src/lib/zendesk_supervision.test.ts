import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readZendeskSupervisionConfig,
  updateZendeskSupervisionConfig,
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
  it("defaults Fred and Zendesk replies to enabled", async () => {
    await useTemporaryConfig();
    await expect(readZendeskSupervisionConfig()).resolves.toMatchObject({
      fredEnabled: true,
      repliesEnabled: true,
    });
  });

  it("persists supervisor changes with an audit stamp", async () => {
    await useTemporaryConfig();
    const result = await updateZendeskSupervisionConfig(
      { fredEnabled: false, repliesEnabled: false },
      "Mark Bojeun",
    );

    expect(result).toMatchObject({
      fredEnabled: false,
      repliesEnabled: false,
      updatedBy: "Mark Bojeun",
    });
    expect(result.updatedAt).toBeTruthy();
    expect(
      JSON.parse(
        await readFile(process.env.ZENDESK_SUPERVISION_CONFIG_PATH!, "utf8"),
      ),
    ).toEqual(result);
  });
});
