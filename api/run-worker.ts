/**
 * Vercel API Route: GET /api/run-worker
 * Processes one pending transcription event.
 * Designed to be called by Vercel Cron every 60 seconds.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { processNextEvent } from "../src/jobs/transcribeWorker";
import { logger } from "../src/lib/logger";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const result = await processNextEvent();

    logger.info("API run-worker complete", { ...result });

    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("API run-worker error", { error: message });

    return res.status(500).json({
      ok: false,
      error: message,
    });
  }
}
