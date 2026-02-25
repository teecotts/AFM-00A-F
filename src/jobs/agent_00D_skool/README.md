# Agent 00D — Skool Writer

Consumes `transcript.ready` events and generates 2-3 Skool community posts.

## Output format

Each post contains:
- Title
- Summary paragraph
- Bullet-point takeaways
- Action step
- Discussion question to spark engagement

## How it works

1. Finds unprocessed `transcript.ready` events via `event_consumers` table
2. Fetches the transcript from `transcripts` table
3. If transcript > 20k chars, generates an outline first
4. Calls GPT-4o with structured JSON prompt
5. Parses output as strict JSON; retries once if malformed
6. Stores each post as a row in `content_queue` (type: skool_post, platform: skool)
7. Marks `event_consumers` entry as processed

## Idempotency

- Checks `event_consumers` table before processing
- Checks `content_queue` for existing drafts before inserting
- Safe to re-run on the same event

## Run manually

```bash
npm run dev:00d

# Or with a specific transcript ID:
TRANSCRIPT_ID=abc-123 npm run dev:00d
```
