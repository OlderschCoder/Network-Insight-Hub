import app from "./app";
import { logger } from "./lib/logger";
import { seedAppUsageKnowledge } from "./lib/seed_app_usage";
import { seedBreakGlassAccount, stripNonBreakGlassPasswords } from "./lib/seed_breakglass";
import { startSessionCleanup } from "./routes/auth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  void seedAppUsageKnowledge();
  // Seed the break-glass account first (flags it), then strip local passwords
  // from every other account so legacy credentials can't bypass Entra SSO.
  // A failed break-glass seed does NOT crash the server (degraded-but-flagged:
  // Entra SSO may still work); it is surfaced via a FATAL log banner and a
  // "degraded" /api/healthz response. See seed_breakglass.ts for rationale.
  void seedBreakGlassAccount().then((state) => {
    if (state === "failed") {
      logger.fatal(
        "Break-glass emergency login is NOT available — see the banner above and /api/healthz",
      );
    }
    return stripNonBreakGlassPasswords();
  });
  // Periodically purge expired persistent sessions.
  startSessionCleanup();
});
