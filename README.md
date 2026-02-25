# Agent 00A — Content Factory: Drive Polling + Whisper Transcription Pipeline

Event-driven pipeline that watches a Google Drive folder for new Loom video recordings, transcribes them using OpenAI Whisper, and stores results in Supabase.

## Architecture

```
Google Drive folder
       │ (poll every 60s)
       ▼
  ┌──────────┐    recording.uploaded     ┌────────────────┐
  │  Poller  │ ──────────────────────►  │   Supabase     │
  └──────────┘                           │   events table │
                                         └───────┬────────┘
                                                  │ (claim pending)
                                                  ▼
                                         ┌────────────────┐
                                         │   Worker       │
                                         │  1. Download   │
                                         │  2. Whisper    │
                                         │  3. Store      │
                                         └───────┬────────┘
                                                  │
                                     ┌────────────┼────────────┐
                                     ▼            ▼            ▼
                              transcripts   transcript.    dead_letters
                                table      ready event     (if retries
                                                           exhausted)
```

## Setup

### 1. Prerequisites

- Node.js 18+
- A Supabase project
- A Google Cloud project with Drive API enabled
- An OpenAI API key with Whisper access

### 2. Supabase Database

Run the migration in your Supabase SQL editor:

```sql
-- Copy contents of supabase/migrations/001_create_tables.sql
```

Or via Supabase CLI:

```bash
supabase db push
```

### 3. Google Drive Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) > IAM & Admin > Service Accounts.
2. Create a service account (e.g., `agent-00a@yourproject.iam.gserviceaccount.com`).
3. Create a JSON key for the service account and download it.
4. Enable the **Google Drive API** in your project.
5. **Share the target Google Drive folder** with the service account email (Viewer access is sufficient).
6. Copy the folder ID from the Drive URL: `https://drive.google.com/drive/folders/<FOLDER_ID>`.

### 4. Environment Variables

```bash
cp .env.example .env
```

Fill in:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (not anon key) |
| `GOOGLE_DRIVE_FOLDER_ID` | The Drive folder ID to watch |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON key as a string (for Vercel) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Path to JSON key file (for local dev) |
| `OPENAI_API_KEY` | OpenAI API key |

Optional:

| Variable | Default | Description |
|---|---|---|
| `MAX_RETRIES` | `3` | Max attempts before dead-lettering |
| `POLL_INTERVAL_MS` | `60000` | Poll interval for local runners (ms) |
| `MAX_FILE_SIZE_BYTES` | `209715200` | Max file size (200MB) |
| `LOG_LEVEL` | `info` | Minimum log level: debug/info/warn/error |

### 5. Install Dependencies

```bash
npm install
```

## Running Locally

Start both the poller and worker in separate terminals:

```bash
# Terminal 1: Poll Google Drive every 60s
npm run dev:poller

# Terminal 2: Process transcription events every 60s
npm run dev:worker
```

## Deploying to Vercel

### 1. Link Project

```bash
npx vercel link
```

### 2. Set Environment Variables

```bash
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add GOOGLE_DRIVE_FOLDER_ID
vercel env add GOOGLE_SERVICE_ACCOUNT_JSON
vercel env add OPENAI_API_KEY
```

### 3. Deploy

```bash
vercel --prod
```

### 4. Scheduling (External)

The pipeline endpoints are plain HTTP routes — no Vercel Cron is configured, so this deploys cleanly on the **Hobby plan**.

To run them on a schedule, use an external scheduler to hit these URLs every 60 seconds:

| Endpoint | Purpose |
|---|---|
| `GET /api/poll-drive` | Check Drive for new files |
| `GET /api/run-worker` | Process one pending transcription event |
| `GET /api/run-content-writer` | Dispatch transcripts to content agents |

**Recommended external schedulers:**
- [Upstash QStash](https://upstash.com/docs/qstash) (free tier, easiest)
- [cron-job.org](https://cron-job.org) (free)
- GitHub Actions (scheduled workflow)
- Cloudflare Workers (cron triggers)

> **Upgrading to Vercel Pro?** Re-add a `"crons"` key to `vercel.json` to use native Vercel Cron instead.

### 5. Manual Testing

After deploying, test each endpoint:

```bash
curl https://your-app.vercel.app/api/poll-drive
curl https://your-app.vercel.app/api/run-worker
```

Both return JSON:

```json
{
  "ok": true,
  "filesFound": 2,
  "eventsCreated": 1,
  "skippedDuplicate": 1,
  "errors": []
}
```

## Running Tests

```bash
npm test
```

## Project Structure

```
├── api/
│   ├── poll-drive.ts          # Vercel endpoint: one poll iteration
│   └── run-worker.ts          # Vercel endpoint: process one event
├── src/
│   ├── lib/
│   │   ├── supabase.ts        # Supabase client + event/transcript helpers
│   │   ├── drive.ts           # Google Drive API: list files, download
│   │   ├── openai.ts          # OpenAI Whisper transcription
│   │   └── logger.ts          # Structured JSON logger
│   ├── jobs/
│   │   ├── pollDrive.ts       # Poll logic: list files → insert events
│   │   └── transcribeWorker.ts # Worker: download → transcribe → store
│   ├── scripts/
│   │   ├── runPoller.ts       # Local runner: poller on interval
│   │   └── runWorker.ts       # Local runner: worker on interval
│   └── tests/
│       └── run.ts             # Test suite
├── supabase/
│   └── migrations/
│       └── 001_create_tables.sql  # Database schema
├── .env.example
├── vercel.json                # Serverless function config
├── tsconfig.json
└── package.json
```

## Event Flow

1. **Poller** lists video files from Drive (last 7 days).
2. For each new file, inserts a `recording.uploaded` event (idempotent — skips duplicates).
3. **Worker** atomically claims a pending `recording.uploaded` event.
4. Downloads the file to `/tmp`, sends to Whisper, stores the transcript.
5. Emits a `transcript.ready` event for downstream consumers.
6. On failure: retries up to 3 times, then dead-letters the event.

## Key Design Decisions

- **Polling over webhooks**: Simpler to deploy, no public endpoint required for Drive, works on Vercel.
- **Atomic claim**: Worker uses `status = 'pending'` as an optimistic lock to prevent double-processing.
- **Idempotency**: Poller checks for existing events by `file_id` before inserting.
- **Dead letters**: Failed events after max retries are preserved for investigation.
- **Structured logging**: JSON log lines for easy parsing in cloud environments.
