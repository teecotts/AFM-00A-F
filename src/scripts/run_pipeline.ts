/**
 * Single-Command Pipeline Runner
 *
 * Runs the entire pipeline for the MOST RECENTLY UPLOADED video:
 *   Step 1 — Poll Drive for new video files
 *   Step 2 — Pick & transcribe the newest pending recording
 *   Step 3 — Run content agents (00B, 00C, 00D, 00F)
 *   Step 4 — Query DB for outputs and save JSON to test_output/
 *   Step 5 — Print summary report
 *
 * Usage:
 *   npm run pipeline
 *   npx tsx src/scripts/run_pipeline.ts
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  validateSupabaseEnv,
  getSupabaseAdmin,
  insertTranscript,
  insertEvent,
  markEventCompleted,
  markEventFailed,
  EventRow,
} from "../lib/supabase";
import { pollDrive, PollResult } from "../jobs/pollDrive";
import { downloadFile, getFileMetadata } from "../lib/drive";
import { transcribeFile } from "../lib/openai";
import { run as run00B } from "../jobs/agent_00B_video/index";
import { run as run00C } from "../jobs/agent_00C_writer/index";
import { run as run00D } from "../jobs/agent_00D_skool/index";
import { run as run00F } from "../jobs/agent_00F_graphics/index";

// ── Config ────────────────────────────────────────────────────────
const OUTPUT_DIR = path.join(process.cwd(), "test_output");
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_BYTES || "209715200", 10);
const startTime = Date.now();

// ── Helpers ───────────────────────────────────────────────────────
function saveJSON(filename: string, data: unknown) {
  const filePath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`    -> ${filename}`);
}

function clearOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    return;
  }
  const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    fs.unlinkSync(path.join(OUTPUT_DIR, f));
  }
}

function elapsed(): string {
  return ((Date.now() - startTime) / 1000).toFixed(1);
}

// ── Tracking ──────────────────────────────────────────────────────
let pollResult: PollResult | null = null;
let transcriptId: string | null = null;
let fileName: string | null = null;
const agentResults: Record<string, { items: number; error: string | null }> = {};

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Muggles Content Factory — Pipeline Run              ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // Pre-flight
  try {
    validateSupabaseEnv();
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("events").select("id").limit(0);
    if (error) throw error;
    console.log("  ✓ Supabase connected");
  } catch (err) {
    console.log(`  ✗ Supabase: ${err instanceof Error ? err.message : err}`);
    printReport(true);
    return;
  }

  // Clear test_output/
  clearOutputDir();
  console.log("  ✓ test_output/ cleared\n");

  const sb = getSupabaseAdmin();

  // ── Step 1: Poll Drive ────────────────────────────────────────
  console.log("── Step 1: Poll Google Drive ──");
  try {
    pollResult = await pollDrive();
    console.log(
      `  ✓ Found ${pollResult.filesFound} files — ` +
        `${pollResult.eventsCreated} new, ${pollResult.skippedDuplicate} already queued`
    );
    if (pollResult.errors.length > 0) {
      console.log(`  ⚠ Errors: ${pollResult.errors.join("; ")}`);
    }
  } catch (err) {
    console.log(`  ✗ Poll failed: ${err instanceof Error ? err.message : err}`);
    printReport(true);
    return;
  }

  // ── Step 2: Pick newest pending recording ─────────────────────
  console.log("\n── Step 2: Pick & Transcribe Newest Recording ──");

  // Find the most recently created pending recording.uploaded event
  const { data: newestEvents, error: findErr } = await sb
    .from("events")
    .select("*")
    .eq("type", "recording.uploaded")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);

  if (findErr) {
    console.log(`  ✗ Query failed: ${findErr.message}`);
    printReport(true);
    return;
  }

  if (!newestEvents || newestEvents.length === 0) {
    console.log("  – No pending recordings to process");
    console.log("    (all Drive files already transcribed)\n");
    printReport(false);
    return;
  }

  const event = newestEvents[0] as EventRow;
  const payload = event.payload as {
    file_id: string;
    file_name: string;
    created_time?: string;
    size?: string;
  };
  fileName = payload.file_name;
  console.log(`  ✓ Selected: ${payload.file_name}`);

  // Claim it atomically
  const { data: claimed, error: claimErr } = await sb
    .from("events")
    .update({ status: "processing", locked_at: new Date().toISOString() })
    .eq("id", event.id)
    .eq("status", "pending")
    .select()
    .single();

  if (claimErr || !claimed) {
    console.log(`  ✗ Failed to claim event (race condition?)`);
    printReport(true);
    return;
  }

  // Save poll result
  saveJSON("01_drive_poll.json", {
    event_id: claimed.id,
    file_id: payload.file_id,
    file_name: payload.file_name,
    poll_summary: {
      files_found: pollResult!.filesFound,
      events_created: pollResult!.eventsCreated,
      skipped_duplicate: pollResult!.skippedDuplicate,
    },
  });

  // ── Step 3: Transcribe ────────────────────────────────────────
  let tmpPath: string | null = null;
  let transcriptReadyEvent: EventRow | null = null;

  try {
    // Check file size
    const meta = await getFileMetadata(payload.file_id);
    if (meta.size > MAX_FILE_SIZE) {
      const msg = `File too large: ${meta.size} bytes (max ${MAX_FILE_SIZE})`;
      console.log(`  ✗ ${msg}`);
      await markEventFailed(claimed.id, msg, claimed.attempt_count);
      printReport(true);
      return;
    }
    console.log(`  ✓ File size OK (${(meta.size / 1024 / 1024).toFixed(1)} MB)`);

    // Download
    console.log(`  ⏳ Downloading from Drive...`);
    tmpPath = await downloadFile(payload.file_id, payload.file_name);
    console.log(`  ✓ Downloaded to ${tmpPath}`);

    // Transcribe
    console.log(`  ⏳ Transcribing with Whisper...`);
    const transcriptText = await transcribeFile(tmpPath);
    console.log(`  ✓ Transcribed (${transcriptText.length} chars)`);

    // Store transcript
    const transcript = await insertTranscript(
      payload.file_id,
      payload.file_name,
      transcriptText
    );
    transcriptId = transcript.id;
    console.log(`  ✓ Transcript stored: ${transcript.id}`);

    // Save transcript JSON
    saveJSON("02_transcript.json", {
      id: transcript.id,
      file_id: transcript.file_id,
      file_name: transcript.file_name,
      transcript_length: transcript.transcript.length,
      transcript: transcript.transcript,
    });

    // Emit transcript.ready
    transcriptReadyEvent = await insertEvent("transcript.ready", {
      transcript_id: transcript.id,
      file_id: payload.file_id,
      file_name: payload.file_name,
    });

    // Mark recording event completed
    await markEventCompleted(claimed.id);
    console.log(`  ✓ Event completed, transcript.ready emitted`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ Transcription failed: ${msg}`);
    try {
      await markEventFailed(claimed.id, msg, claimed.attempt_count);
    } catch {}
    printReport(true);
    return;
  } finally {
    if (tmpPath) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }
  }

  // ── Step 4: Run content agents ────────────────────────────────
  console.log("\n── Step 3: Run Content Agents (00B, 00C, 00D, 00F) ──");

  const agents = [
    { name: "00B Video", key: "00B", fn: run00B },
    { name: "00C Writer", key: "00C", fn: run00C },
    { name: "00D Skool", key: "00D", fn: run00D },
    { name: "00F Graphics", key: "00F", fn: run00F },
  ];

  const settled = await Promise.allSettled(
    agents.map(async (a) => {
      const result = await a.fn(transcriptReadyEvent!);
      return { ...a, result };
    })
  );

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      const { name, key, result } = outcome.value;
      const r = result as unknown as Record<string, unknown>;
      const items = getItemCount(key, r);
      const error = r.error as string | null;

      agentResults[key] = { items, error };

      if (error) {
        console.log(`  ✗ ${name}: ${error}`);
      } else {
        console.log(`  ✓ ${name}: ${items} items created`);
      }
    } else {
      const idx = settled.indexOf(outcome);
      const a = agents[idx];
      const errMsg = String(outcome.reason);
      agentResults[a.key] = { items: 0, error: errMsg };
      console.log(`  ✗ ${a.name}: ${errMsg}`);
    }
  }

  // ── Step 5: Query DB for outputs and save JSON ────────────────
  console.log("\n── Step 4: Save Output JSON Files ──");
  console.log(`  Querying DB for transcript ${transcriptId}...`);

  await saveOutputFiles(sb, transcriptId!);

  // Save summary
  saveJSON("11_pipeline_summary.json", {
    run_time: `${elapsed()}s`,
    file_name: fileName,
    transcript_id: transcriptId,
    poll: {
      files_found: pollResult!.filesFound,
      events_created: pollResult!.eventsCreated,
    },
    agents: agentResults,
  });

  // ── Report ────────────────────────────────────────────────────
  console.log();
  printReport(false);
}

function getItemCount(key: string, r: Record<string, unknown>): number {
  if (key === "00B") return (r.assetsCreated as number) + (r.clipsCreated as number);
  if (key === "00C") return r.draftsCreated as number;
  if (key === "00D") return r.draftsCreated as number;
  if (key === "00F") return (r.thumbnailsCreated as number) + (r.graphicsCreated as number);
  return 0;
}

async function saveOutputFiles(
  sb: ReturnType<typeof getSupabaseAdmin>,
  tId: string
) {
  // 03 — LinkedIn article
  const { data: linkedin } = await sb
    .from("content_queue")
    .select("*")
    .eq("transcript_id", tId)
    .eq("type", "linkedin_article");
  if (linkedin?.length) saveJSON("03_linkedin_article.json", linkedin[0]);

  // 04 — Blog post
  const { data: blog } = await sb
    .from("content_queue")
    .select("*")
    .eq("transcript_id", tId)
    .eq("type", "blog_post");
  if (blog?.length) saveJSON("04_blog_post.json", blog[0]);

  // 05 — Social posts
  const { data: social } = await sb
    .from("content_queue")
    .select("*")
    .eq("transcript_id", tId)
    .eq("type", "social_post");
  if (social?.length) saveJSON("05_social_posts.json", social);

  // 06 — Skool posts
  const { data: skool } = await sb
    .from("content_queue")
    .select("*")
    .eq("transcript_id", tId)
    .eq("type", "skool_post");
  if (skool?.length) saveJSON("06_skool_posts.json", skool);

  // 07 — Chapter markers
  const { data: chapters } = await sb
    .from("media_assets")
    .select("*")
    .eq("transcript_id", tId)
    .eq("type", "chapter_markers");
  if (chapters?.length) saveJSON("07_chapter_markers.json", chapters[0]);

  // 08 — Clip suggestions
  const { data: clips } = await sb
    .from("media_assets")
    .select("*")
    .eq("transcript_id", tId)
    .eq("type", "clip");
  if (clips?.length) saveJSON("08_clip_suggestions.json", clips);

  // 09 — Thumbnails
  const { data: thumbs } = await sb
    .from("media_assets")
    .select("*")
    .eq("transcript_id", tId)
    .eq("type", "thumbnail");
  if (thumbs?.length) saveJSON("09_thumbnails.json", thumbs);

  // 10 — Social graphics
  const { data: graphics } = await sb
    .from("media_assets")
    .select("*")
    .eq("transcript_id", tId)
    .eq("type", "graphic");
  if (graphics?.length) saveJSON("10_social_graphics.json", graphics);
}

function printReport(hasErrors: boolean) {
  const sec = elapsed();

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Pipeline Report                                     ║");
  console.log("╠══════════════════════════════════════════════════════╣");

  if (fileName) {
    console.log(`║  File:  ${fileName}`);
  }

  if (pollResult) {
    console.log(
      `║  Drive:  ${pollResult.filesFound} files, ${pollResult.eventsCreated} new`
    );
  }

  if (transcriptId) {
    console.log(`║  Transcript:  ${transcriptId}`);
  }

  const agentKeys = Object.keys(agentResults);
  if (agentKeys.length > 0) {
    const totalItems = agentKeys.reduce((s, k) => s + agentResults[k].items, 0);
    const errorCount = agentKeys.filter((k) => agentResults[k].error).length;
    console.log(`║  Content:  ${totalItems} items, ${errorCount} errors`);
    for (const k of agentKeys) {
      const r = agentResults[k];
      const tag = r.error ? "✗" : "✓";
      console.log(`║    ${tag} ${k}: ${r.items} items${r.error ? ` — ${r.error}` : ""}`);
    }
  }

  // Check for any agent errors
  const anyAgentError = agentKeys.some((k) => agentResults[k].error);

  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(
    hasErrors || anyAgentError
      ? `║  STATUS: COMPLETED WITH ERRORS  (${sec}s)`
      : `║  STATUS: ALL OK  (${sec}s)`
  );
  console.log("╚══════════════════════════════════════════════════════╝");

  if (transcriptId) {
    console.log(`\nOutput files saved to: ${OUTPUT_DIR}/`);
  }

  process.exit(hasErrors || anyAgentError ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
