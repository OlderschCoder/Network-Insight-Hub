import { pool } from "@workspace/db";
import { sendFredTestAlert } from "../lib/fred_building_alert_worker";

async function main() {
  const results = await sendFredTestAlert();
  for (const result of results) {
    if (result.status === "accepted") {
      console.log(
        `${result.recipientToken}: accepted (${result.providerStatus ?? "accepted"})`,
      );
    } else {
      console.error(
        `${result.recipientToken}: failed (${result.errorCode ?? "unknown"})`,
      );
    }
  }
  if (
    results.length === 0 ||
    results.some((result) => result.status !== "accepted")
  ) {
    process.exitCode = 1;
  }
}

void main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Fred test alert failed.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
