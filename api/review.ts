/**
 * Vercel API Route: GET /api/review
 *
 * Fetches all draft content and media items, grouped by transcript.
 * Returns structured JSON for the review dashboard.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../src/lib/supabase";
import { logger } from "../src/lib/logger";

interface GroupedReviewItem {
  transcript_id: string;
  transcript_meta: {
    id: string;
    file_id: string;
    file_name: string | null;
    created_at: string;
  };
  content_items: Array<{
    id: string;
    agent_id: string;
    type: string;
    platform: string;
    status: string;
    content: string;
    review_note: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
  media_items: Array<{
    id: string;
    agent_id: string;
    type: string;
    status: string;
    content: Record<string, unknown>;
    review_note: string | null;
    created_at: string;
  }>;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const sb = getSupabaseAdmin();

    // Fetch filter — default to "draft", allow ?status= override
    const statusFilter = (req.query.status as string) || "draft";

    // Fetch content_queue items
    const { data: contentItems, error: contentErr } = await sb
      .from("content_queue")
      .select("*")
      .eq("status", statusFilter)
      .order("created_at", { ascending: false });

    if (contentErr) {
      logger.error("review: content_queue fetch failed", { error: contentErr.message });
      throw contentErr;
    }

    // Fetch media_assets items
    const { data: mediaItems, error: mediaErr } = await sb
      .from("media_assets")
      .select("*")
      .eq("status", statusFilter)
      .order("created_at", { ascending: false });

    if (mediaErr) {
      logger.error("review: media_assets fetch failed", { error: mediaErr.message });
      throw mediaErr;
    }

    // Collect unique transcript IDs
    const transcriptIds = new Set<string>();
    for (const item of contentItems || []) {
      transcriptIds.add(item.transcript_id);
    }
    for (const item of mediaItems || []) {
      transcriptIds.add(item.transcript_id);
    }

    // Fetch transcript metadata
    const transcriptsMap = new Map<string, {
      id: string;
      file_id: string;
      file_name: string | null;
      created_at: string;
    }>();

    if (transcriptIds.size > 0) {
      const { data: transcripts, error: transcriptErr } = await sb
        .from("transcripts")
        .select("id, file_id, file_name, created_at")
        .in("id", Array.from(transcriptIds));

      if (transcriptErr) {
        logger.error("review: transcripts fetch failed", { error: transcriptErr.message });
        throw transcriptErr;
      }

      for (const t of transcripts || []) {
        transcriptsMap.set(t.id, t);
      }
    }

    // Group by transcript_id
    const grouped = new Map<string, GroupedReviewItem>();

    for (const item of contentItems || []) {
      if (!grouped.has(item.transcript_id)) {
        grouped.set(item.transcript_id, {
          transcript_id: item.transcript_id,
          transcript_meta: transcriptsMap.get(item.transcript_id) || {
            id: item.transcript_id,
            file_id: "unknown",
            file_name: null,
            created_at: "",
          },
          content_items: [],
          media_items: [],
        });
      }
      grouped.get(item.transcript_id)!.content_items.push({
        id: item.id,
        agent_id: item.agent_id,
        type: item.type,
        platform: item.platform,
        status: item.status,
        content: item.content,
        review_note: item.review_note || null,
        metadata: item.metadata,
        created_at: item.created_at,
      });
    }

    for (const item of mediaItems || []) {
      if (!grouped.has(item.transcript_id)) {
        grouped.set(item.transcript_id, {
          transcript_id: item.transcript_id,
          transcript_meta: transcriptsMap.get(item.transcript_id) || {
            id: item.transcript_id,
            file_id: "unknown",
            file_name: null,
            created_at: "",
          },
          content_items: [],
          media_items: [],
        });
      }
      grouped.get(item.transcript_id)!.media_items.push({
        id: item.id,
        agent_id: item.agent_id,
        type: item.type,
        status: item.status,
        content: item.content,
        review_note: item.review_note || null,
        created_at: item.created_at,
      });
    }

    const result = Array.from(grouped.values());

    logger.info("review: fetched items", {
      status: statusFilter,
      transcripts: result.length,
      contentItems: (contentItems || []).length,
      mediaItems: (mediaItems || []).length,
    });

    return res.status(200).json({
      ok: true,
      status: statusFilter,
      groups: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("review: handler error", { error: message });
    return res.status(500).json({ ok: false, error: message });
  }
}
