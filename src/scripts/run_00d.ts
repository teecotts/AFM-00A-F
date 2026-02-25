/**
 * Dev harness for Agent 00D (Skool Writer).
 *
 * Usage:
 *   npx tsx src/scripts/run_00d.ts
 *
 * With a specific transcript ID:
 *   TRANSCRIPT_ID=abc-123 npx tsx src/scripts/run_00d.ts
 *
 * Or pass as CLI arg:
 *   npx tsx src/scripts/run_00d.ts abc-123
 */
import "dotenv/config";
import { logger } from "../lib/logger";
import { run as run00D } from "../jobs/agent_00D_skool/index";
import { runAll } from "../jobs/agent_00D_skool/run";
import { insertEvent } from "../lib/supabase";

async function main() {
  const transcriptId = process.argv[2] || process.env.TRANSCRIPT_ID;

  if (transcriptId) {
    logger.info("[00D] Running with specific transcript", { transcriptId });

    const event = await insertEvent("transcript.ready", {
      transcript_id: transcriptId,
      file_id: "manual-run",
      file_name: "manual-run",
    });
    const result = await run00D(event);

    logger.info("[00D] Manual run complete", { ...result });
  } else {
    logger.info("[00D] Running against all unprocessed events");
    const result = await runAll();
    logger.info("[00D] Run complete", { ...result });
  }
}

main().catch((err) => {
  logger.error("[00D] Fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
