import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, usersTable: {}, sessionsTable: {} }));
import authRouter from "./auth";

const app = express().use(authRouter);
beforeEach(() => {
  vi.stubEnv("ENTRA_TENANT_ID", "fixture-tenant");
  vi.stubEnv("ENTRA_CLIENT_ID", "fixture-client");
  vi.stubEnv("ENTRA_CLIENT_SECRET", "fixture-secret-never-public");
  vi.stubEnv("ENTRA_ALLOWED_GROUP_IDS", "fixture-it-group");
});
afterEach(() => vi.unstubAllEnvs());

describe("public canonical SSO metadata", () => {
  it("returns only the existing registered HTTPS callback origin alongside availability", async () => {
    vi.stubEnv("ENTRA_REDIRECT_URI", "https://app-server2.centralus.cloudapp.azure.com/api/auth/entra/callback");
    const response = await request(app).get("/entra/status");
    expect(response.body).toEqual({ configured: true, loginOrigin: "https://app-server2.centralus.cloudapp.azure.com" });
    expect(JSON.stringify(response.body)).not.toContain("fixture-secret");
  });
  it.each(["http://canonical.invalid/api/auth/entra/callback", "https://user:pass@canonical.invalid/api/auth/entra/callback", "https://canonical.invalid/other", "https://canonical.invalid/api/auth/entra/callback?next=https://evil.invalid", "https://canonical.invalid/api/auth/entra/callback#fragment"])("does not expose an unsafe canonical destination: %s", async redirectUri => {
    vi.stubEnv("ENTRA_REDIRECT_URI", redirectUri);
    const response = await request(app).get("/entra/status");
    expect(response.body.loginOrigin).toBeNull();
  });
});
