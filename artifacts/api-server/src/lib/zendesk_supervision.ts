import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type ZendeskSupervisionConfig = {
  fredEnabled: boolean;
  repliesEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByUserId: number | null;
  updatedByEmail: string | null;
};

export type ZendeskSupervisorActor = {
  id?: number | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  canManageTodos?: boolean | null;
};

export class ZendeskSupervisionUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Zendesk supervision controls are unavailable.", { cause });
    this.name = "ZendeskSupervisionUnavailableError";
  }
}

export function canManageZendeskControls(actor: ZendeskSupervisorActor) {
  return actor.role === "cio" || actor.canManageTodos === true;
}

const DEFAULT_CONFIG: ZendeskSupervisionConfig = {
  fredEnabled: false,
  repliesEnabled: false,
  updatedAt: null,
  updatedBy: null,
  updatedByUserId: null,
  updatedByEmail: null,
};

let configMutation = Promise.resolve();

function configPath() {
  return (
    process.env.ZENDESK_SUPERVISION_CONFIG_PATH?.trim() ||
    path.resolve(process.cwd(), "data", "zendesk-supervision.json")
  );
}

function normalizeConfig(value: unknown): ZendeskSupervisionConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Zendesk supervision state must be an object.");
  }
  const candidate = value as Partial<ZendeskSupervisionConfig>;
  if (
    typeof candidate.fredEnabled !== "boolean" ||
    typeof candidate.repliesEnabled !== "boolean"
  ) {
    throw new TypeError(
      "Zendesk supervision state must contain boolean fredEnabled and repliesEnabled values.",
    );
  }
  return {
    fredEnabled: candidate.fredEnabled,
    repliesEnabled: candidate.repliesEnabled,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
    updatedBy:
      typeof candidate.updatedBy === "string" ? candidate.updatedBy : null,
    updatedByUserId:
      typeof candidate.updatedByUserId === "number" &&
      Number.isInteger(candidate.updatedByUserId)
        ? candidate.updatedByUserId
        : null,
    updatedByEmail:
      typeof candidate.updatedByEmail === "string"
        ? candidate.updatedByEmail
        : null,
  };
}

export async function readZendeskSupervisionConfig(): Promise<ZendeskSupervisionConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }
}

function actorAudit(actor: ZendeskSupervisorActor) {
  const email = actor.email?.trim().toLowerCase() || null;
  const userId =
    typeof actor.id === "number" && Number.isInteger(actor.id)
      ? actor.id
      : null;
  return {
    updatedBy:
      actor.name?.trim() || email || (userId == null ? "Unknown supervisor" : `User #${userId}`),
    updatedByUserId: userId,
    updatedByEmail: email,
  };
}

async function writeConfig(value: ZendeskSupervisionConfig) {
  const target = configPath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function mutateConfig<T>(work: () => Promise<T>): Promise<T> {
  let resolveResult: (value: T | PromiseLike<T>) => void = () => undefined;
  let rejectResult: (reason?: unknown) => void = () => undefined;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  configMutation = configMutation
    .then(async () => {
      try {
        resolveResult(await work());
      } catch (error) {
        rejectResult(error);
      }
    })
    .catch(() => undefined);
  return result;
}

/**
 * Linearizes a controlled Zendesk operation with control updates. An OFF update
 * waits for already-started operations; once that update returns, later
 * operations observe OFF before they can perform any write.
 */
export async function withZendeskSupervisionConfig<T>(
  work: (controls: ZendeskSupervisionConfig) => Promise<T>,
): Promise<T> {
  return mutateConfig(async () => {
    let controls: ZendeskSupervisionConfig;
    try {
      controls = await readZendeskSupervisionConfig();
    } catch (error) {
      throw new ZendeskSupervisionUnavailableError(error);
    }
    return work(controls);
  });
}

export async function updateZendeskSupervisionConfig(
  updates: Partial<
    Pick<ZendeskSupervisionConfig, "fredEnabled" | "repliesEnabled">
  >,
  actor: ZendeskSupervisorActor,
): Promise<ZendeskSupervisionConfig> {
  return mutateConfig(async () => {
    const current = await readZendeskSupervisionConfig();
    const next: ZendeskSupervisionConfig = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
      ...actorAudit(actor),
    };
    await writeConfig(next);
    return next;
  });
}
