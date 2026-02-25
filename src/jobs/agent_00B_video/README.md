# Agent 00B — Video Processor

Consumes `transcript.ready` events and generates video editing metadata:

1. **Chapter markers** — YouTube-style timestamp chapters based on topic shifts
2. **Short-form clip suggestions** (3-5) — with hooks, timestamps, and platform fit tags

## How it works

1. Finds unprocessed `transcript.ready` events via `event_consumers` table
2. Fetches the transcript from `transcripts` table
3. If transcript > 20k chars, generates a structured video summary first
4. Calls GPT-4o for chapter markers and clip suggestions
5. Stores each output as a row in `media_assets` table (type: chapter_markers / clip)
6. Marks `event_consumers` entry as processed

## Outputs

Stored in `media_assets.content` as JSONB:

- **chapter_markers**: `{ chapters: [{ title, start_time, description }] }`
- **clip**: `{ title, hook, start_time, end_time, reason, platform_fit }`

## Idempotency

- Checks `event_consumers` table before processing
- Checks `media_assets` for existing transcript_id + agent_id + type
- Safe to re-run on the same event

## Run manually

```bash
npm run dev:00b

# Or with a specific transcript ID:
TRANSCRIPT_ID=abc-123 npm run dev:00b
```
