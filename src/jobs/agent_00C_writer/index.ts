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
import {
  OUTLINE_PROMPT,
  LINKEDIN_ARTICLE_PROMPT,
  BLOG_POST_PROMPT,
  SOCIAL_POSTS_PROMPT,
  JSON_FIX_PROMPT,
} from "./prompts";
import type {
  LinkedInArticle,
  BlogPost,
  SocialPost,
  TranscriptOutline,
} from "./types";

const AGENT_ID = "00C";
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

/**
 * Call GPT-4o and return the raw text response.
 */
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

/**
 * Parse JSON from GPT output. If it fails, retry once with a fix prompt.
 */
async function parseWithRetry<T>(
  raw: string,
  schemaDescription: string
): Promise<T> {
  // Strip markdown fences if present
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

/**
 * If transcript is long, generate an outline first and use that as input.
 */
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

export interface Agent00CResult {
  eventId: string;
  transcriptId: string;
  draftsCreated: number;
  skippedDuplicate: number;
  error: string | null;
}

/**
 * Main entry point: process a transcript.ready event.
 */
export async function run(event: EventRow): Promise<Agent00CResult> {
  const result: Agent00CResult = {
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

    // Mark ourselves as processing
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

    // ---- Generate LinkedIn Article ----
    if (!(await contentDraftExists(transcript.id, AGENT_ID, "linkedin_article"))) {
      log("Generating LinkedIn article");
      const prompt = LINKEDIN_ARTICLE_PROMPT.replace("{{CONTENT}}", contentInput);
      const raw = await callGPT(prompt);
      const article = await parseWithRetry<LinkedInArticle>(
        raw,
        '{ "title": "...", "alt_titles": [...], "content_markdown": "...", "hashtags": [...], "suggested_publish_window": "..." }'
      );

      await insertContentDraft({
        transcript_id: transcript.id,
        agent_id: AGENT_ID,
        type: "linkedin_article",
        platform: "linkedin",
        content: article.content_markdown,
        metadata: {
          title: article.title,
          alt_titles: article.alt_titles,
          hashtags: article.hashtags,
          suggested_publish_window: article.suggested_publish_window,
        },
      });
      result.draftsCreated++;
    } else {
      result.skippedDuplicate++;
      log("LinkedIn article already exists, skipping");
    }

    // ---- Generate Blog Post ----
    if (!(await contentDraftExists(transcript.id, AGENT_ID, "blog_post"))) {
      log("Generating blog post");
      const prompt = BLOG_POST_PROMPT.replace("{{CONTENT}}", contentInput);
      const raw = await callGPT(prompt);
      const blog = await parseWithRetry<BlogPost>(
        raw,
        '{ "title": "...", "target_keywords": [...], "meta_description": "...", "content_markdown": "..." }'
      );

      await insertContentDraft({
        transcript_id: transcript.id,
        agent_id: AGENT_ID,
        type: "blog_post",
        platform: "blog",
        content: blog.content_markdown,
        metadata: {
          title: blog.title,
          target_keywords: blog.target_keywords,
          meta_description: blog.meta_description,
        },
      });
      result.draftsCreated++;
    } else {
      result.skippedDuplicate++;
      log("Blog post already exists, skipping");
    }

    // ---- Generate Social Posts ----
    log("Generating social posts");
    const socialPrompt = SOCIAL_POSTS_PROMPT.replace("{{CONTENT}}", contentInput);
    const socialRaw = await callGPT(socialPrompt);
    const socialPosts = await parseWithRetry<SocialPost[]>(
      socialRaw,
      '[{ "platform": "linkedin|x|instagram", "content": "...", "hook": "...", "cta": "...", "suggested_time": "..." }]'
    );

    for (let i = 0; i < socialPosts.length; i++) {
      const sp = socialPosts[i];
      // For social posts, use the index in metadata to differentiate
      const exists = await contentDraftExists(transcript.id, AGENT_ID, "social_post");
      // Check more precisely: we store each post individually
      // Since multiple social_post rows can exist, we check by content hash in metadata
      // For simplicity, we rely on the event_consumers check at the top for full idempotency

      if (!exists || result.draftsCreated > 0) {
        // If we're in a fresh run (draftsCreated > 0 means we just started generating)
        // or no social posts exist yet, insert them
        await insertContentDraft({
          transcript_id: transcript.id,
          agent_id: AGENT_ID,
          type: "social_post",
          platform: sp.platform,
          content: sp.content,
          metadata: {
            hook: sp.hook,
            cta: sp.cta,
            suggested_time: sp.suggested_time,
            index: i,
          },
        });
        result.draftsCreated++;
      } else {
        result.skippedDuplicate++;
      }
    }

    // Mark consumer as processed
    await markConsumerProcessed(event.id, AGENT_ID);

    log("Event processing complete", {
      eventId: event.id,
      draftsCreated: result.draftsCreated,
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
