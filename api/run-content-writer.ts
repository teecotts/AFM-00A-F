/**
 * Vercel API Route: GET /api/run-content-writer
 * Dispatches transcript.ready events to Agent 00C and 00D in parallel.
 * Designed to be called by Vercel Cron every 60 seconds.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { processContentEvents } from "../src/jobs/contentWriter";
import { logger } from "../src/lib/logger";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const result = await processContentEvents();

    logger.info("API run-content-writer complete", {
      eventsFound: result.eventsFound,
    });

    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("API run-content-writer error", { error: message });

    return res.status(500).json({
      ok: false,
      error: message,
    });
  }
}
