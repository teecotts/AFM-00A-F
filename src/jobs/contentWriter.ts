/**
 * Content Writer Dispatcher
 * Finds pending transcript.ready events and dispatches them to
 * all consumer agents in parallel:
 *   - Agent 00B (Video Processor: clips + chapters)
 *   - Agent 00C (Writer: LinkedIn + blog + social)
 *   - Agent 00D (Skool: community posts)
 *   - Agent 00F (Graphics: thumbnails + social graphics)
 *
 * Each agent manages its own consumer tracking via event_consumers,
 * so they don't block each other and can fail independently.
 */
import { findUnprocessedTranscriptEvents, EventRow } from "../lib/supabase";
import { logger } from "../lib/logger";
import { run as run00B } from "./agent_00B_video/index";
import { run as run00C } from "./agent_00C_writer/index";
import { run as run00D } from "./agent_00D_skool/index";
import { run as run00F } from "./agent_00F_graphics/index";

interface AgentStats {
  processed: number;
  items: number;
  errors: string[];
}

export interface ContentWriterResult {
  eventsFound: number;
  agent00B: AgentStats;
  agent00C: AgentStats;
  agent00D: AgentStats;
  agent00F: AgentStats;
}

const ALL_AGENT_IDS = ["00B", "00C", "00D", "00F"];

/**
 * Process one round of transcript.ready events.
 * All agents run in parallel per event.
 */
export async function processContentEvents(): Promise<ContentWriterResult> {
  const result: ContentWriterResult = {
    eventsFound: 0,
    agent00B: { processed: 0, items: 0, errors: [] },
    agent00C: { processed: 0, items: 0, errors: [] },
    agent00D: { processed: 0, items: 0, errors: [] },
    agent00F: { processed: 0, items: 0, errors: [] },
  };

  // Find events any agent hasn't processed yet
  const agentEventLists = await Promise.all(
    ALL_AGENT_IDS.map((id) => findUnprocessedTranscriptEvents(id))
  );

  // Deduplicate event IDs across all agents
  const eventMap = new Map<string, EventRow>();
  for (const list of agentEventLists) {
    for (const evt of list) {
      eventMap.set(evt.id, evt);
    }
  }

  const allEvents = Array.from(eventMap.values());
  result.eventsFound = allEvents.length;

  if (allEvents.length === 0) {
    logger.info("ContentWriter: no unprocessed transcript.ready events");
    return result;
  }

  logger.info("ContentWriter: dispatching events", { count: allEvents.length });

  for (const event of allEvents) {
    // Run all 4 agents in parallel for this event
    const [b, c, d, f] = await Promise.allSettled([
      run00B(event),
      run00C(event),
      run00D(event),
      run00F(event),
    ]);

    // Collect 00B results
    if (b.status === "fulfilled") {
      if (b.value.assetsCreated > 0 || !b.value.error) result.agent00B.processed++;
      result.agent00B.items += b.value.assetsCreated;
      if (b.value.error) result.agent00B.errors.push(b.value.error);
    } else {
      result.agent00B.errors.push(b.reason?.message || String(b.reason));
    }

    // Collect 00C results
    if (c.status === "fulfilled") {
      if (c.value.draftsCreated > 0 || !c.value.error) result.agent00C.processed++;
      result.agent00C.items += c.value.draftsCreated;
      if (c.value.error) result.agent00C.errors.push(c.value.error);
    } else {
      result.agent00C.errors.push(c.reason?.message || String(c.reason));
    }

    // Collect 00D results
    if (d.status === "fulfilled") {
      if (d.value.draftsCreated > 0 || !d.value.error) result.agent00D.processed++;
      result.agent00D.items += d.value.draftsCreated;
      if (d.value.error) result.agent00D.errors.push(d.value.error);
    } else {
      result.agent00D.errors.push(d.reason?.message || String(d.reason));
    }

    // Collect 00F results
    if (f.status === "fulfilled") {
      const fItems = f.value.thumbnailsCreated + f.value.graphicsCreated;
      if (fItems > 0 || !f.value.error) result.agent00F.processed++;
      result.agent00F.items += fItems;
      if (f.value.error) result.agent00F.errors.push(f.value.error);
    } else {
      result.agent00F.errors.push(f.reason?.message || String(f.reason));
    }
  }

  logger.info("ContentWriter: round complete", {
    eventsFound: result.eventsFound,
    agent00B: result.agent00B,
    agent00C: result.agent00C,
    agent00D: result.agent00D,
    agent00F: result.agent00F,
  });

  return result;
}
