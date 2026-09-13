import express, {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  FredTelnyxWebhookError,
  processFredTelnyxWebhook,
  type FredTelnyxWebhookStore,
} from "../lib/fred_telnyx_webhook";
import { fredTelnyxWebhookStore } from "../lib/fred_telnyx_webhook_store";

type RawBodyRequest = Request & { rawBody?: Buffer };

interface FredTelnyxRouterOptions {
  store?: FredTelnyxWebhookStore;
  getPublicKey?: () => string | undefined;
  now?: () => Date;
  processingDeadlineMs?: number;
}

async function withinWebhookDeadline<T>(
  work: Promise<T>,
  deadlineMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new FredTelnyxWebhookError(
          "webhook_processing_timeout",
          503,
          "Telnyx event processing should be retried",
        ),
      );
    }, deadlineMs);
    timer.unref();
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createFredTelnyxRouter(
  options: FredTelnyxRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const store = options.store ?? fredTelnyxWebhookStore;
  const getPublicKey =
    options.getPublicKey ?? (() => process.env.FRED_TELNYX_PUBLIC_KEY);
  const now = options.now ?? (() => new Date());
  const processingDeadlineMs = options.processingDeadlineMs ?? 1_500;

  const receiveStatus = async (req: RawBodyRequest, res: Response) => {
    try {
      const result = await withinWebhookDeadline(
        processFredTelnyxWebhook({
          rawBody: Buffer.isBuffer(req.body)
            ? req.body
            : (req.rawBody ?? Buffer.alloc(0)),
          signature: req.get("telnyx-signature-ed25519") ?? undefined,
          timestamp: req.get("telnyx-timestamp") ?? undefined,
          publicKey: getPublicKey(),
          store,
          now: now(),
        }),
        processingDeadlineMs,
      );
      res.status(200).json({
        received: true,
        duplicate: result.duplicate,
        matchedDelivery: result.matchedDelivery,
      });
    } catch (error) {
      if (error instanceof FredTelnyxWebhookError) {
        if (error.httpStatus >= 500) {
          req.log?.error(
            { errorCode: error.code },
            "Fred Telnyx status webhook needs retry",
          );
        } else {
          req.log?.warn(
            { errorCode: error.code },
            "Fred Telnyx status webhook rejected",
          );
        }
        res.status(error.httpStatus).json({ error: error.code });
        return;
      }

      // Do not serialize or log the database error: driver errors may include
      // request-bound values. A 503 prompts Telnyx to retry the signed event.
      req.log?.error(
        { errorCode: "webhook_persistence_failed" },
        "Fred Telnyx status webhook could not be persisted",
      );
      res.status(503).json({ error: "webhook_persistence_failed" });
    }
  };

  const rawJsonBody = express.raw({ type: "application/json", limit: "256kb" });
  router.post("/status", rawJsonBody, receiveStatus);
  router.post("/status/failover", rawJsonBody, receiveStatus);
  return router;
}

export default createFredTelnyxRouter();
