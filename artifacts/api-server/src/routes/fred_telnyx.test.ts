import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: {} }));

import { createFredTelnyxRouter } from "./fred_telnyx";
import type { FredTelnyxWebhookStore } from "../lib/fred_telnyx_webhook";

const now = new Date("2026-09-13T12:00:00.000Z");
const timestamp = String(Math.floor(now.getTime() / 1000));
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = publicKey
  .export({ format: "pem", type: "spki" })
  .toString();

function makeRequestBody(): Buffer {
  return Buffer.from(
    JSON.stringify({
      data: {
        id: "event-route-1",
        event_type: "message.finalized",
        occurred_at: "2026-09-13T11:59:58.000Z",
        payload: {
          id: "message-route-1",
          to: [{ status: "delivered" }],
        },
      },
    }),
  );
}

function signature(rawBody: Buffer): string {
  return crypto
    .sign(
      null,
      Buffer.concat([Buffer.from(`${timestamp}|`), rawBody]),
      privateKey,
    )
    .toString("base64");
}

function makeApp(
  store: FredTelnyxWebhookStore,
  options: { processingDeadlineMs?: number } = {},
) {
  const app = express();
  app.use((req: any, _res, next) => {
    req.log = { error() {}, warn() {} };
    next();
  });
  app.use(
    "/api/telnyx/fred",
    createFredTelnyxRouter({
      store,
      getPublicKey: () => publicKeyPem,
      now: () => now,
      processingDeadlineMs: options.processingDeadlineMs,
    }),
  );
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.status ?? 500).json({ error: "request_rejected" });
  });
  return app;
}

describe("Fred Telnyx status routes", () => {
  it.each(["/api/telnyx/fred/status", "/api/telnyx/fred/status/failover"])(
    "accepts a signed delivery event at %s",
    async (path) => {
      const rawBody = makeRequestBody();
      const record = vi.fn().mockResolvedValue({
        duplicate: false,
        matchedDelivery: true,
      });
      const response = await request(makeApp({ record }))
        .post(path)
        .set("Content-Type", "application/json")
        .set("telnyx-timestamp", timestamp)
        .set("telnyx-signature-ed25519", signature(rawBody))
        .send(rawBody.toString("utf8"));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        received: true,
        duplicate: false,
        matchedDelivery: true,
      });
      expect(record).toHaveBeenCalledOnce();
    },
  );

  it("rejects an invalid signature before touching durable storage", async () => {
    const rawBody = makeRequestBody();
    const record = vi.fn();
    const response = await request(makeApp({ record }))
      .post("/api/telnyx/fred/status")
      .set("Content-Type", "application/json")
      .set("telnyx-timestamp", timestamp)
      .set("telnyx-signature-ed25519", Buffer.alloc(64).toString("base64"))
      .send(rawBody.toString("utf8"));

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "signature_invalid" });
    expect(record).not.toHaveBeenCalled();
  });

  it("returns a retryable response before Telnyx's two-second deadline", async () => {
    const rawBody = makeRequestBody();
    const record = vi.fn(() => new Promise<never>(() => undefined));
    const response = await request(
      makeApp({ record }, { processingDeadlineMs: 10 }),
    )
      .post("/api/telnyx/fred/status")
      .set("Content-Type", "application/json")
      .set("telnyx-timestamp", timestamp)
      .set("telnyx-signature-ed25519", signature(rawBody))
      .send(rawBody.toString("utf8"));

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "webhook_processing_timeout" });
  });

  it("rejects JSON bodies larger than the route-local 256 KB limit", async () => {
    const oversizedBody = JSON.stringify({ padding: "x".repeat(256 * 1024) });
    const response = await request(makeApp({ record: vi.fn() }))
      .post("/api/telnyx/fred/status")
      .set("Content-Type", "application/json")
      .send(oversizedBody);

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: "request_rejected" });
  });
});
