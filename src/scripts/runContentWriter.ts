/**
 * Local runner: processes transcript.ready events on an interval,
 * dispatching to Agents 00B, 00C, 00D, 00F in parallel.
 * Usage: npx tsx src/scripts/runContentWriter.ts
 */
import "dotenv/config";
import { processContentEvents } from "../jobs/contentWriter";
import { logger } from "../lib/logger";

const INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);

async function main() {
  logger.info("Content writer starting", { intervalMs: INTERVAL_MS });

  const tick = async () => {
    try {
      const result = await processContentEvents();

      if (result.eventsFound > 0) {
        logger.info("Content writer tick: events processed", {
          eventsFound: result.eventsFound,
          agent00B_items: result.agent00B.items,
          agent00C_items: result.agent00C.items,
          agent00D_items: result.agent00D.items,
          agent00F_items: result.agent00F.items,
        });
      } else {
        logger.debug("Content writer tick: no events to process");
      }
    } catch (err) {
      logger.error("Content writer tick unhandled error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
  logger.error("Content writer fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
