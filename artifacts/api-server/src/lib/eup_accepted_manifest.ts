import { createHash, createHmac } from "node:crypto";

export const EUP_ACCEPTED_MANIFEST_SCHEMA_VERSION = 2;
export const EUP_ACCEPTED_MANIFEST_AUTHORITY_CONTRACT =
  "bannerUserName-exact-dotted-max20";
export const EUP_ACCEPTED_MANIFEST_RESPONSE_CONTEXT =
  "accepted-manifest-response";
export const EUP_ACCEPTED_MANIFEST_MAX_AGE_MS = 15 * 60 * 1000;
export const EUP_ACCEPTED_MONITOR_MAX_AGE_MS = 60 * 60 * 1000;
export const EUP_ACCEPTED_CLOCK_SKEW_MS = 5 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

type VerifiedBannerIdentity = {
  bannerId: string;
  bannerUserName: string;
  personId: string;
  expectedPersonId: string;
  expectedUdcIdentifier: string;
  profileUdcIdentifier: string;
  checkedUtc: string;
};

export type EupAcceptedManifest = {
  schemaVersion: number;
  authorityContract: string;
  generatedUtc: string;
  servedUtc: string;
  sourceCounts: {
    acceptedMonitorRows: number;
    bannerVerificationRows: number;
    usableRows: number;
    omittedAcceptedRows: number;
  };
  students: JsonRecord[];
};

export type SignedEupAcceptedManifest = {
  body: string;
  bodySha256: string;
  responseTimestamp: string;
  signature: string;
};

export class EupAcceptedManifestUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EupAcceptedManifestUnavailableError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactString(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    return null;
  }
  return value;
}

function exactBannerId(value: unknown): string | null {
  const candidate = exactString(value);
  return candidate && /^800[0-9]{6}$/.test(candidate) ? candidate : null;
}

