/**
 * Agent 00B runner: finds unprocessed transcript.ready events
 * and generates chapter markers + clip suggestions.
 */
import { findUnprocessedTranscriptEvents } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import { run as runAgent } from "./index";

export interface Agent00BRunResult {
  eventsProcessed: number;
  totalAssetsCreated: number;
  errors: string[];
}

export async function runAll(): Promise<Agent00BRunResult> {
  const result: Agent00BRunResult = {
    eventsProcessed: 0,
    totalAssetsCreated: 0,
    errors: [],
  };

  logger.info("[00B] Looking for unprocessed transcript.ready events");

  const events = await findUnprocessedTranscriptEvents("00B");

  if (events.length === 0) {
    logger.info("[00B] No unprocessed events found");
    return result;
  }

  logger.info("[00B] Found unprocessed events", { count: events.length });

  for (const event of events) {
    try {
      const agentResult = await runAgent(event);
      result.eventsProcessed++;
      result.totalAssetsCreated += agentResult.assetsCreated;

      if (agentResult.error) {
        result.errors.push(agentResult.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[00B] Unhandled error processing event", {
        eventId: event.id,
        error: msg,
      });
      result.errors.push(`Event ${event.id}: ${msg}`);
    }
  }

  logger.info("[00B] Run complete", { ...result });
  return result;
}
