/**
 * Dev harness for Agent 00C (Writer).
 *
 * Usage:
 *   npx tsx src/scripts/run_00c.ts
 *
 * With a specific transcript ID:
 *   TRANSCRIPT_ID=abc-123 npx tsx src/scripts/run_00c.ts
 *
 * Or pass as CLI arg:
 *   npx tsx src/scripts/run_00c.ts abc-123
 */
import "dotenv/config";
import { logger } from "../lib/logger";
import { run as run00C } from "../jobs/agent_00C_writer/index";
import { runAll } from "../jobs/agent_00C_writer/run";
import { insertEvent } from "../lib/supabase";

async function main() {
  const transcriptId = process.argv[2] || process.env.TRANSCRIPT_ID;

  if (transcriptId) {
    // Run with a specific transcript — create a mock event
    logger.info("[00C] Running with specific transcript", { transcriptId });

    const event = await insertEvent("transcript.ready", {
      transcript_id: transcriptId,
      file_id: "manual-run",
      file_name: "manual-run",
    });
    const result = await run00C(event);

    logger.info("[00C] Manual run complete", { ...result });
  } else {
    // Run against all unprocessed events
    logger.info("[00C] Running against all unprocessed events");
    const result = await runAll();
    logger.info("[00C] Run complete", { ...result });
  }
}

main().catch((err) => {
  logger.error("[00C] Fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
