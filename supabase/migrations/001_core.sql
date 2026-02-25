-- ============================================================
-- Muggles Content Factory — Consolidated Core Schema
--
-- This single migration creates ALL tables, indexes, triggers,
-- and constraints required by the Agent 00 pipeline.
--
-- Tables: events, transcripts, event_consumers, content_queue,
--         media_assets, dead_letters
--
-- Safe to re-run: uses IF NOT EXISTS / IF NOT EXISTS throughout.
-- ============================================================

-- Enable pgcrypto for gen_random_uuid() (Supabase enables by default,
-- but explicit is better for portability)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- 1. EVENTS — Central event bus for the pipeline
-- ============================================================
-- Statuses: pending → processing → completed | failed
-- Event types: recording.uploaded, transcript.ready

CREATE TABLE IF NOT EXISTS events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}',
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer     NOT NULL DEFAULT 0,
  last_error    text,
  dedupe_key    text        UNIQUE,
  locked_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Worker polling: find pending events by type
CREATE INDEX IF NOT EXISTS idx_events_status_type
  ON events (status, type);

-- Idempotency: look up recording.uploaded events by file_id in payload
CREATE INDEX IF NOT EXISTS idx_events_payload_file_id
  ON events ((payload->>'file_id'))
  WHERE type = 'recording.uploaded';

-- Efficient claim queries: oldest pending events first
CREATE INDEX IF NOT EXISTS idx_events_pending_created
  ON events (created_at ASC)
  WHERE status = 'pending';

-- Stale lock detection: find events stuck in processing
CREATE INDEX IF NOT EXISTS idx_events_locked_at
  ON events (locked_at)
  WHERE status = 'processing' AND locked_at IS NOT NULL;

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_events_updated_at ON events;
CREATE TRIGGER trigger_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 2. TRANSCRIPTS — Whisper transcription output
-- ============================================================

CREATE TABLE IF NOT EXISTS transcripts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id     text        NOT NULL,
  file_name   text,
  transcript  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_file_id
  ON transcripts (file_id);


-- ============================================================
-- 3. EVENT_CONSUMERS — Per-agent tracking for multi-consumer events
-- ============================================================
-- Multiple agents (00B, 00C, 00D, 00F) can independently consume
-- the same event without blocking each other.
-- Statuses: processing → processed | failed

CREATE TABLE IF NOT EXISTS event_consumers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid        NOT NULL REFERENCES events(id),
  agent_id    text        NOT NULL,
  status      text        NOT NULL DEFAULT 'processing'
                          CHECK (status IN ('processing', 'processed', 'failed')),
  error       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_event_consumers_event_agent
  ON event_consumers (event_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_event_consumers_status
  ON event_consumers (status);


-- ============================================================
-- 4. CONTENT_QUEUE — Text content drafts from writer agents
-- ============================================================
-- Types: linkedin_article, blog_post, social_post, skool_post
-- Platforms: linkedin, blog, x, instagram, skool

CREATE TABLE IF NOT EXISTS content_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id   uuid        NOT NULL REFERENCES transcripts(id),
  idea_id         uuid,
  agent_id        text        NOT NULL,
  type            text        NOT NULL
                              CHECK (type IN (
                                'linkedin_article', 'blog_post', 'social_post', 'skool_post'
                              )),
  platform        text        NOT NULL
                              CHECK (platform IN (
                                'linkedin', 'blog', 'x', 'instagram', 'skool'
                              )),
  status          text        NOT NULL DEFAULT 'draft',
  content         text        NOT NULL,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_queue_transcript
  ON content_queue (transcript_id);

CREATE INDEX IF NOT EXISTS idx_content_queue_agent_type
  ON content_queue (agent_id, type);

-- Idempotency: prevent duplicate drafts per transcript + agent + type
CREATE INDEX IF NOT EXISTS idx_content_queue_idempotency
  ON content_queue (transcript_id, agent_id, type);


-- ============================================================
-- 5. MEDIA_ASSETS — Visual assets from video/graphics agents
-- ============================================================
-- Types: clip, thumbnail, graphic, chapter_markers
-- Statuses: draft → approved

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

-- Idempotency: prevent duplicate assets per transcript + agent + type
CREATE INDEX IF NOT EXISTS idx_media_assets_idempotency
  ON media_assets (transcript_id, agent_id, type);


-- ============================================================
-- 6. DEAD_LETTERS — Failed events after max retries
-- ============================================================

CREATE TABLE IF NOT EXISTS dead_letters (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id uuid,
  type            text,
  payload         jsonb,
  last_error      text,
  attempt_count   integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);
