import * as fs from "fs";
import {
  claimNextPendingEvent,
  markEventCompleted,
  markEventFailed,
  insertTranscript,
  insertEvent,
  EventRow,
} from "../lib/supabase";
import { downloadFile, getFileMetadata } from "../lib/drive";
import { transcribeFile } from "../lib/openai";
import { logger } from "../lib/logger";

export interface WorkerResult {
  processed: boolean;
  eventId: string | null;
  fileId: string | null;
  transcriptId: string | null;
  error: string | null;
}

const MAX_FILE_SIZE = parseInt(
  process.env.MAX_FILE_SIZE_BYTES || "209715200",
  10
); // 200MB

/**
 * Process one pending recording.uploaded event:
 * 1. Claim the next pending event (atomic).
 * 2. Check file size; fail if > 200MB.
 * 3. Download file from Google Drive to /tmp.
 * 4. Transcribe with Whisper.
 * 5. Store transcript in Supabase.
 * 6. Emit transcript.ready event.
 * 7. Mark original event as completed.
 * 8. Clean up temp file.
 */
export async function processNextEvent(): Promise<WorkerResult> {
  const result: WorkerResult = {
    processed: false,
    eventId: null,
    fileId: null,
    transcriptId: null,
    error: null,
  };

  // Step 1: Claim
  let event: EventRow | null;
  try {
    event = await claimNextPendingEvent("recording.uploaded");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to claim event", { error: msg });
    result.error = msg;
    return result;
  }

  if (!event) {
    logger.info("No pending events to process");
    return result;
  }

  result.eventId = event.id;
  const payload = event.payload as {
    file_id: string;
    file_name: string;
    created_time: string;
    size?: string;
  };
  result.fileId = payload.file_id;

  let tmpPath: string | null = null;

  try {
    // Step 2: Check file size
    logger.info("Checking file metadata", { fileId: payload.file_id });
    const meta = await getFileMetadata(payload.file_id);

    if (meta.size > MAX_FILE_SIZE) {
      const errMsg = `File too large: ${meta.size} bytes (max ${MAX_FILE_SIZE}). Chunking not yet supported.`;
      logger.error(errMsg, { fileId: payload.file_id, size: meta.size });
      await markEventFailed(event.id, errMsg, event.attempt_count);
      result.error = errMsg;
      return result;
    }

    // Step 3: Download
    tmpPath = await downloadFile(payload.file_id, payload.file_name);

    // Step 4: Transcribe
    const transcriptText = await transcribeFile(tmpPath);

    // Step 5: Store transcript
    const transcript = await insertTranscript(
      payload.file_id,
      payload.file_name,
      transcriptText
    );
    result.transcriptId = transcript.id;

    // Step 6: Emit transcript.ready
    await insertEvent("transcript.ready", {
      transcript_id: transcript.id,
      file_id: payload.file_id,
      file_name: payload.file_name,
    });

    // Step 7: Mark completed
    await markEventCompleted(event.id);
    result.processed = true;

    logger.info("Event processed successfully", {
      eventId: event.id,
      fileId: payload.file_id,
      transcriptId: transcript.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Worker error processing event", {
      eventId: event.id,
      fileId: payload.file_id,
      error: msg,
    });
    result.error = msg;

    try {
      await markEventFailed(event.id, msg, event.attempt_count);
    } catch (failErr) {
      logger.error("Failed to mark event as failed", {
        eventId: event.id,
        error: failErr instanceof Error ? failErr.message : String(failErr),
      });
    }
  } finally {
    // Step 8: Clean up temp file
    if (tmpPath) {
      try {
        fs.unlinkSync(tmpPath);
        logger.debug("Temp file cleaned up", { tmpPath });
      } catch {
        logger.warn("Failed to clean up temp file", { tmpPath });
      }
    }
  }

  return result;
}
