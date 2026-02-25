-- ============================================================
-- Agent 00A: Content Factory Pipeline
-- Migration 001: Core tables for event-driven transcription
-- ============================================================

-- 1. Events table: central event bus for the pipeline
CREATE TABLE IF NOT EXISTS events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}',
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer     NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for worker polling: find pending events quickly
CREATE INDEX IF NOT EXISTS idx_events_status_type
  ON events (status, type);

-- Index for idempotency check: look up events by type + file_id in payload
CREATE INDEX IF NOT EXISTS idx_events_payload_file_id
  ON events ((payload->>'file_id'))
  WHERE type = 'recording.uploaded';

-- 2. Transcripts table: stores Whisper output
CREATE TABLE IF NOT EXISTS transcripts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id     text        NOT NULL,
  file_name   text,
  transcript  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_file_id
  ON transcripts (file_id);

-- 3. Dead letters table: events that exhausted all retries
CREATE TABLE IF NOT EXISTS dead_letters (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id uuid,
  type            text,
  payload         jsonb,
  last_error      text,
  attempt_count   integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 4. Auto-update updated_at on events table
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
