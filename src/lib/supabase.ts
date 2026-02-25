import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

let adminClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

/**
 * Validate that required Supabase env vars are set.
 * Call on boot to fail fast with clear errors.
 */
export function validateSupabaseEnv(): void {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing SUPABASE_URL — set it in .env");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY — set it in .env");

  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid SUPABASE_URL: "${url}" is not a valid URL`);
  }
}

/**
 * Service-role client — full access, server-side only.
 * NEVER expose this in client/browser code.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  adminClient = createClient(url, key, {
    auth: { persistSession: false },
  });

  logger.info("Supabase admin client initialized", { url });
  return adminClient;
}

/**
 * Anon-key client — respects RLS, safe for client-side contexts.
 * Falls back to service-role key if SUPABASE_ANON_KEY is not set.
 */
export function getSupabasePublic(): SupabaseClient {
  if (publicClient) return publicClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }

  publicClient = createClient(url, key, {
    auth: { persistSession: false },
  });

  logger.info("Supabase public client initialized", { url });
  return publicClient;
}

/** Backward-compatible alias — returns the admin (service-role) client. */
export function getSupabase(): SupabaseClient {
  return getSupabaseAdmin();
}

// ---- Shared types ----

export interface EventRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "failed";
  attempt_count: number;
  last_error: string | null;
  dedupe_key: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptRow {
  id: string;
  file_id: string;
  file_name: string | null;
  transcript: string;
  created_at: string;
}

export interface EventConsumerRow {
  id: string;
  event_id: string;
  agent_id: string;
  status: "processing" | "processed" | "failed";
  error: Record<string, unknown> | null;
  created_at: string;
}

export interface ContentQueueRow {
  id: string;
  transcript_id: string;
  idea_id: string | null;
  agent_id: string;
  type: string;
  platform: string;
  status: "draft" | "approved" | "needs_revision" | "rejected" | "scheduled" | "published";
  content: string;
  metadata: Record<string, unknown>;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaAssetRow {
  id: string;
  transcript_id: string;
  idea_id: string | null;
  agent_id: string;
  type: "clip" | "thumbnail" | "graphic" | "chapter_markers";
  status: "draft" | "approved" | "needs_revision" | "rejected" | "scheduled" | "published";
  content: Record<string, unknown>;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Event helpers ----

/**
 * Check if a recording.uploaded event already exists for this file_id.
 * Used for idempotency on the polling side.
 */
export async function eventExistsForFile(fileId: string): Promise<boolean> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("events")
    .select("id")
    .eq("type", "recording.uploaded")
    .filter("payload->>file_id", "eq", fileId)
    .limit(1);

  if (error) {
    logger.error("eventExistsForFile query failed", { fileId, error: error.message });
    throw error;
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Insert a new event into the events table.
 */
export async function insertEvent(
  type: string,
  payload: Record<string, unknown>
): Promise<EventRow> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("events")
    .insert({ type, payload })
    .select()
    .single();

  if (error) {
    logger.error("insertEvent failed", { type, error: error.message });
    throw error;
  }

  logger.info("Event inserted", { eventId: data.id, type });
  return data as EventRow;
}

/**
 * Atomically claim the next pending event of a given type.
 * Uses status transition pending -> processing to prevent double-processing.
 * Returns null if no event is available.
 */
export async function claimNextPendingEvent(
  eventType: string
): Promise<EventRow | null> {
  const sb = getSupabase();

  // Find oldest pending event of this type with attempt_count < max
  const maxRetries = parseInt(process.env.MAX_RETRIES || "3", 10);
  const { data: candidates, error: findError } = await sb
    .from("events")
    .select("id")
    .eq("type", eventType)
    .eq("status", "pending")
    .lt("attempt_count", maxRetries)
    .order("created_at", { ascending: true })
    .limit(1);

  if (findError) {
    logger.error("claimNextPendingEvent find failed", { error: findError.message });
    throw findError;
  }

  if (!candidates || candidates.length === 0) {
    return null;
  }

  const candidateId = candidates[0].id;

  // Atomically claim it: update only if still pending
  const { data: claimed, error: claimError } = await sb
    .from("events")
    .update({
      status: "processing",
      attempt_count: undefined, // we'll increment in the worker
    })
    .eq("id", candidateId)
    .eq("status", "pending") // optimistic lock
    .select()
    .single();

  if (claimError) {
    // Another worker may have claimed it — not an error
    logger.warn("claimNextPendingEvent race lost or error", {
      candidateId,
      error: claimError.message,
    });
    return null;
  }

  logger.info("Event claimed", { eventId: claimed.id, type: claimed.type });
  return claimed as EventRow;
}

/**
 * Mark an event as completed.
 */
export async function markEventCompleted(eventId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("events")
    .update({ status: "completed" })
    .eq("id", eventId);

  if (error) {
    logger.error("markEventCompleted failed", { eventId, error: error.message });
    throw error;
  }

  logger.info("Event completed", { eventId });
}

/**
 * Record a failure on an event. If retries exhausted, move to dead_letters.
 */
export async function markEventFailed(
  eventId: string,
  errorMessage: string,
  currentAttemptCount: number
): Promise<void> {
  const sb = getSupabase();
  const maxRetries = parseInt(process.env.MAX_RETRIES || "3", 10);
  const newAttemptCount = currentAttemptCount + 1;

  if (newAttemptCount >= maxRetries) {
    // Move to dead_letters
    // First, fetch full event data
    const { data: evt, error: fetchErr } = await sb
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (fetchErr) {
      logger.error("Failed to fetch event for dead-lettering", { eventId, error: fetchErr.message });
    } else {
      const { error: dlError } = await sb.from("dead_letters").insert({
        source_event_id: eventId,
        type: evt.type,
        payload: evt.payload,
        last_error: errorMessage,
        attempt_count: newAttemptCount,
      });

      if (dlError) {
        logger.error("Failed to insert dead letter", { eventId, error: dlError.message });
      } else {
        logger.warn("Event moved to dead_letters", { eventId, attempts: newAttemptCount });
      }
    }

    // Mark event as failed permanently
    const { error } = await sb
      .from("events")
      .update({
        status: "failed",
        attempt_count: newAttemptCount,
        last_error: errorMessage,
      })
      .eq("id", eventId);

    if (error) {
      logger.error("markEventFailed (permanent) failed", { eventId, error: error.message });
    }
  } else {
    // Reset to pending for retry
    const { error } = await sb
      .from("events")
      .update({
        status: "pending",
        attempt_count: newAttemptCount,
        last_error: errorMessage,
      })
      .eq("id", eventId);

    if (error) {
      logger.error("markEventFailed (retry) failed", { eventId, error: error.message });
    } else {
      logger.info("Event returned to pending for retry", {
        eventId,
        attempt: newAttemptCount,
        maxRetries,
      });
    }
  }
}

/**
 * Insert a transcript row and return it.
 */
export async function insertTranscript(
  fileId: string,
  fileName: string | null,
  transcript: string
): Promise<TranscriptRow> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("transcripts")
    .insert({ file_id: fileId, file_name: fileName, transcript })
    .select()
    .single();

  if (error) {
    logger.error("insertTranscript failed", { fileId, error: error.message });
    throw error;
  }

  logger.info("Transcript stored", { transcriptId: data.id, fileId });
  return data as TranscriptRow;
}

// ---- Transcript fetch ----

/**
 * Fetch a transcript row by ID.
 */
export async function getTranscriptById(
  transcriptId: string
): Promise<TranscriptRow | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("transcripts")
    .select("*")
    .eq("id", transcriptId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // not found
    logger.error("getTranscriptById failed", { transcriptId, error: error.message });
    throw error;
  }

  return data as TranscriptRow;
}

// ---- Event consumer tracking (multi-consumer pattern) ----

/**
 * Check if an agent has already processed this event.
 */
export async function isConsumerProcessed(
  eventId: string,
  agentId: string
): Promise<boolean> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("event_consumers")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("agent_id", agentId)
    .limit(1);

  if (error) {
    logger.error("isConsumerProcessed query failed", { eventId, agentId, error: error.message });
    throw error;
  }

  if (!data || data.length === 0) return false;
  return data[0].status === "processed";
}

/**
 * Mark an agent as "processing" for this event.
 * Uses upsert to handle retries gracefully.
 */
export async function markConsumerProcessing(
  eventId: string,
  agentId: string
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("event_consumers")
    .upsert(
      { event_id: eventId, agent_id: agentId, status: "processing" },
      { onConflict: "event_id,agent_id" }
    );

  if (error) {
    logger.error("markConsumerProcessing failed", { eventId, agentId, error: error.message });
    throw error;
  }

  logger.info("Consumer marked processing", { eventId, agentId });
}

/**
 * Mark an agent as "processed" for this event.
 */
export async function markConsumerProcessed(
  eventId: string,
  agentId: string
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("event_consumers")
    .upsert(
      { event_id: eventId, agent_id: agentId, status: "processed" },
      { onConflict: "event_id,agent_id" }
    );

  if (error) {
    logger.error("markConsumerProcessed failed", { eventId, agentId, error: error.message });
    throw error;
  }

  logger.info("Consumer marked processed", { eventId, agentId });
}

/**
 * Mark an agent as "failed" for this event, with error details.
 */
export async function markConsumerFailed(
  eventId: string,
  agentId: string,
  errorData: Record<string, unknown>
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("event_consumers")
    .upsert(
      { event_id: eventId, agent_id: agentId, status: "failed", error: errorData },
      { onConflict: "event_id,agent_id" }
    );

  if (error) {
    logger.error("markConsumerFailed failed", { eventId, agentId, error: error.message });
    throw error;
  }

  logger.warn("Consumer marked failed", { eventId, agentId });
}

// ---- Content queue helpers ----

/**
 * Check if a content draft already exists (idempotency).
 */
export async function contentDraftExists(
  transcriptId: string,
  agentId: string,
  type: string
): Promise<boolean> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("content_queue")
    .select("id")
    .eq("transcript_id", transcriptId)
    .eq("agent_id", agentId)
    .eq("type", type)
    .limit(1);

  if (error) {
    logger.error("contentDraftExists query failed", { transcriptId, agentId, type, error: error.message });
    throw error;
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Insert a content draft into the content_queue.
 */
export async function insertContentDraft(draft: {
  transcript_id: string;
  idea_id?: string | null;
  agent_id: string;
  type: string;
  platform: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<ContentQueueRow> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("content_queue")
    .insert({
      transcript_id: draft.transcript_id,
      idea_id: draft.idea_id || null,
      agent_id: draft.agent_id,
      type: draft.type,
      platform: draft.platform,
      status: "draft",
      content: draft.content,
      metadata: draft.metadata || {},
    })
    .select()
    .single();

  if (error) {
    logger.error("insertContentDraft failed", {
      agentId: draft.agent_id,
      type: draft.type,
      error: error.message,
    });
    throw error;
  }

  logger.info("Content draft inserted", {
    draftId: data.id,
    agentId: draft.agent_id,
    type: draft.type,
    platform: draft.platform,
  });
  return data as ContentQueueRow;
}

/**
 * Find pending transcript.ready events that a specific agent hasn't processed yet.
 */
export async function findUnprocessedTranscriptEvents(
  agentId: string
): Promise<EventRow[]> {
  const sb = getSupabase();

  // Get all transcript.ready events that are pending or completed (multi-consumer safe)
  const { data: events, error: evtErr } = await sb
    .from("events")
    .select("*")
    .eq("type", "transcript.ready")
    .in("status", ["pending", "processing", "completed"])
    .order("created_at", { ascending: true })
    .limit(10);

  if (evtErr) {
    logger.error("findUnprocessedTranscriptEvents query failed", { error: evtErr.message });
    throw evtErr;
  }

  if (!events || events.length === 0) return [];

  // Filter out events this agent has already processed
  const unprocessed: EventRow[] = [];
  for (const evt of events) {
    const already = await isConsumerProcessed(evt.id, agentId);
    if (!already) {
      unprocessed.push(evt as EventRow);
    }
  }

  return unprocessed;
}

// ---- Media assets helpers ----

/**
 * Check if a media asset already exists (idempotency).
 */
export async function mediaAssetExists(
  transcriptId: string,
  agentId: string,
  type: string
): Promise<boolean> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("media_assets")
    .select("id")
    .eq("transcript_id", transcriptId)
    .eq("agent_id", agentId)
    .eq("type", type)
    .limit(1);

  if (error) {
    logger.error("mediaAssetExists query failed", { transcriptId, agentId, type, error: error.message });
    throw error;
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Insert a media asset row.
 */
export async function insertMediaAsset(asset: {
  transcript_id: string;
  idea_id?: string | null;
  agent_id: string;
  type: string;
  content: Record<string, unknown>;
}): Promise<MediaAssetRow> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("media_assets")
    .insert({
      transcript_id: asset.transcript_id,
      idea_id: asset.idea_id || null,
      agent_id: asset.agent_id,
      type: asset.type,
      status: "draft",
      content: asset.content,
    })
    .select()
    .single();

  if (error) {
    logger.error("insertMediaAsset failed", {
      agentId: asset.agent_id,
      type: asset.type,
      error: error.message,
    });
    throw error;
  }

  logger.info("Media asset inserted", {
    assetId: data.id,
    agentId: asset.agent_id,
    type: asset.type,
  });
  return data as MediaAssetRow;
}
