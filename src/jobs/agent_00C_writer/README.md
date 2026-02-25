# Agent 00C — Writer

Consumes `transcript.ready` events and generates content drafts:

1. **LinkedIn article** (800-1200 words) — punchy hook, practical steps, CTA
2. **SEO blog post** — H2/H3 structure, key takeaways, FAQ section
3. **Social posts** (8-12 items) — mix of linkedin, x, instagram

## How it works

1. Finds unprocessed `transcript.ready` events via `event_consumers` table
2. Fetches the transcript from `transcripts` table
3. If transcript > 20k chars, generates an outline first
4. Calls GPT-4o for each content type with structured JSON prompts
5. Parses output as strict JSON; retries once if malformed
6. Stores drafts in `content_queue` table
7. Marks `event_consumers` entry as processed

## Idempotency

- Checks `event_consumers` table before processing
- Checks `content_queue` for existing drafts before inserting
- Safe to re-run on the same event

## Run manually

```bash
npm run dev:00c

# Or with a specific transcript ID:
TRANSCRIPT_ID=abc-123 npm run dev:00c
```
