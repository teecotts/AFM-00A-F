# Database Migrations

## Overview

All schema is defined in `supabase/migrations/001_core.sql` — a single consolidated migration that creates every table, index, trigger, and constraint the codebase expects.

The DB is the **source of truth** for schema; `001_core.sql` is the **source of truth** for what that schema should be.

## How to Apply Migrations

### Option A: Supabase SQL Editor (recommended for first setup)

1. Go to your Supabase Dashboard → **SQL Editor**
2. Copy the entire contents of `supabase/migrations/001_core.sql`
3. Paste and click **Run**
4. Verify with `npm run db:verify`

### Option B: Supabase CLI

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## How to Verify

After applying migrations, run the schema contract verifier:

```bash
npm run db:verify
```

This script connects to your Supabase instance and checks that every table and column expected by the code actually exists. Output example:

```
✓ events — PASS
✓ transcripts — PASS
✓ event_consumers — PASS
✓ content_queue — PASS
✓ media_assets — PASS
✓ dead_letters — PASS

════════════════════════════════════════════════════
  RESULT: ALL CHECKS PASSED
════════════════════════════════════════════════════
```

## Schema Contract Summary

### Tables

| Table | Purpose | Key Agents |
|---|---|---|
| `events` | Central event bus | 00A (producer), all (consumers) |
| `transcripts` | Whisper transcription output | 00A |
| `event_consumers` | Per-agent event processing tracking | 00B, 00C, 00D, 00F |
| `content_queue` | Text content drafts | 00C, 00D |
| `media_assets` | Visual assets (clips, thumbnails, graphics) | 00B, 00F |
| `dead_letters` | Failed events after max retries | System |

### events

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `type` | text NOT NULL | `recording.uploaded`, `transcript.ready` |
| `payload` | jsonb | Event-specific data |
| `status` | text | `pending` → `processing` → `completed` \| `failed` |
| `attempt_count` | integer | Incremented on each retry |
| `last_error` | text | Last failure message |
| `dedupe_key` | text UNIQUE | Optional idempotent insert key |
| `locked_at` | timestamptz | Set when a worker claims the event |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Auto-updated via trigger |

### transcripts

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `file_id` | text NOT NULL | Google Drive file ID |
| `file_name` | text | Original filename |
| `transcript` | text NOT NULL | Full Whisper output |
| `created_at` | timestamptz | |

### event_consumers

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `event_id` | uuid FK → events | |
| `agent_id` | text NOT NULL | `00B`, `00C`, `00D`, `00F` |
| `status` | text | `processing` → `processed` \| `failed` |
| `error` | jsonb | Failure details |
| `created_at` | timestamptz | |

UNIQUE constraint on `(event_id, agent_id)`.

### content_queue

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `transcript_id` | uuid FK → transcripts | |
| `idea_id` | uuid | Optional |
| `agent_id` | text NOT NULL | `00C`, `00D` |
| `type` | text | `linkedin_article`, `blog_post`, `social_post`, `skool_post` |
| `platform` | text | `linkedin`, `blog`, `x`, `instagram`, `skool` |
| `status` | text | Default: `draft` |
| `content` | text NOT NULL | Markdown content |
| `metadata` | jsonb | Agent-specific metadata |
| `created_at` | timestamptz | |

### media_assets

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `transcript_id` | uuid FK → transcripts | |
| `idea_id` | uuid | Optional |
| `agent_id` | text NOT NULL | `00B`, `00F` |
| `type` | text | `clip`, `thumbnail`, `graphic`, `chapter_markers` |
| `status` | text | `draft` → `approved` |
| `content` | jsonb | Type-specific structured data |
| `created_at` | timestamptz | |

### dead_letters

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `source_event_id` | uuid | Original event ID |
| `type` | text | Event type |
| `payload` | jsonb | Original payload |
| `last_error` | text | Final error message |
| `attempt_count` | integer | Total attempts made |
| `created_at` | timestamptz | |

## Deprecated Migration Files

The following files have been consolidated into `001_core.sql` and renamed:

- `001_create_tables_deprecated.sql` — Was: events, transcripts, dead_letters
- `002_content_pipeline_deprecated.sql` — Was: event_consumers, content_queue
- `003_media_assets_deprecated.sql` — Was: media_assets
- `004_event_queue_enhancements_deprecated.sql` — Was: dedupe_key + locked_at on events

These are kept for reference only. Do not run them — `001_core.sql` includes everything.

## Common Mismatch Errors + Fixes

| Error | Cause | Fix |
|---|---|---|
| `relation "events" does not exist` | Migrations not applied | Run `001_core.sql` in SQL Editor |
| `column "dedupe_key" does not exist` | Running old 001 without 004 | Use consolidated `001_core.sql` instead |
| `duplicate key value violates unique constraint` | `dedupe_key` collision | Expected — event already exists (idempotent) |
| `null value in column "type" violates not-null constraint` | Code inserting without type | Check `insertEvent()` call |
| `new row violates check constraint "events_status_check"` | Invalid status string | Only use: pending, processing, completed, failed |
| `db:verify` shows FAIL for a column | Schema drift | Re-run `001_core.sql` (uses IF NOT EXISTS, safe to re-run) |

## Adding New Columns or Tables

1. Add the column/table to `001_core.sql` using `IF NOT EXISTS`
2. Update the TypeScript interface in `src/lib/supabase.ts`
3. Update the `SCHEMA_CONTRACT` in `src/scripts/verify_schema_contract.ts`
4. Run the migration and verify: `npm run db:verify`
