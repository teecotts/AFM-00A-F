/**
 * Event Queue Utilities
 *
 * Clean API for enqueuing, claiming, and completing events.
 * All functions use the admin (service-role) Supabase client.
 *
 * Wraps the lower-level helpers in supabase.ts with a streamlined
 * interface matching the event-queue contract.
 */
import { getSupabaseAdmin } from "./supabase";
import { logger } from "./logger";
import type { EventRow } from "./supabase";

export type { EventRow };

/**
 * Enqueue a new event into the events table.
 *
 * @param eventType — e.g. "recording.uploaded", "transcript.ready"
 * @param payload   — arbitrary JSON data for the event
 * @param dedupeKey — optional unique key for idempotent inserts.
 *                    If a row with this dedupe_key already exists,
 *                    the insert will be skipped (returns existing row).
 */
export async function enqueueEvent(
  eventType: string,
  payload: Record<string, unknown>,
  dedupeKey?: string
): Promise<EventRow> {
  const sb = getSupabaseAdmin();

  // If dedupe_key provided, check if event already exists
  if (dedupeKey) {
    const { data: existing, error: checkErr } = await sb
      .from("events")
      .select("*")
      .eq("dedupe_key", dedupeKey)
      .limit(1);

    if (checkErr) {
      logger.error("enqueueEvent dedupe check failed", { eventType, dedupeKey, error: checkErr.message });
      throw checkErr;
    }

    if (existing && existing.length > 0) {
      logger.info("enqueueEvent skipped (dedupe_key exists)", { eventType, dedupeKey, existingId: existing[0].id });
      return existing[0] as EventRow;
    }
  }

  const { data, error } = await sb
    .from("events")
    .insert({
      type: eventType,
      payload,
      dedupe_key: dedupeKey || null,
    })
    .select()
    .single();

  if (error) {
    logger.error("enqueueEvent failed", { eventType, error: error.message });
    throw error;
  }

  logger.info("Event enqueued", { eventId: data.id, eventType, dedupeKey: dedupeKey || null });
  return data as EventRow;
}

/**
 * Atomically claim the next pending event.
 *
 * Sets status = "processing" and locked_at = now().
 * Uses optimistic locking (WHERE status = 'pending') to prevent double-claims.
 *
 * @param eventType   — optional filter by event type. If omitted, claims any pending event.
 * @param lockSeconds — how long to consider the lock valid (default 60). Used for stale lock recovery.
 * @returns the claimed EventRow, or null if no pending events.
 */
export async function claimNextEvent(
  eventType?: string,
  lockSeconds: number = 60
): Promise<EventRow | null> {
  const sb = getSupabaseAdmin();
  const maxRetries = parseInt(process.env.MAX_RETRIES || "3", 10);

  // Build the query to find oldest pending event
  let query = sb
    .from("events")
    .select("id")
    .eq("status", "pending")
    .lt("attempt_count", maxRetries)
    .order("created_at", { ascending: true })
    .limit(1);

  if (eventType) {
    query = query.eq("type", eventType);
  }

  const { data: candidates, error: findError } = await query;

  if (findError) {
    logger.error("claimNextEvent find failed", { eventType, error: findError.message });
    throw findError;
  }

  if (!candidates || candidates.length === 0) {
    return null;
  }

  const candidateId = candidates[0].id;

  // Atomically claim: update only if still pending
  const { data: claimed, error: claimError } = await sb
    .from("events")
    .update({
      status: "processing",
      locked_at: new Date().toISOString(),
    })
    .eq("id", candidateId)
    .eq("status", "pending") // optimistic lock
    .select()
    .single();

  if (claimError) {
    // Another worker beat us — not an error
    logger.warn("claimNextEvent race lost", { candidateId, error: claimError.message });
    return null;
  }

  logger.info("Event claimed", {
    eventId: claimed.id,
    eventType: claimed.type,
    lockSeconds,
  });
  return claimed as EventRow;
}

/**
 * Mark an event as done (completed).
 */
export async function markDone(eventId: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("events")
    .update({
      status: "completed",
      locked_at: null,
    })
    .eq("id", eventId);

  if (error) {
    logger.error("markDone failed", { eventId, error: error.message });
    throw error;
  }

  logger.info("Event marked done", { eventId });
}

/**
 * Mark an event as failed.
 * If retries are exhausted, moves it to dead_letters and sets status = "failed".
 * Otherwise, resets it to "pending" for retry.
 */
export async function markFailed(
  eventId: string,
  errorMessage: string
): Promise<void> {
  const sb = getSupabaseAdmin();
  const maxRetries = parseInt(process.env.MAX_RETRIES || "3", 10);

  // Fetch current attempt count
  const { data: evt, error: fetchErr } = await sb
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (fetchErr) {
    logger.error("markFailed: could not fetch event", { eventId, error: fetchErr.message });
    throw fetchErr;
  }

  const newAttemptCount = (evt.attempt_count || 0) + 1;

  if (newAttemptCount >= maxRetries) {
    // Dead-letter it
    const { error: dlError } = await sb.from("dead_letters").insert({
      source_event_id: eventId,
      type: evt.type,
      payload: evt.payload,
      last_error: errorMessage,
      attempt_count: newAttemptCount,
    });

    if (dlError) {
      logger.error("markFailed: dead_letters insert failed", { eventId, error: dlError.message });
    } else {
      logger.warn("Event moved to dead_letters", { eventId, attempts: newAttemptCount });
    }

    // Mark permanently failed
    await sb
      .from("events")
      .update({
        status: "failed",
        attempt_count: newAttemptCount,
        last_error: errorMessage,
        locked_at: null,
      })
      .eq("id", eventId);
  } else {
    // Reset to pending for retry
    const { error: retryErr } = await sb
      .from("events")
      .update({
        status: "pending",
        attempt_count: newAttemptCount,
        last_error: errorMessage,
        locked_at: null,
      })
      .eq("id", eventId);

    if (retryErr) {
      logger.error("markFailed: retry reset failed", { eventId, error: retryErr.message });
    } else {
      logger.info("Event returned to pending for retry", {
        eventId,
        attempt: newAttemptCount,
        maxRetries,
      });
    }
  }
}
