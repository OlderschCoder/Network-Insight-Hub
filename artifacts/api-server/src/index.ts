import app from "./app";
import { logger } from "./lib/logger";
import { seedAppUsageKnowledge } from "./lib/seed_app_usage";
import { seedBreakGlassAccount, stripNonBreakGlassPasswords } from "./lib/seed_breakglass";

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
  void seedBreakGlassAccount().then(() => stripNonBreakGlassPasswords());
});
