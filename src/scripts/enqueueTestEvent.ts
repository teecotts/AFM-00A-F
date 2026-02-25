/**
 * Dev utility: Insert a sample recording.uploaded event into Supabase.
 *
 * Usage:
 *   npx tsx src/scripts/enqueueTestEvent.ts
 *
 * Or with a custom file_id:
 *   npx tsx src/scripts/enqueueTestEvent.ts my-file-id-123
 */
import "dotenv/config";
import { validateSupabaseEnv } from "../lib/supabase";
import { enqueueEvent } from "../lib/eventQueue";
import { logger } from "../lib/logger";

async function main() {
  validateSupabaseEnv();

  const fileId = process.argv[2] || `test-file-${Date.now()}`;

  logger.info("Enqueuing test recording.uploaded event", { fileId });

  const event = await enqueueEvent(
    "recording.uploaded",
    {
      file_id: fileId,
      file_name: `test-recording-${fileId}.mp4`,
      created_time: new Date().toISOString(),
      size: "5242880", // 5MB
    },
    `recording.uploaded:${fileId}`
  );

  logger.info("Test event enqueued successfully", {
    eventId: event.id,
    type: event.type,
    dedupeKey: event.dedupe_key,
    status: event.status,
  });

  console.log(`\nEvent ID: ${event.id}`);
  console.log(`Type:     ${event.type}`);
  console.log(`Status:   ${event.status}`);
  console.log(`\nRun Agent 00A to process it:`);
  console.log(`  npm run dev:00A`);
}

main().catch((err) => {
  logger.error("enqueueTestEvent failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
