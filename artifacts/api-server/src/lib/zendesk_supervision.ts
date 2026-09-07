import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ZendeskSupervisionConfig = {
  fredEnabled: boolean;
  repliesEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

const DEFAULT_CONFIG: ZendeskSupervisionConfig = {
  fredEnabled: true,
  repliesEnabled: true,
  updatedAt: null,
  updatedBy: null,
};

function configPath() {
  return (
    process.env.ZENDESK_SUPERVISION_CONFIG_PATH?.trim() ||
    path.resolve(process.cwd(), "data", "zendesk-supervision.json")
  );
}

function normalizeConfig(value: unknown): ZendeskSupervisionConfig {
  if (!value || typeof value !== "object") return { ...DEFAULT_CONFIG };
  const candidate = value as Partial<ZendeskSupervisionConfig>;
  return {
    fredEnabled:
      typeof candidate.fredEnabled === "boolean"
        ? candidate.fredEnabled
        : DEFAULT_CONFIG.fredEnabled,
    repliesEnabled:
      typeof candidate.repliesEnabled === "boolean"
        ? candidate.repliesEnabled
        : DEFAULT_CONFIG.repliesEnabled,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
    updatedBy:
      typeof candidate.updatedBy === "string" ? candidate.updatedBy : null,
  };
}

export async function readZendeskSupervisionConfig(): Promise<ZendeskSupervisionConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch (error: any) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) {
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }
}

export async function updateZendeskSupervisionConfig(
  updates: Partial<
    Pick<ZendeskSupervisionConfig, "fredEnabled" | "repliesEnabled">
  >,
  actor: string,
): Promise<ZendeskSupervisionConfig> {
  const current = await readZendeskSupervisionConfig();
  const next: ZendeskSupervisionConfig = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.trim() || "Unknown supervisor",
  };
  const target = configPath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
