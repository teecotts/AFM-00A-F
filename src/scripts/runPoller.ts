/**
 * Local runner: polls Google Drive on an interval.
 * Usage: npx tsx src/scripts/runPoller.ts
 */
import "dotenv/config";
import { pollDrive } from "../jobs/pollDrive";
import { logger } from "../lib/logger";

const INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);

async function main() {
  logger.info("Drive poller starting", { intervalMs: INTERVAL_MS });

  // Run immediately on start, then on interval
  const tick = async () => {
    try {
      const result = await pollDrive();
      logger.info("Poll tick complete", { ...result });
    } catch (err) {
      logger.error("Poll tick unhandled error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
  logger.error("Poller fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
