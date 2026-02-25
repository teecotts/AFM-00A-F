/**
 * Agent 00F runner: finds unprocessed transcript.ready events
 * and generates thumbnail + social graphic concepts.
 */
import { findUnprocessedTranscriptEvents } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import { run as runAgent } from "./index";

export interface Agent00FRunResult {
  eventsProcessed: number;
  totalAssetsCreated: number;
  errors: string[];
}

export async function runAll(): Promise<Agent00FRunResult> {
  const result: Agent00FRunResult = {
    eventsProcessed: 0,
    totalAssetsCreated: 0,
    errors: [],
  };

  logger.info("[00F] Looking for unprocessed transcript.ready events");

  const events = await findUnprocessedTranscriptEvents("00F");

  if (events.length === 0) {
    logger.info("[00F] No unprocessed events found");
    return result;
  }

  logger.info("[00F] Found unprocessed events", { count: events.length });

  for (const event of events) {
    try {
      const agentResult = await runAgent(event);
      result.eventsProcessed++;
      result.totalAssetsCreated += agentResult.thumbnailsCreated + agentResult.graphicsCreated;

      if (agentResult.error) {
        result.errors.push(agentResult.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[00F] Unhandled error processing event", {
        eventId: event.id,
        error: msg,
      });
      result.errors.push(`Event ${event.id}: ${msg}`);
    }
  }

  logger.info("[00F] Run complete", { ...result });
  return result;
}
