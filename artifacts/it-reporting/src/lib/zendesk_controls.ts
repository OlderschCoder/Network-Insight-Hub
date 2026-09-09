export type ZendeskControlKey = "fredEnabled" | "repliesEnabled";

export type ZendeskControls = {
  fredEnabled: boolean;
  repliesEnabled: boolean;
  canManage: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type ZendeskControlsStatus = "loading" | "ready" | "error";

export type ZendeskControlConfirmation = {
  title: string;
  description: string;
  confirmText: string;
  destructive: boolean;
};

type AuthenticatedFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type ConfirmControlUpdate = (
  options: ZendeskControlConfirmation,
) => Promise<boolean>;

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseZendeskControls(value: unknown): ZendeskControls | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ZendeskControls>;
  if (
    typeof candidate.fredEnabled !== "boolean" ||
    typeof candidate.repliesEnabled !== "boolean" ||
    typeof candidate.canManage !== "boolean" ||
    !nullableString(candidate.updatedAt) ||
    !nullableString(candidate.updatedBy)
  ) {
    return null;
  }
  return {
    fredEnabled: candidate.fredEnabled,
    repliesEnabled: candidate.repliesEnabled,
    canManage: candidate.canManage,
    updatedAt: candidate.updatedAt,
    updatedBy: candidate.updatedBy,
  };
}

async function responseBody(response: Response) {
  return (await response.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;
}

function responseError(
  response: Response,
  body: { error?: unknown; message?: unknown } | null,
  fallback: string,
) {
  const detail =
    typeof body?.message === "string" && body.message.trim()
      ? body.message.trim()
      : typeof body?.error === "string" && body.error.trim()
        ? body.error.trim()
        : "";
  return new Error(
    detail || `${fallback} (HTTP ${response.status || "unknown"}).`,
  );
}

export async function getZendeskControls(
  fetcher: AuthenticatedFetch,
  endpoint: string,
): Promise<ZendeskControls> {
  const response = await fetcher(endpoint, { method: "GET" });
  const body = await responseBody(response);
  if (!response.ok) {
    throw responseError(response, body, "Unable to load Zendesk controls");
  }
  const controls = parseZendeskControls(body);
  if (!controls) {
    throw new Error("Zendesk returned an invalid control status.");
  }
  return controls;
}

export class ZendeskRepliesDisabledError extends Error {
  readonly controls: ZendeskControls;

  constructor(controls: ZendeskControls) {
    super("Zendesk replies were turned off before this draft could be handed off.");
    this.name = "ZendeskRepliesDisabledError";
    this.controls = controls;
  }
}

export class ZendeskControlsUnavailableError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Reply permission could not be verified. Nothing was copied or opened.");
    this.name = "ZendeskControlsUnavailableError";
    this.cause = cause;
  }
}

export async function withFreshZendeskReplyPermission<T>(
  fetcher: AuthenticatedFetch,
  endpoint: string,
  action: () => Promise<T> | T,
): Promise<{ controls: ZendeskControls; result: T }> {
  let controls: ZendeskControls;
  try {
    controls = await getZendeskControls(fetcher, endpoint);
  } catch (error) {
    throw new ZendeskControlsUnavailableError(error);
  }
  if (!controls.repliesEnabled) {
    throw new ZendeskRepliesDisabledError(controls);
  }
  return { controls, result: await action() };
}

export function zendeskControlConfirmation(
  key: ZendeskControlKey,
  nextValue: boolean,
): ZendeskControlConfirmation {
  const name = key === "fredEnabled" ? "Fred drafting" : "Zendesk replies";
  const description =
    key === "fredEnabled"
      ? nextValue
        ? "Fred will be allowed to prepare supervised Zendesk drafts and perform confirmed Zendesk actions again."
        : "Fred will stop preparing drafts and all of his Zendesk write actions will be blocked."
      : nextValue
        ? "Supervisors will be able to post confirmed public replies from Insights again."
        : "All public replies from Insights and Fred will be blocked at the API. Escalation remains available.";
  return {
    title: `Turn ${name} ${nextValue ? "on" : "off"}?`,
    description,
    confirmText: `Turn ${nextValue ? "on" : "off"}`,
    destructive: !nextValue,
  };
}

export async function putZendeskControl(
  fetcher: AuthenticatedFetch,
  endpoint: string,
  key: ZendeskControlKey,
  nextValue: boolean,
): Promise<ZendeskControls> {
  const response = await fetcher(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: nextValue }),
  });
  const body = await responseBody(response);
  if (!response.ok) {
    throw responseError(response, body, "Unable to update Zendesk controls");
  }
  const controls = parseZendeskControls(body);
  if (!controls) {
    throw new Error("Zendesk returned an invalid updated control status.");
  }
  return controls;
}

export async function confirmZendeskControlUpdate(
  confirm: ConfirmControlUpdate,
  fetcher: AuthenticatedFetch,
  endpoint: string,
  key: ZendeskControlKey,
  nextValue: boolean,
): Promise<ZendeskControls | null> {
  const approved = await confirm(zendeskControlConfirmation(key, nextValue));
  if (!approved) return null;
  return putZendeskControl(fetcher, endpoint, key, nextValue);
}

export function zendeskControlStatusText(
  status: ZendeskControlsStatus,
  enabled: boolean,
  readyText: { on: string; off: string },
) {
  if (status === "loading") return "Loading control status…";
  if (status === "error") return "Unavailable — status unknown";
  return enabled ? readyText.on : readyText.off;
}
