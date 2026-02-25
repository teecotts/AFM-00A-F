/**
 * Agent 00D runner: finds unprocessed transcript.ready events
 * and generates Skool community posts.
 */
import { findUnprocessedTranscriptEvents } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import { run as runAgent } from "./index";

export interface Agent00DRunResult {
  eventsProcessed: number;
  totalDraftsCreated: number;
  errors: string[];
}

export async function runAll(): Promise<Agent00DRunResult> {
  const result: Agent00DRunResult = {
    eventsProcessed: 0,
    totalDraftsCreated: 0,
    errors: [],
  };

  logger.info("[00D] Looking for unprocessed transcript.ready events");

  const events = await findUnprocessedTranscriptEvents("00D");

  if (events.length === 0) {
    logger.info("[00D] No unprocessed events found");
    return result;
  }

  logger.info("[00D] Found unprocessed events", { count: events.length });

  for (const event of events) {
    try {
      const agentResult = await runAgent(event);
      result.eventsProcessed++;
      result.totalDraftsCreated += agentResult.draftsCreated;

      if (agentResult.error) {
        result.errors.push(agentResult.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[00D] Unhandled error processing event", {
        eventId: event.id,
        error: msg,
      });
      result.errors.push(`Event ${event.id}: ${msg}`);
    }
  }

  logger.info("[00D] Run complete", { ...result });
  return result;
}
