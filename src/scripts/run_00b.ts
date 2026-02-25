/**
 * Dev harness for Agent 00B (Video Processor).
 *
 * Usage:
 *   npx tsx src/scripts/run_00b.ts
 *
 * With a specific transcript ID:
 *   TRANSCRIPT_ID=abc-123 npx tsx src/scripts/run_00b.ts
 *
 * Or pass as CLI arg:
 *   npx tsx src/scripts/run_00b.ts abc-123
 */
import "dotenv/config";
import { logger } from "../lib/logger";
import { run as run00B } from "../jobs/agent_00B_video/index";
import { runAll } from "../jobs/agent_00B_video/run";
import { insertEvent, EventRow } from "../lib/supabase";

async function main() {
  const transcriptId = process.argv[2] || process.env.TRANSCRIPT_ID;

  if (transcriptId) {
    logger.info("[00B] Running with specific transcript", { transcriptId });

    const event = await insertEvent("transcript.ready", {
      transcript_id: transcriptId,
      file_id: "manual-run",
      file_name: "manual-run",
    });
    const result = await run00B(event);

    logger.info("[00B] Manual run complete", { ...result });
  } else {
    logger.info("[00B] Running against all unprocessed events");
    const result = await runAll();
    logger.info("[00B] Run complete", { ...result });
  }
}

main().catch((err) => {
  logger.error("[00B] Fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
