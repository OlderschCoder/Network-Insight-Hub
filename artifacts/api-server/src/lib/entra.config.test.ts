import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEntraConfig } from "./entra";

const KEYS = [
  "ENTRA_TENANT_ID",
  "ENTRA_CLIENT_ID",
  "ENTRA_CLIENT_SECRET",
  "ENTRA_REDIRECT_URI",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
] as const;

const REDIRECT = "https://hub.example.com/api/auth/entra/callback";

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getEntraConfig", () => {
  it("returns null without a redirect URI", () => {
    process.env.ENTRA_TENANT_ID = "t";
    process.env.ENTRA_CLIENT_ID = "c";
    process.env.ENTRA_CLIENT_SECRET = "s";
    expect(getEntraConfig()).toBeNull();
  });

  it("uses dedicated ENTRA_* credentials when the full set is present", () => {
    process.env.ENTRA_REDIRECT_URI = REDIRECT;
    process.env.ENTRA_TENANT_ID = "entra-tenant";
    process.env.ENTRA_CLIENT_ID = "entra-client";
    process.env.ENTRA_CLIENT_SECRET = "entra-secret";
    // AZURE_* present too, but ENTRA_* must win.
    process.env.AZURE_TENANT_ID = "azure-tenant";
    process.env.AZURE_CLIENT_ID = "azure-client";
    process.env.AZURE_CLIENT_SECRET = "azure-secret";
    expect(getEntraConfig()).toEqual({
      tenantId: "entra-tenant",
      clientId: "entra-client",
      clientSecret: "entra-secret",
      redirectUri: REDIRECT,
    });
  });

  it("falls back to the AZURE_* service-principal app when ENTRA_* is unset", () => {
    process.env.ENTRA_REDIRECT_URI = REDIRECT;
    process.env.AZURE_TENANT_ID = "azure-tenant";
    process.env.AZURE_CLIENT_ID = "azure-client";
    process.env.AZURE_CLIENT_SECRET = "azure-secret";
    expect(getEntraConfig()).toEqual({
      tenantId: "azure-tenant",
      clientId: "azure-client",
      clientSecret: "azure-secret",
      redirectUri: REDIRECT,
    });
  });

  it("never mixes sets: a partial ENTRA_* set falls back wholesale to AZURE_*", () => {
    process.env.ENTRA_REDIRECT_URI = REDIRECT;
    process.env.ENTRA_CLIENT_ID = "entra-client-only";
    process.env.AZURE_TENANT_ID = "azure-tenant";
    process.env.AZURE_CLIENT_ID = "azure-client";
    process.env.AZURE_CLIENT_SECRET = "azure-secret";
    expect(getEntraConfig()).toEqual({
      tenantId: "azure-tenant",
      clientId: "azure-client",
      clientSecret: "azure-secret",
      redirectUri: REDIRECT,
    });
  });

  it("returns null when neither credential set is complete", () => {
    process.env.ENTRA_REDIRECT_URI = REDIRECT;
    process.env.ENTRA_CLIENT_ID = "entra-client-only";
    process.env.AZURE_TENANT_ID = "azure-tenant-only";
    expect(getEntraConfig()).toBeNull();
  });
});
