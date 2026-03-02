/**
 * Vercel API Route: GET /api/pipeline
 *
 * Returns pipeline run history — each recording.uploaded event
 * with its transcript, content items, and media assets.
 *
 * Query params:
 *   ?limit=10  — number of runs to return (default 10, max 50)
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../src/lib/supabase";
import { logger } from "../src/lib/logger";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const sb = getSupabaseAdmin();
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    // 1. Get recent recording.uploaded events (each = one pipeline run)
    const { data: events, error: eventsErr } = await sb
      .from("events")
      .select("*")
      .eq("type", "recording.uploaded")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (eventsErr) {
      logger.error("pipeline: events fetch failed", { error: eventsErr.message });
      throw eventsErr;
    }

    if (!events || events.length === 0) {
      return res.status(200).json({ ok: true, runs: [] });
    }

    // 2. Collect file_ids to look up transcripts
    const fileIds = events.map(
      (e) => (e.payload as { file_id: string }).file_id
    );

    const { data: transcripts, error: tErr } = await sb
      .from("transcripts")
      .select("id, file_id, file_name, transcript, created_at")
      .in("file_id", fileIds);

    if (tErr) {
      logger.error("pipeline: transcripts fetch failed", { error: tErr.message });
      throw tErr;
    }

    // Map file_id → transcript
    const transcriptByFile = new Map<string, typeof transcripts extends (infer T)[] ? T : never>();
    for (const t of transcripts || []) {
      transcriptByFile.set(t.file_id, t);
    }

    // 3. Collect transcript IDs for content/media lookup
    const transcriptIds = (transcripts || []).map((t) => t.id);

    // Fetch content_queue and media_assets in parallel
    const [contentResult, mediaResult] = await Promise.all([
      transcriptIds.length > 0
        ? sb
            .from("content_queue")
            .select("id, transcript_id, agent_id, type, platform, status, content, created_at")
            .in("transcript_id", transcriptIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      transcriptIds.length > 0
        ? sb
            .from("media_assets")
            .select("id, transcript_id, agent_id, type, status, content, created_at")
            .in("transcript_id", transcriptIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (contentResult.error) throw contentResult.error;
    if (mediaResult.error) throw mediaResult.error;

    // Group content/media by transcript_id
    const contentByTranscript = new Map<string, typeof contentResult.data>();
    for (const item of contentResult.data || []) {
      const arr = contentByTranscript.get(item.transcript_id) || [];
      arr.push(item);
      contentByTranscript.set(item.transcript_id, arr);
    }

    const mediaByTranscript = new Map<string, typeof mediaResult.data>();
    for (const item of mediaResult.data || []) {
      const arr = mediaByTranscript.get(item.transcript_id) || [];
      arr.push(item);
      mediaByTranscript.set(item.transcript_id, arr);
    }

    // 4. Build response
    const runs = events.map((event) => {
      const payload = event.payload as {
        file_id: string;
        file_name: string;
        created_time?: string;
        size?: string;
      };
      const transcript = transcriptByFile.get(payload.file_id) || null;
      const tId = transcript?.id;

      const contentItems = tId ? contentByTranscript.get(tId) || [] : [];
      const mediaItems = tId ? mediaByTranscript.get(tId) || [] : [];

      // Aggregate counts by agent
      const agentSummary: Record<string, { items: number; types: string[] }> = {};
      for (const c of contentItems) {
        if (!agentSummary[c.agent_id]) agentSummary[c.agent_id] = { items: 0, types: [] };
        agentSummary[c.agent_id].items++;
        if (!agentSummary[c.agent_id].types.includes(c.type)) {
          agentSummary[c.agent_id].types.push(c.type);
        }
      }
      for (const m of mediaItems) {
        if (!agentSummary[m.agent_id]) agentSummary[m.agent_id] = { items: 0, types: [] };
        agentSummary[m.agent_id].items++;
        if (!agentSummary[m.agent_id].types.includes(m.type)) {
          agentSummary[m.agent_id].types.push(m.type);
        }
      }

      // Status breakdown
      const statusCounts: Record<string, number> = {};
      for (const c of contentItems) {
        statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
      }
      for (const m of mediaItems) {
        statusCounts[m.status] = (statusCounts[m.status] || 0) + 1;
      }

      return {
        event_id: event.id,
        event_status: event.status,
        event_error: event.last_error || null,
        attempt_count: event.attempt_count,
        created_at: event.created_at,
        file: {
          id: payload.file_id,
          name: payload.file_name,
          size: payload.size || null,
        },
        transcript: transcript
          ? {
              id: transcript.id,
              char_count: transcript.transcript?.length || 0,
              created_at: transcript.created_at,
            }
          : null,
        content_items: contentItems,
        media_items: mediaItems,
        summary: {
          total_items: contentItems.length + mediaItems.length,
          content_count: contentItems.length,
          media_count: mediaItems.length,
          agents: agentSummary,
          status_breakdown: statusCounts,
        },
      };
    });

    logger.info("pipeline: fetched runs", { count: runs.length });

    return res.status(200).json({ ok: true, runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("pipeline: handler error", { error: message });
    return res.status(500).json({ ok: false, error: message });
  }
}
