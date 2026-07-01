import https from "node:https";
import { URL } from "node:url";

/**
 * FortiGate web-filter URL whitelist client (REST API, cmdb webfilter).
 *
 * Ported from the SCCC Fortigate_Whitelist script. Talks to the FortiGate REST
 * API to append a URL pattern to the web-filter profile's URL-filter table so a
 * site is exempted/allowed for users behind that policy.
 *
 * NOTE: the FortiGate lives on the internal network (default 192.168.1.1). The
 * API server can only reach it when it runs on the SCCC network (or via VPN);
 * from an off-network host these calls will fail with a connection error, which
 * the routes surface as a 502.
 */

export type FortiGateConfig = {
  host: string;
  vdom: string;
  profile: string;
  token: string;
  verifySSL: boolean;
};

export type WhitelistEntry = {
  id: number | string;
  url: string;
  type: string;
  action: string;
  status: string;
};

export type WhitelistAction = "exempt" | "allow" | "monitor";

export class FortiGateError extends Error {}

/**
 * Reads FortiGate config from the environment. Returns null when the minimum
 * required settings (host + API token) are missing so callers can respond with
 * a clear "not configured" error instead of throwing.
 */
export function getFortiGateConfig(): FortiGateConfig | null {
  const host = process.env.FORTIGATE_HOST?.trim();
  const token = process.env.FORTIGATE_API_TOKEN?.trim();
  if (!host || !token) return null;
  return {
    host,
    token,
    vdom: process.env.FORTIGATE_VDOM?.trim() || "root",
    profile: process.env.FORTIGATE_WEBFILTER_PROFILE?.trim() || "default",
    verifySSL: process.env.FORTIGATE_VERIFY_SSL === "true",
  };
}

/** Strip scheme/trailing slash and wrap bare domains in wildcards (`*domain*`). */
export function normalizeUrlPattern(userInput: string): string {
  let value = userInput.trim();
  if (!value) throw new FortiGateError("URL/domain cannot be empty.");
  value = value.replace(/^https?:\/\//i, "").trim().replace(/^\/+|\/+$/g, "");
  if (!value) throw new FortiGateError("URL/domain cannot be empty after normalization.");
  if (value.includes("*")) return value;
  return `*${value}*`;
}

function safeNameFromProfile(profileName: string): string {
  const clean = profileName.trim().replace(/[^A-Za-z0-9_-]+/g, "_");
  return `${clean}_auto_url_whitelist`;
}

type FortiResponse = { status: number; data: any };

function request(
  cfg: FortiGateConfig,
  method: string,
  path: string,
  payload?: unknown,
): Promise<FortiResponse> {
  const url = new URL(`https://${cfg.host}/api/v2${path}`);
  url.searchParams.set("vdom", cfg.vdom);
  const body = payload !== undefined ? JSON.stringify(payload) : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        rejectUnauthorized: cfg.verifySSL,
        timeout: 30000,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: "application/json",
          ...(body
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
            : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let data: any = null;
          if (raw) {
            try {
              data = JSON.parse(raw);
            } catch {
              return reject(
                new FortiGateError(
                  `FortiGate returned non-JSON response (HTTP ${res.statusCode}): ${raw.slice(0, 300)}`,
                ),
              );
            }
          }
          const status = res.statusCode ?? 0;
          if (status >= 400) {
            return reject(
              new FortiGateError(`HTTP ${status} calling ${path}: ${JSON.stringify(data)}`),
            );
          }
          resolve({ status, data });
        });
      },
    );
    req.on("error", (err) =>
      reject(new FortiGateError(`Could not reach FortiGate at ${cfg.host}: ${err.message}`)),
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new FortiGateError(`FortiGate request to ${cfg.host} timed out.`));
    });
    if (body) req.write(body);
    req.end();
  });
}

function unwrapSingle(results: any): Record<string, any> {
  if (Array.isArray(results)) {
    if (results.length === 0) throw new FortiGateError("Object was not found.");
    return results[0];
  }
  return results;
}

async function getWebfilterProfile(cfg: FortiGateConfig): Promise<Record<string, any>> {
  const { data } = await request(cfg, "GET", `/cmdb/webfilter/profile/${encodeURIComponent(cfg.profile)}`);
  if (data?.results == null) {
    throw new FortiGateError(`Web filter profile "${cfg.profile}" was not found in VDOM "${cfg.vdom}".`);
  }
  return unwrapSingle(data.results);
}

