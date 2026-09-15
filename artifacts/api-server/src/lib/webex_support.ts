let webexSupportAccessToken = process.env.WEBEX_ACCESS_TOKEN || "";

const MAX_WEBEX_DEVICE_PAGES = 20;

type DevicePageFetcher = (pathname: string) => Promise<Response>;

export type WebexDeviceCollection = {
  devices: Array<Record<string, unknown>>;
  complete: boolean;
};

export type WebexSupportDevice = {
  id: string;
  name: string;
  product: string;
  status: "online" | "offline" | "unknown";
  personId: string | null;
  workspaceId: string | null;
};

export const INCOMPLETE_WEBEX_DEVICE_INVENTORY_ERROR =
  "Webex returned incomplete device inventory; totals and offline conclusions are unavailable.";

export function isWebexSupportConfigured(): boolean {
  return !!(
    process.env.WEBEX_ACCESS_TOKEN ||
    (process.env.WEBEX_REFRESH_TOKEN &&
      process.env.WEBEX_CLIENT_ID &&
      process.env.WEBEX_CLIENT_SECRET)
  );
}

async function refreshWebexSupportAccessToken(): Promise<boolean> {
  const refreshToken = process.env.WEBEX_REFRESH_TOKEN;
  const clientId = process.env.WEBEX_CLIENT_ID;
  const clientSecret = process.env.WEBEX_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) return false;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const response = await fetch("https://webexapis.com/v1/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return false;

  const tokens = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!tokens.access_token) return false;
  webexSupportAccessToken = tokens.access_token;
  if (tokens.refresh_token)
    process.env.WEBEX_REFRESH_TOKEN = tokens.refresh_token;
  return true;
}

export async function webexSupportFetch(
  pathname: string,
  retry = true,
): Promise<Response> {
  if (!webexSupportAccessToken) {
    webexSupportAccessToken = process.env.WEBEX_ACCESS_TOKEN || "";
  }
  if (!webexSupportAccessToken && !(await refreshWebexSupportAccessToken())) {
    throw new Error("Webex is not configured");
  }

  const requestUrl = pathname.startsWith("https://webexapis.com/v1/")
    ? pathname
    : `https://webexapis.com/v1${pathname}`;
  const response = await fetch(requestUrl, {
    headers: {
      Authorization: `Bearer ${webexSupportAccessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (
    response.status === 401 &&
    retry &&
    (await refreshWebexSupportAccessToken())
  ) {
    return webexSupportFetch(pathname, false);
  }
  return response;
}

function parseNextDevicesUrl(response: Response): {
  next?: string;
  valid: boolean;
} {
  const link = response.headers.get("link");
  if (!link) return { valid: true };

  for (const segment of link.split(/,(?=\s*<)/)) {
    const relMatch = segment.match(/;\s*rel\s*=\s*(?:"([^"]+)"|([^;,\s]+))/i);
    const relationships = (relMatch?.[1] ?? relMatch?.[2] ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!relationships.includes("next")) continue;

    const urlMatch = segment.match(/^\s*<([^>]+)>/);
    if (!urlMatch) return { valid: false };
    try {
      const next = new URL(urlMatch[1], "https://webexapis.com");
      if (
        next.protocol !== "https:" ||
        next.hostname !== "webexapis.com" ||
        next.port ||
        next.username ||
        next.password ||
        next.pathname !== "/v1/devices"
      ) {
        return { valid: false };
      }
      return { next: next.toString(), valid: true };
    } catch {
      return { valid: false };
    }
  }

  // A malformed next relation must not be mistaken for the end of the result set.
  if (/\brel\s*=\s*(?:"[^"]*\bnext\b|[^;,\s]*\bnext\b)/i.test(link)) {
    return { valid: false };
  }
  return { valid: true };
}

/** Fetch every trusted Webex device page. Any gap is explicitly incomplete. */
export async function fetchAllWebexDevices(
  fetchPage: DevicePageFetcher = webexSupportFetch,
  maxPages = MAX_WEBEX_DEVICE_PAGES,
): Promise<WebexDeviceCollection> {
  const devices: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  let pathname = "/devices?max=1000";

  for (let page = 0; page < Math.max(1, maxPages); page += 1) {
    const normalizedUrl = pathname.startsWith("https://")
      ? new URL(pathname).toString()
      : new URL(`/v1${pathname}`, "https://webexapis.com").toString();
    if (seen.has(normalizedUrl)) return { devices, complete: false };
    seen.add(normalizedUrl);

    let response: Response;
    try {
      response = await fetchPage(pathname);
    } catch {
      return { devices, complete: false };
    }
    if (!response.ok) return { devices, complete: false };

    let data: { items?: unknown };
    try {
      data = (await response.json()) as { items?: unknown };
    } catch {
      return { devices, complete: false };
    }
    if (!Array.isArray(data.items)) return { devices, complete: false };
    devices.push(...(data.items as Array<Record<string, unknown>>));

    const pagination = parseNextDevicesUrl(response);
    if (!pagination.valid) return { devices, complete: false };
    if (!pagination.next) return { devices, complete: true };
    pathname = pagination.next;
  }

  return { devices, complete: false };
}

/** Converts only a complete collection into support-screen totals and rows. */
export function prepareWebexSupportDeviceInventory(
  collection: WebexDeviceCollection,
): { devices: WebexSupportDevice[]; error: string | null } {
  if (!collection.complete) {
    return {
      devices: [],
      error: INCOMPLETE_WEBEX_DEVICE_INVENTORY_ERROR,
    };
  }

  const devices = collection.devices
    .map((device) => {
      const rawStatus = String(
        device.connectionStatus || device.status || "unknown",
      ).toLowerCase();
      const status: WebexSupportDevice["status"] =
        rawStatus === "connected"
          ? "online"
          : rawStatus === "disconnected"
            ? "offline"
            : "unknown";
      return {
        id: String(device.id || ""),
        name: String(device.displayName || device.name || "Unnamed device"),
        product: String(device.product || device.type || "Unknown"),
        status,
        personId: String(device.personId || "").trim() || null,
        workspaceId: String(device.workspaceId || "").trim() || null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { devices, error: null };
}
