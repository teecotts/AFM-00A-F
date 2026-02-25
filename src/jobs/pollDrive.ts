import { listNewVideoFiles } from "../lib/drive";
import { eventExistsForFile, insertEvent } from "../lib/supabase";
import { logger } from "../lib/logger";

export interface PollResult {
  filesFound: number;
  eventsCreated: number;
  skippedDuplicate: number;
  errors: string[];
}

/**
 * Run one poll iteration:
 * 1. List video files in the target Drive folder (last 7 days).
 * 2. For each file, check if a recording.uploaded event already exists (idempotency).
 * 3. If not, insert the event.
 */
export async function pollDrive(): Promise<PollResult> {
  const result: PollResult = {
    filesFound: 0,
    eventsCreated: 0,
    skippedDuplicate: 0,
    errors: [],
  };

  logger.info("Poll iteration starting");

  let files;
  try {
    files = await listNewVideoFiles();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to list Drive files", { error: msg });
    result.errors.push(`Drive listing failed: ${msg}`);
    return result;
  }

  result.filesFound = files.length;
  logger.info("Files found in Drive folder", { count: files.length });

  for (const file of files) {
    try {
      const exists = await eventExistsForFile(file.id);
      if (exists) {
        logger.debug("Skipping duplicate file", { fileId: file.id, name: file.name });
        result.skippedDuplicate++;
        continue;
      }

      await insertEvent("recording.uploaded", {
        file_id: file.id,
        file_name: file.name,
        created_time: file.createdTime,
        mime_type: file.mimeType,
        size: file.size,
      });

      result.eventsCreated++;
      logger.info("Created recording.uploaded event", {
        fileId: file.id,
        name: file.name,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Error processing file", { fileId: file.id, error: msg });
      result.errors.push(`File ${file.id}: ${msg}`);
    }
  }

  logger.info("Poll iteration complete", { ...result });
  return result;
}
