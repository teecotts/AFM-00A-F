-- ============================================================
-- Migration 003: Media Assets (Agents 00B + 00F)
-- Visual layer: clips, thumbnails, graphics, chapter markers
-- ============================================================

CREATE TABLE IF NOT EXISTS media_assets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id   uuid        NOT NULL REFERENCES transcripts(id),
  idea_id         uuid,
  agent_id        text        NOT NULL,
  type            text        NOT NULL
                              CHECK (type IN ('clip', 'thumbnail', 'graphic', 'chapter_markers')),
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'approved')),
  content         jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_transcript
  ON media_assets (transcript_id);

CREATE INDEX IF NOT EXISTS idx_media_assets_agent_type
  ON media_assets (agent_id, type);

-- Idempotency index: prevent duplicate assets per transcript + agent + type
CREATE INDEX IF NOT EXISTS idx_media_assets_idempotency
  ON media_assets (transcript_id, agent_id, type);