function exactBannerUserName(value: unknown): string | null {
  const candidate = exactString(value);
  if (
    !candidate ||
    candidate !== candidate.toLowerCase() ||
    candidate.length > 20 ||
    !/^[a-z0-9]+(?:\.[a-z0-9]+)+$/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function normalizedPersonId(value: unknown): string | null {
  const candidate = exactString(value);
  if (!candidate) return null;
  const normalized = candidate.toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    normalized,
  )
    ? normalized
    : null;
}

function normalizedUdcIdentifier(value: unknown): string | null {
  const candidate = exactString(value);
  return candidate ? candidate.toUpperCase() : null;
}

function countValues(values: Iterable<string | null>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function hasOne(counts: Map<string, number>, value: string): boolean {
  return counts.get(value) === 1;
}

function requireRows(
  source: unknown,
  property: string,
  sourceName: string,
): JsonRecord[] {
  if (!isRecord(source) || !Array.isArray(source[property])) {
    throw new EupAcceptedManifestUnavailableError(
      `${sourceName} does not contain a ${property} array`,
    );
  }
  if (!source[property].every(isRecord)) {
    throw new EupAcceptedManifestUnavailableError(
      `${sourceName} ${property} contains a malformed row`,
    );
  }
  return source[property];
}

function requireGeneratedUtc(source: unknown, nowMs: number): string {
  if (!isRecord(source)) {
    throw new EupAcceptedManifestUnavailableError(
      "accepted monitor is not an object",
    );
  }
  const generatedUtc = exactString(source.GeneratedUtc);
  const generatedMs = generatedUtc ? Date.parse(generatedUtc) : Number.NaN;
  if (!generatedUtc || !Number.isFinite(generatedMs)) {
    throw new EupAcceptedManifestUnavailableError(
      "accepted monitor GeneratedUtc is missing or invalid",
    );
  }
  if (
    nowMs - generatedMs > EUP_ACCEPTED_MONITOR_MAX_AGE_MS ||
    generatedMs - nowMs > EUP_ACCEPTED_CLOCK_SKEW_MS
  ) {
    throw new EupAcceptedManifestUnavailableError(
      "accepted monitor GeneratedUtc is outside the one-hour freshness window",
    );
  }
  return generatedUtc;
}

function verifiedIdentity(
  row: JsonRecord,
  nowMs: number,
): VerifiedBannerIdentity | null {
  const bannerId = exactBannerId(row.BannerId);
  const bannerUserName = exactBannerUserName(row.BannerUserName);
  const personId = normalizedPersonId(row.PersonId);
  const expectedPersonId = normalizedPersonId(row.ExpectedPersonId);
  const expectedUdcIdentifier = normalizedUdcIdentifier(
    row.ExpectedUdcIdentifier,
  );
  const profileUdcIdentifier = normalizedUdcIdentifier(
    row.ProfileUdcIdentifier,
  );
  const checkedUtc = exactString(row.CheckedUtc);
  const checkedMs = checkedUtc ? Date.parse(checkedUtc) : Number.NaN;

  if (
    !bannerId ||
    !bannerUserName ||
    !personId ||
    !expectedPersonId ||
    personId !== expectedPersonId ||
    !expectedUdcIdentifier ||
    !profileUdcIdentifier ||
    expectedUdcIdentifier !== profileUdcIdentifier ||
    !checkedUtc ||
    !Number.isFinite(checkedMs) ||
    nowMs - checkedMs > EUP_ACCEPTED_MANIFEST_MAX_AGE_MS ||
    checkedMs - nowMs > EUP_ACCEPTED_CLOCK_SKEW_MS ||
    row.UserNameVerified !== true ||
    row.IdentityLinkVerified !== true ||
    row.ExpectedUserNameSource !== "live_ethos_banner_username"
  ) {
    return null;
  }

  return {
    bannerId,
    bannerUserName,
    personId,
    expectedPersonId,
    expectedUdcIdentifier,
    profileUdcIdentifier,
    checkedUtc,
  };
}

/**
 * Joins the accepted-student observations to fresh Banner/Ethos verification.
 *
 * The verifier's exact bannerUserName is the sole login authority. Monitor
 * names, email addresses, Entra fields, and CanvasLogin remain observations and
 * are never transformed into or substituted for the issued username.
 */
export function buildEupAcceptedManifest(
  monitor: unknown,
  bannerVerification: unknown,
  now = new Date(),
): EupAcceptedManifest {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new EupAcceptedManifestUnavailableError("manifest clock is invalid");
  }
  const generatedUtc = requireGeneratedUtc(monitor, nowMs);
  const monitorRows = requireRows(monitor, "Students", "accepted monitor");
  const verificationRows = requireRows(
    bannerVerification,
    "Accounts",
    "Banner verification",
  );

  const verificationBannerIdCounts = countValues(
    verificationRows.map((row) => exactBannerId(row.BannerId)),
  );
  const userNameCounts = countValues(
    verificationRows.map((row) => exactBannerUserName(row.BannerUserName)),
  );
  const personIdCounts = countValues(
    verificationRows.map((row) => normalizedPersonId(row.PersonId)),
  );
  const udcIdentifierCounts = countValues(
    verificationRows.map((row) =>
      normalizedUdcIdentifier(row.ExpectedUdcIdentifier),
    ),
  );
  const identities = verificationRows
    .map((row) => verifiedIdentity(row, nowMs))
    .filter((value): value is VerifiedBannerIdentity => value !== null);
  const verifiedByBannerId = new Map(
    identities
      .filter(
        (value) =>
          hasOne(verificationBannerIdCounts, value.bannerId) &&
          hasOne(userNameCounts, value.bannerUserName) &&
          hasOne(personIdCounts, value.personId) &&
          hasOne(udcIdentifierCounts, value.expectedUdcIdentifier),
      )
      .map((value) => [value.bannerId, value]),
  );

  const eligibleMonitorRows = monitorRows.filter(
    (row) => row.Status !== "excluded_staff_identity",
  );
  const monitorBannerIdCounts = countValues(
    eligibleMonitorRows.map((row) => exactBannerId(row.BannerId)),
  );
  const monitorPersonIdCounts = countValues(
    eligibleMonitorRows.map((row) => normalizedPersonId(row.PersonId)),
  );
  const monitorUdcIdentifierCounts = countValues(
    eligibleMonitorRows.map((row) =>
      normalizedUdcIdentifier(row.UdcIdentifier),
    ),
  );

  const students: JsonRecord[] = [];
  for (const observation of eligibleMonitorRows) {
    const bannerId = exactBannerId(observation.BannerId);
    const monitorPersonId = normalizedPersonId(observation.PersonId);
    const monitorUdcIdentifier = normalizedUdcIdentifier(
      observation.UdcIdentifier,
    );
    if (
      !bannerId ||
      !monitorPersonId ||
      !monitorUdcIdentifier ||
      !hasOne(monitorBannerIdCounts, bannerId) ||
      !hasOne(monitorPersonIdCounts, monitorPersonId) ||
      !hasOne(monitorUdcIdentifierCounts, monitorUdcIdentifier)
    ) {
      continue;
    }
    const identity = verifiedByBannerId.get(bannerId);
    if (
      !identity ||
      identity.personId !== monitorPersonId ||
      identity.expectedUdcIdentifier !== monitorUdcIdentifier
    ) {
      continue;
    }

    const canvasLogin = exactString(observation.CanvasLogin);
    students.push({
      ...observation,
      BannerUserName: identity.bannerUserName,
      UserNameVerified: true,
      IdentityLinkVerified: true,
      PersonId: identity.personId,
      ExpectedPersonId: identity.expectedPersonId,
      UdcIdentifier: exactString(observation.UdcIdentifier),
      ExpectedUdcIdentifier: identity.expectedUdcIdentifier,
      ProfileUdcIdentifier: identity.profileUdcIdentifier,
      BannerIdentityCheckedUtc: identity.checkedUtc,
      CanvasLogin: canvasLogin,
    });
  }

  students.sort((left, right) =>
    String(right.DecidedOnUtc ?? "").localeCompare(
      String(left.DecidedOnUtc ?? ""),
    ),
  );

  if (eligibleMonitorRows.length > 0 && students.length === 0) {
    throw new EupAcceptedManifestUnavailableError(
      "no accepted row has fresh, unique Banner username and person/EID authority",
    );
  }

  return {
    schemaVersion: EUP_ACCEPTED_MANIFEST_SCHEMA_VERSION,
    authorityContract: EUP_ACCEPTED_MANIFEST_AUTHORITY_CONTRACT,
    generatedUtc,
    servedUtc: now.toISOString(),
    sourceCounts: {
      acceptedMonitorRows: monitorRows.length,
      bannerVerificationRows: verificationRows.length,
      usableRows: students.length,
      omittedAcceptedRows: eligibleMonitorRows.length - students.length,
    },
    students,
  };
}

/**
 * Signs the exact serialized response bytes and binds them to both the caller's
 * request timestamp and a fresh server timestamp.
 */
export function signEupAcceptedManifest(
  key: Buffer,
  requestTimestamp: string,
  responseTimestamp: string,
  manifest: EupAcceptedManifest,
): SignedEupAcceptedManifest {
  const body = JSON.stringify(manifest);
  const bodyBytes = Buffer.from(body, "utf8");
  const bodySha256 = createHash("sha256").update(bodyBytes).digest("hex");
  const canonical = [
    requestTimestamp,
    responseTimestamp,
    EUP_ACCEPTED_MANIFEST_RESPONSE_CONTEXT,
    bodySha256,
  ].join("\n");
  const signature = createHmac("sha256", key)
    .update(canonical, "utf8")
    .digest("hex");
  return { body, bodySha256, responseTimestamp, signature };
}
