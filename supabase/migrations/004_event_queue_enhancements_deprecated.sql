-- ============================================================
-- Migration 004: Event queue enhancements
-- Adds dedupe_key and locked_at for atomic claim + idempotency
-- ============================================================

-- 1. dedupe_key: optional unique constraint for idempotent event insertion
ALTER TABLE events ADD COLUMN IF NOT EXISTS dedupe_key text UNIQUE;

-- 2. locked_at: timestamp set when a worker claims an event
ALTER TABLE events ADD COLUMN IF NOT EXISTS locked_at timestamptz;

-- 3. Index for efficient claim queries: pending events ordered by creation
CREATE INDEX IF NOT EXISTS idx_events_pending_created
  ON events (created_at ASC)
  WHERE status = 'pending';

-- 4. Index for stale lock detection (events stuck in processing)
CREATE INDEX IF NOT EXISTS idx_events_locked_at
  ON events (locked_at)
  WHERE status = 'processing' AND locked_at IS NOT NULL;
