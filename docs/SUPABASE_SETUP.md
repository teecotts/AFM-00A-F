# Supabase Setup Guide

## 1. Environment Variables

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Required variables:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → `service_role` key (secret) |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → `anon` / `public` key |

**Important:** `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS policies. Never expose it in client/browser code.

## 2. Apply Migrations

Run each migration file in order against your Supabase database. You can use the Supabase SQL Editor (Dashboard → SQL Editor) or the CLI.

### Option A: Supabase Dashboard (SQL Editor)

1. Go to your project → **SQL Editor**
2. Paste and run each file in order:
   - `supabase/migrations/001_create_tables.sql` — events, transcripts, dead_letters
   - `supabase/migrations/002_content_pipeline.sql` — event_consumers, content_queue
   - `supabase/migrations/003_media_assets.sql` — media_assets
   - `supabase/migrations/004_event_queue_enhancements.sql` — dedupe_key + locked_at on events

### Option B: Supabase CLI

```bash
# Link to your project (one-time)
supabase link --project-ref <your-project-ref>

# Push migrations
supabase db push
```

## 3. Tables Overview

After migrations, you'll have these tables:

| Table | Purpose |
|---|---|
| `events` | Central event bus — recording.uploaded, transcript.ready, etc. |
| `transcripts` | Whisper transcription output |
| `event_consumers` | Tracks which agent has processed which event |
| `content_queue` | Text content drafts (LinkedIn, blog, social, Skool) |
| `media_assets` | Visual assets (clips, thumbnails, graphics, chapters) |
| `dead_letters` | Failed events after max retries |

## 4. Enqueue a Test Event

Insert a sample `recording.uploaded` event to verify your Supabase connection:

```bash
npm run dev:enqueue
```

Or with a custom file ID:

```bash
npx tsx src/scripts/enqueueTestEvent.ts my-file-id-123
```

You should see the event appear in the `events` table with status `pending`.

## 5. Run Agent 00A Worker

Process the test event with the Agent 00A worker:

```bash
# Single cycle (process one event and exit)
npm run dev:00A

# Or poll mode (process events on interval)
npx tsx agents/00A/worker.ts --poll
```

The worker will:
1. Claim the next pending `recording.uploaded` event
2. Download the file from Google Drive
3. Transcribe with OpenAI Whisper
4. Store the transcript in Supabase
5. Enqueue a `transcript.ready` event (with dedupe key)
6. Mark the original event as done

## 6. Run Downstream Agents

Once a `transcript.ready` event exists, the content writer dispatches it to all agents:

```bash
# Run all agents (00B, 00C, 00D, 00F) against pending events
npm run dev:content-writer

# Or run individual agents
npm run dev:00b   # Video processor (chapters + clips)
npm run dev:00c   # Writer (LinkedIn + blog + social)
npm run dev:00d   # Skool posts
npm run dev:00f   # Thumbnails + graphics
```

## 7. Verify in Dashboard

Check the Supabase Table Editor to see:
- `events` — should show your event transitioning pending → processing → completed
- `transcripts` — should contain the Whisper output
- `event_consumers` — shows which agents processed which events
- `content_queue` — text content drafts from 00C and 00D
- `media_assets` — visual assets from 00B and 00F

## 8. Troubleshooting

| Issue | Fix |
|---|---|
| "Missing SUPABASE_URL" | Set `SUPABASE_URL` in `.env` |
| "Invalid SUPABASE_URL" | Make sure URL starts with `https://` |
| Event stuck in `processing` | Check `locked_at` — may need manual reset to `pending` |
| Event in `dead_letters` | Exhausted retries (default: 3). Check `last_error` for details |
| Duplicate events | Use `dedupe_key` when calling `enqueueEvent()` |
