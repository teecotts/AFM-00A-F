/**
 * Agent 00A Worker — Foldered entry point
 *
 * Claims pending `recording.uploaded` events, downloads the file from
 * Google Drive, transcribes via Whisper, stores the transcript,
 * and enqueues a `transcript.ready` event for downstream agents.
 *
 * Usage (single cycle):
 *   npx tsx agents/00A/worker.ts
 *
 * Usage (poll loop):
 *   npx tsx agents/00A/worker.ts --poll
 */
import "dotenv/config";
import * as fs from "fs";
import { validateSupabaseEnv } from "../../src/lib/supabase";
import { insertTranscript } from "../../src/lib/supabase";
import { enqueueEvent, claimNextEvent, markDone, markFailed } from "../../src/lib/eventQueue";
import { downloadFile, getFileMetadata } from "../../src/lib/drive";
import { transcribeFile } from "../../src/lib/openai";
import { logger } from "../../src/lib/logger";

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_BYTES || "209715200", 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);

/**
 * Placeholder transcription function.
 * In production this calls Whisper; override for testing.
 */
async function transcribeRecording(payload: {
  file_id: string;
  file_name: string;
}): Promise<{ transcriptText: string; tmpPath: string }> {
  // Check file size
  const meta = await getFileMetadata(payload.file_id);
  if (meta.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${meta.size} bytes (max ${MAX_FILE_SIZE})`);
  }

  // Download from Drive
  const tmpPath = await downloadFile(payload.file_id, payload.file_name);

  // Transcribe with Whisper
  const transcriptText = await transcribeFile(tmpPath);

  return { transcriptText, tmpPath };
}

/**
 * Process one recording.uploaded event (single cycle).
 */
export async function processOne(): Promise<{
  processed: boolean;
  eventId: string | null;
  transcriptId: string | null;
  error: string | null;
}> {
  const result = {
    processed: false,
    eventId: null as string | null,
    transcriptId: null as string | null,
    error: null as string | null,
  };

  // Claim next pending recording.uploaded event
  const event = await claimNextEvent("recording.uploaded");
  if (!event) {
    logger.info("[00A] No pending events to process");
    return result;
  }

  result.eventId = event.id;
  const payload = event.payload as {
    file_id: string;
    file_name: string;
    created_time?: string;
  };

  let tmpPath: string | null = null;

  try {
    logger.info("[00A] Processing event", { eventId: event.id, fileId: payload.file_id });

    // Transcribe
    const output = await transcribeRecording(payload);
    tmpPath = output.tmpPath;

    // Store transcript
    const transcript = await insertTranscript(
      payload.file_id,
      payload.file_name,
      output.transcriptText
    );
    result.transcriptId = transcript.id;

    // Enqueue transcript.ready with dedupe_key
    await enqueueEvent(
      "transcript.ready",
      {
        transcript_id: transcript.id,
        file_id: payload.file_id,
        file_name: payload.file_name,
      },
      `transcript.ready:${transcript.id}`
    );

    // Mark original event done
    await markDone(event.id);
    result.processed = true;

    logger.info("[00A] Event processed successfully", {
      eventId: event.id,
      transcriptId: transcript.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[00A] Processing failed", {
      eventId: event.id,
      error: msg,
      stack: err instanceof Error ? err.stack : undefined,
    });
    result.error = msg;

    try {
      await markFailed(event.id, msg);
    } catch (failErr) {
      logger.error("[00A] Failed to mark event as failed", {
        eventId: event.id,
        error: failErr instanceof Error ? failErr.message : String(failErr),
      });
    }
  } finally {
    // Clean up temp file
    if (tmpPath) {
      try {
        fs.unlinkSync(tmpPath);
        logger.debug("[00A] Temp file cleaned up", { tmpPath });
      } catch {
        logger.warn("[00A] Failed to clean up temp file", { tmpPath });
      }
    }
  }

  return result;
}

// ---- CLI entry point ----
async function main() {
  validateSupabaseEnv();

  const isPoll = process.argv.includes("--poll");

  if (isPoll) {
    logger.info("[00A] Starting poll loop", { intervalMs: POLL_INTERVAL_MS });

    const tick = async () => {
      try {
        await processOne();
      } catch (err) {
        logger.error("[00A] Poll tick error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    await tick();
    setInterval(tick, POLL_INTERVAL_MS);
  } else {
    logger.info("[00A] Running single cycle");
    const result = await processOne();
    logger.info("[00A] Done", { ...result });

    if (!result.processed && !result.error) {
      logger.info("[00A] No events found — nothing to do");
    }
  }
}

main().catch((err) => {
  logger.error("[00A] Fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
