-- ============================================================
-- Migration 002: Content Pipeline (Agents 00C + 00D)
-- Multi-consumer event tracking + content draft queue
-- ============================================================

-- 1. Event consumers: per-agent tracking for multi-consumer events
--    Multiple agents can independently consume the same event
--    without blocking each other or marking the base event "done".
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

-- 2. Content queue: drafts produced by writer agents
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

-- Idempotency index: prevent duplicate drafts per transcript + agent + type
CREATE INDEX IF NOT EXISTS idx_content_queue_idempotency
  ON content_queue (transcript_id, agent_id, type);
