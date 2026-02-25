/**
 * Vercel API Route: POST /api/review/bulk-approve
 *
 * Bulk-approves items by transcript_id + table (+ optional type filter).
 *
 * Body:
 * {
 *   table: "content_queue" | "media_assets",
 *   transcript_id: "uuid",
 *   type?: "string"  // optional filter by content/asset type
 * }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../../src/lib/supabase";
import { logger } from "../../src/lib/logger";

const ALLOWED_TABLES = ["content_queue", "media_assets"] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { table, transcript_id, type } = req.body as {
      table?: string;
      transcript_id?: string;
      type?: string;
    };

    if (!table || !transcript_id) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: table, transcript_id",
      });
    }

    if (!ALLOWED_TABLES.includes(table as AllowedTable)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid table. Allowed: ${ALLOWED_TABLES.join(", ")}`,
      });
    }

    const sb = getSupabaseAdmin();

    // Build query — only approve items currently in "draft" or "needs_revision"
    let query = sb
      .from(table)
      .update({ status: "approved" })
      .eq("transcript_id", transcript_id)
      .in("status", ["draft", "needs_revision"]);

    if (type) {
      query = query.eq("type", type);
    }

    const { data: updated, error: updateErr } = await query.select();

    if (updateErr) {
      logger.error("review.bulk-approve: update failed", {
        table,
        transcript_id,
        error: updateErr.message,
      });
      throw updateErr;
    }

    const count = (updated || []).length;

    // Log bulk review event
    if (count > 0) {
      const { error: eventErr } = await sb.from("events").insert({
        type: "review.updated",
        payload: {
          table,
          action: "bulk_approve",
          transcript_id,
          type: type || null,
          count,
          item_ids: (updated || []).map((r: { id: string }) => r.id),
        },
      });

      if (eventErr) {
        logger.error("review.bulk-approve: event insert failed", {
          error: eventErr.message,
        });
      }
    }

    logger.info("review.bulk-approve: completed", {
      table,
      transcript_id,
      type: type || "all",
      count,
    });

    return res.status(200).json({
      ok: true,
      approved_count: count,
      updated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("review.bulk-approve: handler error", { error: message });
    return res.status(500).json({ ok: false, error: message });
  }
}
