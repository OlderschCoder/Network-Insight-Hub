import crypto from "crypto";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Microsoft Entra ID (Azure AD) OIDC — Authorization Code + PKCE (confidential
// client). This is the sign-in identity provider for the Hub. It is kept
// deliberately separate from the AZURE_* service principal used for VM
// inventory (that one is client-credentials against ARM, this one is a
// delegated user sign-in against Microsoft identity platform + Graph).
// ---------------------------------------------------------------------------

export type EntraConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

const GRAPH_ME =
  "https://graph.microsoft.com/v1.0/me?$select=id,displayName,givenName,surname,mail,userPrincipalName,jobTitle";

export function getEntraConfig(): EntraConfig | null {
  const redirectUri = process.env.ENTRA_REDIRECT_URI;
  if (!redirectUri) return null;

  // Prefer dedicated ENTRA_* SSO credentials. If none are set, fall back to the
  // AZURE_* service-principal app registration so a single Entra app can power
  // both VM inventory and staff sign-in — the operator just adds the redirect
  // URI (above) plus an access gate. Each credential set is taken all-or-nothing
  // so a client id from one app is never paired with a secret from the other.
  const entraTrio = [
    process.env.ENTRA_TENANT_ID,
    process.env.ENTRA_CLIENT_ID,
    process.env.ENTRA_CLIENT_SECRET,
  ];
  const azureTrio = [
    process.env.AZURE_TENANT_ID,
    process.env.AZURE_CLIENT_ID,
    process.env.AZURE_CLIENT_SECRET,
  ];
  const trio = entraTrio.every(Boolean)
    ? entraTrio
    : azureTrio.every(Boolean)
      ? azureTrio
      : null;
  if (!trio) return null;
  const [tenantId, clientId, clientSecret] = trio as [string, string, string];
  return { tenantId, clientId, clientSecret, redirectUri };
}

export function isEntraConfigured(): boolean {
  return getEntraConfig() !== null;
}

function authority(cfg: EntraConfig): string {
  return `https://login.microsoftonline.com/${cfg.tenantId}`;
}

// --- PKCE helpers ----------------------------------------------------------

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export function randomState(): string {
  return crypto.randomBytes(24).toString("base64url");
}

// --- Authorize URL ---------------------------------------------------------

export function buildAuthorizeUrl(
  cfg: EntraConfig,
  opts: { state: string; nonce: string; codeChallenge: string },
): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    // openid/profile/email for identity; User.Read for the Graph profile call.
    scope: "openid profile email User.Read",
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${authority(cfg)}/oauth2/v2.0/authorize?${params.toString()}`;
}

// --- Token exchange --------------------------------------------------------

export type TokenSet = {
  accessToken: string;
  idToken: string;
  idClaims: Record<string, any>;
};

export async function exchangeCodeForTokens(
  cfg: EntraConfig,
  opts: { code: string; codeVerifier: string; expectedNonce: string },
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: cfg.redirectUri,
    code_verifier: opts.codeVerifier,
    scope: "openid profile email User.Read",
  });
  const res = await fetch(`${authority(cfg)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Entra token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    id_token?: string;
  };
  if (!json.access_token || !json.id_token) {
    throw new Error("Entra token exchange returned no tokens");
  }
  const idClaims = decodeJwtPayload(json.id_token);

  // Validate core id_token claims. The token was received directly from the
  // Microsoft token endpoint over TLS (confidential client), so we trust its
  // origin; we still validate audience, issuer tenant, expiry and nonce.
  const now = Math.floor(Date.now() / 1000);
  if (typeof idClaims.exp === "number" && idClaims.exp < now - 60) {
    throw new Error("Entra id_token is expired");
  }
  if (idClaims.aud && idClaims.aud !== cfg.clientId) {
    throw new Error("Entra id_token audience mismatch");
  }
  if (typeof idClaims.iss === "string" && !idClaims.iss.includes(cfg.tenantId)) {
    throw new Error("Entra id_token issuer/tenant mismatch");
  }
  if (opts.expectedNonce && idClaims.nonce && idClaims.nonce !== opts.expectedNonce) {
    throw new Error("Entra id_token nonce mismatch");
  }

  return { accessToken: json.access_token, idToken: json.id_token, idClaims };
}

function decodeJwtPayload(jwt: string): Record<string, any> {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new Error("Malformed JWT");
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload);
}

// --- Graph profile ---------------------------------------------------------

export type EntraProfile = {
  oid: string;
  email: string;
  name: string;
  jobTitle: string | null;
  groups: string[];
  roles: string[];
};

