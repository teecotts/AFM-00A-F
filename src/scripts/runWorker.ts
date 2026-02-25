/**
 * Local runner: processes transcription events on an interval.
 * Usage: npx tsx src/scripts/runWorker.ts
 */
import "dotenv/config";
import { processNextEvent } from "../jobs/transcribeWorker";
import { logger } from "../lib/logger";

const INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);

async function main() {
  logger.info("Transcription worker starting", { intervalMs: INTERVAL_MS });

  const tick = async () => {
    try {
      const result = await processNextEvent();

      if (result.processed) {
        logger.info("Worker tick: event processed", {
          eventId: result.eventId,
          transcriptId: result.transcriptId,
        });
      } else if (result.error) {
        logger.warn("Worker tick: event failed", {
          eventId: result.eventId,
          error: result.error,
        });
      } else {
        logger.debug("Worker tick: no events to process");
      }
    } catch (err) {
      logger.error("Worker tick unhandled error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
  logger.error("Worker fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
