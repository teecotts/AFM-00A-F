# Agent 00F — Thumbnail & Graphics Generator

Consumes `transcript.ready` events and generates visual creative direction:

1. **3 Thumbnail concepts** — headlines, emotions, visual direction, color notes
2. **5-10 Social graphic concepts** — quote cards, stat cards, insight cards

## How it works

1. Finds unprocessed `transcript.ready` events via `event_consumers` table
2. Fetches the transcript from `transcripts` table
3. If transcript > 20k chars, generates a visual summary first
4. Calls GPT-4o for thumbnail concepts and social graphic concepts
5. Stores each output as a row in `media_assets` table (type: thumbnail / graphic)
6. Marks `event_consumers` entry as processed

## Outputs

Stored in `media_assets.content` as JSONB:

- **thumbnail**: `{ headline, subtext, emotion, visual_direction, color_notes, why_it_works }`
- **graphic**: `{ type, text, visual_direction, platform, why_it_works }`

## Idempotency

- Checks `event_consumers` table before processing
- Checks `media_assets` for existing transcript_id + agent_id + type
- Safe to re-run on the same event

## Run manually

```bash
npm run dev:00f

# Or with a specific transcript ID:
TRANSCRIPT_ID=abc-123 npm run dev:00f
```
