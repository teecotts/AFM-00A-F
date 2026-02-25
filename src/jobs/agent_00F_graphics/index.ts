import OpenAI from "openai";
import { logger } from "../../lib/logger";
import {
  getTranscriptById,
  isConsumerProcessed,
  markConsumerProcessing,
  markConsumerProcessed,
  markConsumerFailed,
  mediaAssetExists,
  insertMediaAsset,
  EventRow,
  TranscriptRow,
} from "../../lib/supabase";
import {
  VISUAL_SUMMARY_PROMPT,
  THUMBNAIL_PROMPT,
  SOCIAL_GRAPHICS_PROMPT,
  JSON_FIX_PROMPT,
} from "./prompts";
import type { ThumbnailConcept, SocialGraphic, VisualSummary } from "./types";

const AGENT_ID = "00F";
const LONG_TRANSCRIPT_THRESHOLD = 20_000;

function log(msg: string, data?: Record<string, unknown>) {
  logger.info(`[${AGENT_ID}] ${msg}`, data);
}
function logError(msg: string, data?: Record<string, unknown>) {
  logger.error(`[${AGENT_ID}] ${msg}`, data);
}
function logWarn(msg: string, data?: Record<string, unknown>) {
  logger.warn(`[${AGENT_ID}] ${msg}`, data);
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  return new OpenAI({ apiKey });
}

async function callGPT(prompt: string): Promise<string> {
  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 4096,
  });
  return response.choices[0]?.message?.content?.trim() || "";
}

async function parseWithRetry<T>(
  raw: string,
  schemaDescription: string
): Promise<T> {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    logWarn("JSON parse failed on first attempt, retrying with fix prompt", {
      rawLength: raw.length,
    });

    const fixPrompt = JSON_FIX_PROMPT
      .replace("{{SCHEMA}}", schemaDescription)
      .replace("{{TEXT}}", raw);

    const fixed = await callGPT(fixPrompt);
    let fixedCleaned = fixed.trim();
    if (fixedCleaned.startsWith("```")) {
      fixedCleaned = fixedCleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    return JSON.parse(fixedCleaned) as T;
  }
}

async function getContentInput(transcript: TranscriptRow): Promise<string> {
  const text = transcript.transcript;

  if (text.length <= LONG_TRANSCRIPT_THRESHOLD) {
    return text;
  }

  log("Transcript too long, generating visual summary first", {
    transcriptId: transcript.id,
    charCount: text.length,
  });

  const prompt = VISUAL_SUMMARY_PROMPT.replace("{{TRANSCRIPT}}", text);
  const raw = await callGPT(prompt);
  const summary = await parseWithRetry<VisualSummary>(
    raw,
    '{ "core_message": "...", "key_moments": [...], "high_emotion_sections": [...], "contrarian_statements": [...] }'
  );

  return JSON.stringify(summary, null, 2);
}

export interface Agent00FResult {
  eventId: string;
  transcriptId: string;
  thumbnailsCreated: number;
  graphicsCreated: number;
  skippedDuplicate: number;
  error: string | null;
}

/**
 * Main entry point: process a transcript.ready event.
 */
export async function run(event: EventRow): Promise<Agent00FResult> {
  const result: Agent00FResult = {
    eventId: event.id,
    transcriptId: "",
    thumbnailsCreated: 0,
    graphicsCreated: 0,
    skippedDuplicate: 0,
    error: null,
  };

  const payload = event.payload as {
    transcript_id: string;
    file_id?: string;
    file_name?: string;
  };
  result.transcriptId = payload.transcript_id;

  log("Processing event", {
    eventId: event.id,
    transcriptId: payload.transcript_id,
  });

  try {
    const alreadyDone = await isConsumerProcessed(event.id, AGENT_ID);
    if (alreadyDone) {
      log("Event already processed by this agent, skipping", { eventId: event.id });
      return result;
    }

    await markConsumerProcessing(event.id, AGENT_ID);

    const transcript = await getTranscriptById(payload.transcript_id);
    if (!transcript) {
      throw new Error(`Transcript not found: ${payload.transcript_id}`);
    }

    log("Transcript fetched", {
      transcriptId: transcript.id,
      charCount: transcript.transcript.length,
    });

    const contentInput = await getContentInput(transcript);

    // ---- Generate Thumbnail Concepts ----
    if (!(await mediaAssetExists(transcript.id, AGENT_ID, "thumbnail"))) {
      log("Generating thumbnail concepts");
      const prompt = THUMBNAIL_PROMPT.replace("{{CONTENT}}", contentInput);
      const raw = await callGPT(prompt);
      const thumbnails = await parseWithRetry<ThumbnailConcept[]>(
        raw,
        '[{ "headline": "...", "subtext": "...", "emotion": "...", "visual_direction": "...", "color_notes": "...", "why_it_works": "..." }]'
      );

      for (let i = 0; i < thumbnails.length; i++) {
        await insertMediaAsset({
          transcript_id: transcript.id,
          agent_id: AGENT_ID,
          type: "thumbnail",
          content: { ...thumbnails[i], index: i },
        });
        result.thumbnailsCreated++;
      }
      log("Thumbnails created", { count: thumbnails.length });
    } else {
      result.skippedDuplicate++;
      log("Thumbnails already exist, skipping");
    }

    // ---- Generate Social Graphics ----
    if (!(await mediaAssetExists(transcript.id, AGENT_ID, "graphic"))) {
      log("Generating social graphic concepts");
      const prompt = SOCIAL_GRAPHICS_PROMPT.replace("{{CONTENT}}", contentInput);
      const raw = await callGPT(prompt);
      const graphics = await parseWithRetry<SocialGraphic[]>(
        raw,
        '[{ "type": "quote_card|stat_card|insight_card", "text": "...", "visual_direction": "...", "platform": "linkedin|instagram", "why_it_works": "..." }]'
      );

      for (let i = 0; i < graphics.length; i++) {
        await insertMediaAsset({
          transcript_id: transcript.id,
          agent_id: AGENT_ID,
          type: "graphic",
          content: { ...graphics[i], index: i },
        });
        result.graphicsCreated++;
      }
      log("Graphics created", { count: graphics.length });
    } else {
      result.skippedDuplicate++;
      log("Graphics already exist, skipping");
    }

    await markConsumerProcessed(event.id, AGENT_ID);

    log("Event processing complete", {
      eventId: event.id,
      thumbnailsCreated: result.thumbnailsCreated,
      graphicsCreated: result.graphicsCreated,
      skippedDuplicate: result.skippedDuplicate,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("Processing failed", { eventId: event.id, error: msg });
    result.error = msg;

    try {
      await markConsumerFailed(event.id, AGENT_ID, {
        message: msg,
        raw: err instanceof Error ? err.stack : undefined,
      });
    } catch (failErr) {
      logError("Failed to mark consumer as failed", {
        error: failErr instanceof Error ? failErr.message : String(failErr),
      });
    }
  }

  return result;
}