export async function getEntraProfile(
  tokens: TokenSet,
): Promise<EntraProfile> {
  const c = tokens.idClaims;
  const oid: string | undefined = c.oid || c.sub;
  if (!oid) throw new Error("Entra id_token has no object id");

  // Prefer a real mailbox address; fall back to UPN / claim email.
  let email: string | undefined =
    (typeof c.email === "string" && c.email) ||
    (typeof c.preferred_username === "string" && c.preferred_username) ||
    undefined;
  let name: string = c.name || "";
  let jobTitle: string | null = null;

  // Graph /me fills in job title (and a better email/name) — User.Read scope.
  try {
    const res = await fetch(GRAPH_ME, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (res.ok) {
      const me = (await res.json()) as {
        mail?: string;
        userPrincipalName?: string;
        displayName?: string;
        jobTitle?: string;
      };
      email = me.mail || me.userPrincipalName || email;
      name = me.displayName || name;
      jobTitle = me.jobTitle || null;
    } else {
      logger.warn({ status: res.status }, "Entra Graph /me returned non-OK");
    }
  } catch (err) {
    logger.warn({ err }, "Entra Graph /me call failed; using id_token claims");
  }

  if (!email) throw new Error("Could not determine email from Entra identity");

  const groups: string[] = Array.isArray(c.groups) ? c.groups : [];
  const roles: string[] = Array.isArray(c.roles) ? c.roles : [];

  return { oid, email: email.toLowerCase(), name: name || email, jobTitle, groups, roles };
}

// --- Access gating (IT group / app role) -----------------------------------

function csvEnv(name: string): string[] {
  return (process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when at least one access-gate value is configured. */
export function isAccessGateConfigured(): boolean {
  return (
    csvEnv("ENTRA_ALLOWED_GROUP_IDS").length > 0 ||
    csvEnv("ENTRA_ALLOWED_APP_ROLES").length > 0
  );
}

/**
 * Decide whether an Entra identity is allowed into the Hub.
 * - If ENTRA_ALLOWED_GROUP_IDS is set, the user must belong to one of them.
 * - If ENTRA_ALLOWED_APP_ROLES is set, the user must have one of those roles.
 * - When both are set, satisfying either is sufficient.
 * - When NEITHER is set, access is DENIED (fail closed). An IT membership gate
 *   is mandatory; without it we cannot prove the user belongs to IT, so we
 *   refuse rather than admit any tenant user. Operators must set at least one
 *   of ENTRA_ALLOWED_GROUP_IDS / ENTRA_ALLOWED_APP_ROLES.
 */
export function isAccessAllowed(profile: EntraProfile): boolean {
  const allowedGroups = csvEnv("ENTRA_ALLOWED_GROUP_IDS");
  const allowedRoles = csvEnv("ENTRA_ALLOWED_APP_ROLES");

  if (allowedGroups.length === 0 && allowedRoles.length === 0) {
    logger.error(
      "Entra access gate is not configured (ENTRA_ALLOWED_GROUP_IDS / ENTRA_ALLOWED_APP_ROLES); denying sign-in (fail closed)",
    );
    return false;
  }

  const inGroup = allowedGroups.some((g) => profile.groups.includes(g));
  const inRole = allowedRoles.some((r) => profile.roles.includes(r));
  return inGroup || inRole;
}

// --- Title / app-role → Hub role mapping -----------------------------------

export type HubRole =
  | "cio"
  | "network_engineer"
  | "security_engineer"
  | "network"
  | "security"
  | "helpdesk"
  | "staff";

const VALID_HUB_ROLES = new Set<HubRole>([
  "cio",
  "network_engineer",
  "security_engineer",
  "network",
  "security",
  "helpdesk",
  "staff",
]);

// Default title-keyword → Hub role mapping. Matched case-insensitively against
// the user's job title; first match (in order) wins. Operators can override or
// extend via ENTRA_ROLE_MAP_JSON (a JSON object of keyword → hub role).
const DEFAULT_TITLE_MAP: Array<[string, HubRole]> = [
  ["chief information", "cio"],
  ["cio", "cio"],
  ["network engineer", "network_engineer"],
  ["security engineer", "security_engineer"],
  ["network admin", "network"],
  ["network", "network"],
  ["security", "security"],
  ["help desk", "helpdesk"],
  ["helpdesk", "helpdesk"],
  ["support", "helpdesk"],
  ["technician", "helpdesk"],
];

function loadRoleMapOverride(): Record<string, HubRole> {
  const raw = process.env.ENTRA_ROLE_MAP_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, HubRole> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (VALID_HUB_ROLES.has(v as HubRole)) {
        out[k.toLowerCase()] = v as HubRole;
      } else {
        logger.warn({ key: k, value: v }, "ENTRA_ROLE_MAP_JSON has invalid hub role; skipping");
      }
    }
    return out;
  } catch (err) {
    logger.warn({ err }, "ENTRA_ROLE_MAP_JSON is not valid JSON; ignoring");
    return {};
  }
}

/**
 * Map an Entra identity to a Hub role. Checked in order:
 *  1. App roles (roles claim) matched against the override map keys.
 *  2. Job title keywords matched against the override map then the defaults.
 *  3. Fallback to "staff".
 */
export function mapEntraToHubRole(profile: EntraProfile): HubRole {
  const override = loadRoleMapOverride();

  // App roles first — an explicit Entra app-role assignment is the strongest signal.
  for (const r of profile.roles) {
    const hit = override[r.toLowerCase()];
    if (hit) return hit;
  }

  const title = (profile.jobTitle || "").toLowerCase();
  if (title) {
    for (const [keyword, role] of Object.entries(override)) {
      if (title.includes(keyword)) return role;
    }
    for (const [keyword, role] of DEFAULT_TITLE_MAP) {
      if (title.includes(keyword)) return role;
    }
  }

  return "staff";
}
