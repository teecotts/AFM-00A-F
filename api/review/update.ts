/**
 * Vercel API Route: POST /api/review/update
 *
 * Updates the status of a content_queue or media_assets item.
 * Validates allowed status transitions and logs review events.
 *
 * Body:
 * {
 *   table: "content_queue" | "media_assets",
 *   id: "uuid",
 *   status: "approved" | "needs_revision" | "rejected",
 *   note: "optional string"
 * }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../../src/lib/supabase";
import { logger } from "../../src/lib/logger";
import { isValidTransition } from "../../src/lib/reviewGate";

const ALLOWED_TABLES = ["content_queue", "media_assets"] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

const REVIEW_STATUSES = ["approved", "needs_revision", "rejected"] as const;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { table, id, status, note } = req.body as {
      table?: string;
      id?: string;
      status?: string;
      note?: string;
    };

    // Validate required fields
    if (!table || !id || !status) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: table, id, status",
      });
    }

    // Validate table name (prevent injection)
    if (!ALLOWED_TABLES.includes(table as AllowedTable)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid table. Allowed: ${ALLOWED_TABLES.join(", ")}`,
      });
    }

    // Validate status value
    if (!REVIEW_STATUSES.includes(status as typeof REVIEW_STATUSES[number])) {
      return res.status(400).json({
        ok: false,
        error: `Invalid status. Allowed: ${REVIEW_STATUSES.join(", ")}`,
      });
    }

    const sb = getSupabaseAdmin();

    // Fetch current item to validate transition
    const { data: current, error: fetchErr } = await sb
      .from(table)
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr) {
      if (fetchErr.code === "PGRST116") {
        return res.status(404).json({ ok: false, error: "Item not found" });
      }
      throw fetchErr;
    }

    // Validate state transition
    if (!isValidTransition(current.status, status)) {
      return res.status(409).json({
        ok: false,
        error: `Invalid transition: ${current.status} → ${status}`,
        current_status: current.status,
      });
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = { status };
    if (note) {
      updatePayload.review_note = note;
    }

    // Update the item
    const { data: updated, error: updateErr } = await sb
      .from(table)
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (updateErr) {
      logger.error("review.update: update failed", {
        table,
        id,
        error: updateErr.message,
      });
      throw updateErr;
    }

    // Log review event in events table
    const { error: eventErr } = await sb.from("events").insert({
      type: "review.updated",
      payload: {
        table,
        id,
        new_status: status,
        previous_status: current.status,
        note: note || null,
      },
    });

    if (eventErr) {
      // Log but don't fail the request — the update succeeded
      logger.error("review.update: event insert failed", {
        table,
        id,
        error: eventErr.message,
      });
    }

    logger.info("review.update: status updated", {
      table,
      id,
      previousStatus: current.status,
      newStatus: status,
      note: note || null,
    });

    return res.status(200).json({
      ok: true,
      updated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("review.update: handler error", { error: message });
    return res.status(500).json({ ok: false, error: message });
  }
}
