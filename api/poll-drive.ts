/**
 * Vercel API Route: GET /api/poll-drive
 * Runs one poll iteration against Google Drive.
 * Triggerable via HTTP GET/POST. Schedule externally (Upstash, GitHub Actions, etc.).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { pollDrive } from "../src/jobs/pollDrive";
import { logger } from "../src/lib/logger";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const result = await pollDrive();

    logger.info("API poll-drive complete", { ...result });

    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("API poll-drive error", { error: message });

    return res.status(500).json({
      ok: false,
      error: message,
    });
  }
}
