-- ============================================================
-- 005 — Review & Approval Layer
--
-- Expands status values for content_queue and media_assets
-- to support the review workflow:
--   draft → approved | needs_revision | rejected
--   needs_revision → approved
--   approved → scheduled → published
--
-- Adds indexes for review dashboard queries.
-- Adds review_note column for reviewer feedback.
-- Adds updated_at column for tracking review timestamps.
--
-- Safe to re-run: uses IF NOT EXISTS / DROP IF EXISTS.
-- Does NOT drop or rewrite tables.
-- ============================================================


-- ============================================================
-- 1. CONTENT_QUEUE — Expand status + add review columns
-- ============================================================

-- Add CHECK constraint for allowed statuses
-- (content_queue had no CHECK constraint on status previously)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'content_queue_status_check'
      AND conrelid = 'content_queue'::regclass
  ) THEN
    ALTER TABLE content_queue
      ADD CONSTRAINT content_queue_status_check
      CHECK (status IN ('draft', 'approved', 'needs_revision', 'rejected', 'scheduled', 'published'));
  END IF;
END $$;

-- Add review_note column for reviewer feedback
ALTER TABLE content_queue
  ADD COLUMN IF NOT EXISTS review_note text;

-- Add updated_at column for tracking review timestamps
ALTER TABLE content_queue
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Index for review dashboard queries (fetch by status, order by date)
CREATE INDEX IF NOT EXISTS idx_content_queue_status_created
  ON content_queue (status, created_at);


-- ============================================================
-- 2. MEDIA_ASSETS — Expand status + add review columns
-- ============================================================

-- Drop the old restrictive CHECK constraint and add expanded one
ALTER TABLE media_assets
  DROP CONSTRAINT IF EXISTS media_assets_status_check;

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_status_check
  CHECK (status IN ('draft', 'approved', 'needs_revision', 'rejected', 'scheduled', 'published'));

-- Add review_note column for reviewer feedback
ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS review_note text;

-- Add updated_at column for tracking review timestamps
ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Index for review dashboard queries (fetch by status, order by date)
CREATE INDEX IF NOT EXISTS idx_media_assets_status_created
  ON media_assets (status, created_at);


-- ============================================================
-- 3. AUTO-UPDATE TRIGGERS for updated_at
-- ============================================================
-- Reuse the update_updated_at_column() function from 001_core.sql

DROP TRIGGER IF EXISTS trigger_content_queue_updated_at ON content_queue;
CREATE TRIGGER trigger_content_queue_updated_at
  BEFORE UPDATE ON content_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_media_assets_updated_at ON media_assets;
CREATE TRIGGER trigger_media_assets_updated_at
  BEFORE UPDATE ON media_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