function findAttachedTableId(profile: Record<string, any>): number | null {
  const web = profile.web;
  if (!web || typeof web !== "object") return null;
  const value = web["urlfilter-table"];
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return parseInt(value, 10);
  return null;
}

async function listUrlfilterTables(cfg: FortiGateConfig): Promise<any[]> {
  const { data } = await request(cfg, "GET", "/cmdb/webfilter/urlfilter");
  const results = data?.results ?? [];
  if (Array.isArray(results)) return results;
  if (results && typeof results === "object") return [results];
  return [];
}

async function getNextTableId(cfg: FortiGateConfig): Promise<number> {
  const tables = await listUrlfilterTables(cfg);
  const ids = tables
    .map((t) => t?.id)
    .map((id) => (typeof id === "number" ? id : typeof id === "string" && /^\d+$/.test(id) ? parseInt(id, 10) : null))
    .filter((n): n is number => n != null);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

async function getUrlfilterTable(cfg: FortiGateConfig, tableId: number): Promise<Record<string, any>> {
  const { data } = await request(cfg, "GET", `/cmdb/webfilter/urlfilter/${tableId}`);
  if (data?.results == null) throw new FortiGateError(`URL filter table ${tableId} was not found.`);
  return unwrapSingle(data.results);
}

function nextEntryId(entries: any[]): number {
  const ids = entries
    .map((e) => e?.id)
    .map((id) => (typeof id === "number" ? id : typeof id === "string" && /^\d+$/.test(id) ? parseInt(id, 10) : null))
    .filter((n): n is number => n != null);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function toEntry(e: any): WhitelistEntry {
  return {
    id: e?.id ?? "",
    url: String(e?.url ?? ""),
    type: String(e?.type ?? "wildcard"),
    action: String(e?.action ?? ""),
    status: String(e?.status ?? ""),
  };
}

/** Returns the current URL-filter entries attached to the configured profile. */
export async function listWhitelistEntries(cfg: FortiGateConfig): Promise<WhitelistEntry[]> {
  const profile = await getWebfilterProfile(cfg);
  const tableId = findAttachedTableId(profile);
  if (tableId == null) return [];
  const table = await getUrlfilterTable(cfg, tableId);
  const entries = Array.isArray(table.entries) ? table.entries : [];
  return entries.map(toEntry);
}

export type WhitelistResult = {
  tableId: number;
  tableName: string;
  added: boolean;
  entry: WhitelistEntry | null;
};

/**
 * Appends `urlPattern` to the profile's URL-filter table (creating and attaching
 * a table if none exists). Idempotent: if the pattern is already present it
 * returns `added: false` without modifying anything.
 */
export async function whitelistUrl(
  cfg: FortiGateConfig,
  urlPattern: string,
  action: WhitelistAction = "exempt",
): Promise<WhitelistResult> {
  const profile = await getWebfilterProfile(cfg);
  let tableId = findAttachedTableId(profile);

  if (tableId == null) {
    tableId = await getNextTableId(cfg);
    const tableName = safeNameFromProfile(cfg.profile);
    await request(cfg, "POST", "/cmdb/webfilter/urlfilter", { id: tableId, name: tableName, entries: [] });
    await request(cfg, "PUT", `/cmdb/webfilter/profile/${encodeURIComponent(cfg.profile)}`, {
      web: { "urlfilter-table": tableId },
    });
  }

  const table = await getUrlfilterTable(cfg, tableId);
  const tableName = String(table.name ?? `urlfilter_${tableId}`);
  const entries: any[] = Array.isArray(table.entries) ? table.entries : [];

  const exists = entries.some(
    (e) => String(e?.url ?? "").trim().toLowerCase() === urlPattern.toLowerCase(),
  );
  if (exists) return { tableId, tableName, added: false, entry: null };

  const newEntry = {
    id: nextEntryId(entries),
    url: urlPattern,
    type: "wildcard",
    action,
    status: "enable",
  };
  entries.push(newEntry);
  await request(cfg, "PUT", `/cmdb/webfilter/urlfilter/${tableId}`, {
    id: tableId,
    name: tableName,
    entries,
  });

  return { tableId, tableName, added: true, entry: toEntry(newEntry) };
}
