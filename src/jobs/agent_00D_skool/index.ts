import OpenAI from "openai";
import { logger } from "../../lib/logger";
import {
  getTranscriptById,
  isConsumerProcessed,
  markConsumerProcessing,
  markConsumerProcessed,
  markConsumerFailed,
  contentDraftExists,
  insertContentDraft,
  EventRow,
  TranscriptRow,
} from "../../lib/supabase";
import { OUTLINE_PROMPT, SKOOL_POSTS_PROMPT, JSON_FIX_PROMPT } from "./prompts";
import type { SkoolPost, TranscriptOutline } from "./types";

const AGENT_ID = "00D";
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

  log("Transcript too long, generating outline first", {
    transcriptId: transcript.id,
    charCount: text.length,
  });

  const prompt = OUTLINE_PROMPT.replace("{{TRANSCRIPT}}", text);
  const raw = await callGPT(prompt);
  const outline = await parseWithRetry<TranscriptOutline>(
    raw,
    '{ "summary": "...", "sections": [...], "key_points": [...] }'
  );

  return JSON.stringify(outline, null, 2);
}

export interface Agent00DResult {
  eventId: string;
  transcriptId: string;
  draftsCreated: number;
  skippedDuplicate: number;
  error: string | null;
}

/**
 * Main entry point: process a transcript.ready event.
 */
export async function run(event: EventRow): Promise<Agent00DResult> {
  const result: Agent00DResult = {
    eventId: event.id,
    transcriptId: "",
    draftsCreated: 0,
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
    // Idempotency: check if we already processed this event
    const alreadyDone = await isConsumerProcessed(event.id, AGENT_ID);
    if (alreadyDone) {
      log("Event already processed by this agent, skipping", { eventId: event.id });
      return result;
    }

    await markConsumerProcessing(event.id, AGENT_ID);

    // Fetch transcript
    const transcript = await getTranscriptById(payload.transcript_id);
    if (!transcript) {
      throw new Error(`Transcript not found: ${payload.transcript_id}`);
    }

    log("Transcript fetched", {
      transcriptId: transcript.id,
      charCount: transcript.transcript.length,
    });

    // Get content input (raw or outline if too long)
    const contentInput = await getContentInput(transcript);

    // Check if skool posts already exist for this transcript
    const postsExist = await contentDraftExists(transcript.id, AGENT_ID, "skool_post");
    if (postsExist) {
      log("Skool posts already exist, skipping", { transcriptId: transcript.id });
      result.skippedDuplicate++;
      await markConsumerProcessed(event.id, AGENT_ID);
      return result;
    }

    // Generate Skool posts
    log("Generating Skool posts");
    const prompt = SKOOL_POSTS_PROMPT.replace("{{CONTENT}}", contentInput);
    const raw = await callGPT(prompt);
    const skoolPosts = await parseWithRetry<SkoolPost[]>(
      raw,
      '[{ "title": "...", "content_markdown": "...", "discussion_question": "...", "suggested_time": "..." }]'
    );

    for (let i = 0; i < skoolPosts.length; i++) {
      const sp = skoolPosts[i];
      await insertContentDraft({
        transcript_id: transcript.id,
        agent_id: AGENT_ID,
        type: "skool_post",
        platform: "skool",
        content: sp.content_markdown,
        metadata: {
          title: sp.title,
          discussion_question: sp.discussion_question,
          suggested_time: sp.suggested_time,
          index: i,
        },
      });
      result.draftsCreated++;
    }

    await markConsumerProcessed(event.id, AGENT_ID);

    log("Event processing complete", {
      eventId: event.id,
      draftsCreated: result.draftsCreated,
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
