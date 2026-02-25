/**
 * End-to-End Smoke Test — Full Pipeline
 *
 * Verifies Supabase connectivity, enqueues events, runs all agents,
 * and confirms outputs land in the correct tables.
 *
 * Env flags:
 *   TEST_MODE=1   — bypass Drive/Whisper; inserts a dummy transcript directly
 *   CLEANUP=1     — delete all test rows when done (uses test_run_id tag)
 *
 * Usage:
 *   TEST_MODE=1 npx tsx src/scripts/smoke_full_pipeline.ts
 *   TEST_MODE=1 CLEANUP=1 npx tsx src/scripts/smoke_full_pipeline.ts
 *   npm run test:smoke
 */
import "dotenv/config";
import {
  validateSupabaseEnv,
  getSupabaseAdmin,
  insertTranscript,
  EventRow,
} from "../lib/supabase";
import { enqueueEvent } from "../lib/eventQueue";
import { run as runAgent00B } from "../jobs/agent_00B_video/index";
import { run as runAgent00C } from "../jobs/agent_00C_writer/index";
import { run as runAgent00D } from "../jobs/agent_00D_skool/index";
import { run as runAgent00F } from "../jobs/agent_00F_graphics/index";

// ── Config ────────────────────────────────────────────────────────
const TEST_MODE = process.env.TEST_MODE === "1";
const CLEANUP = process.env.CLEANUP === "1";
const TEST_RUN_ID = `smoke_${Date.now()}`;

const DUMMY_TRANSCRIPT = `
Welcome to today's session. We're going to talk about three really important things
when it comes to building a business online.

First, let's discuss audience building. The key insight here is that consistency
beats virality every single time. You want to show up every day with value.
That's how you build trust. That's how you build a following that actually converts.

Second, let's talk about monetization. Too many creators wait too long to monetize.
You don't need a million followers. You need a thousand true fans. Start with a
simple offer — coaching, a digital product, a community. Test it early.

Third, content repurposing. Every long-form piece you create should become ten
short-form pieces. A podcast becomes tweets, LinkedIn posts, Instagram carousels,
Skool discussions, and blog articles. That's how you scale without burning out.

So to recap: build your audience consistently, monetize early with a simple offer,
and repurpose everything. These three pillars will transform your content business.
`.trim();

// ── Helpers ───────────────────────────────────────────────────────
interface StepResult {
  step: string;
  passed: boolean;
  detail: string;
}

const results: StepResult[] = [];

function pass(step: string, detail: string) {
  results.push({ step, passed: true, detail });
  console.log(`  ✓ ${step} — ${detail}`);
}

function fail(step: string, detail: string) {
  results.push({ step, passed: false, detail });
  console.log(`  ✗ ${step} — ${detail}`);
}

// Track IDs for cleanup
const cleanupIds: {
  events: string[];
  transcripts: string[];
  content_queue: string[];
  media_assets: string[];
  event_consumers: string[];
  dead_letters: string[];
} = {
  events: [],
  transcripts: [],
  content_queue: [],
  media_assets: [],
  event_consumers: [],
  dead_letters: [],
};

// ── Step 1: Supabase connectivity ─────────────────────────────────
async function stepConnectivity(): Promise<boolean> {
  try {
    validateSupabaseEnv();
    const sb = getSupabaseAdmin();

    // Verify we can reach the DB by selecting from events
    const { error } = await sb.from("events").select("id").limit(0);
    if (error) throw error;

    pass("Supabase connectivity", "Connected OK");
    return true;
  } catch (err) {
    fail("Supabase connectivity", `${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// ── Step 2: Table existence ───────────────────────────────────────
async function stepTableCheck(): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const tables = [
    "events",
    "transcripts",
    "event_consumers",
    "content_queue",
    "media_assets",
    "dead_letters",
  ];
  let allOk = true;

  for (const table of tables) {
    const { error } = await sb.from(table).select("id").limit(0);
    if (error) {
      fail(`Table ${table}`, `Not accessible: ${error.message}`);
      allOk = false;
    }
  }

  if (allOk) {
    pass("Table check", `All ${tables.length} tables accessible`);
  }
  return allOk;
}

// ── Step 3: Enqueue recording.uploaded ────────────────────────────
async function stepEnqueueRecording(): Promise<EventRow | null> {
  try {
    const dedupeKey = `smoke:recording:${TEST_RUN_ID}`;
    const event = await enqueueEvent(
      "recording.uploaded",
      {
        file_id: `smoke_file_${TEST_RUN_ID}`,
        file_name: `smoke_test_${TEST_RUN_ID}.mp4`,
        test_run_id: TEST_RUN_ID,
      },
      dedupeKey
    );
    cleanupIds.events.push(event.id);
    pass("Enqueue recording.uploaded", `Event ${event.id}`);
    return event;
  } catch (err) {
    fail("Enqueue recording.uploaded", `${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// ── Step 4: Insert dummy transcript (TEST_MODE only) ──────────────
async function stepInsertTranscript(): Promise<string | null> {
  try {
    const transcript = await insertTranscript(
      `smoke_file_${TEST_RUN_ID}`,
      `smoke_test_${TEST_RUN_ID}.mp4`,
      DUMMY_TRANSCRIPT
    );
    cleanupIds.transcripts.push(transcript.id);
    pass("Insert dummy transcript", `Transcript ${transcript.id}`);
    return transcript.id;
  } catch (err) {
    fail("Insert dummy transcript", `${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// ── Step 5: Enqueue transcript.ready ──────────────────────────────
async function stepEnqueueTranscriptReady(
  transcriptId: string
): Promise<EventRow | null> {
  try {
    const dedupeKey = `smoke:transcript.ready:${TEST_RUN_ID}`;
    const event = await enqueueEvent(
      "transcript.ready",
      {
        transcript_id: transcriptId,
        test_run_id: TEST_RUN_ID,
      },
      dedupeKey
    );
    cleanupIds.events.push(event.id);
    pass("Enqueue transcript.ready", `Event ${event.id}`);
    return event;
  } catch (err) {
    fail("Enqueue transcript.ready", `${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// ── Step 6: Run downstream agents ─────────────────────────────────
interface AgentRunSummary {
  agent: string;
  passed: boolean;
  detail: string;
}

async function stepRunAgents(
  transcriptReadyEvent: EventRow
): Promise<AgentRunSummary[]> {
  const agents = [
    { name: "00B (Video)", fn: runAgent00B },
    { name: "00C (Writer)", fn: runAgent00C },
    { name: "00D (Skool)", fn: runAgent00D },
    { name: "00F (Graphics)", fn: runAgent00F },
  ];

  const summaries: AgentRunSummary[] = [];

  // Run agents in parallel
  const settled = await Promise.allSettled(
    agents.map(async (a) => {
      const result = await a.fn(transcriptReadyEvent);
      return { name: a.name, result };
    })
  );

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      const { name, result } = outcome.value;
      const hasError = "error" in result && result.error;

      if (hasError) {
        fail(`Agent ${name}`, `Error: ${result.error}`);
        summaries.push({ agent: name, passed: false, detail: `${result.error}` });
      } else {
        const detail = formatAgentResult(name, result as unknown as Record<string, unknown>);
        pass(`Agent ${name}`, detail);
        summaries.push({ agent: name, passed: true, detail });
      }
    } else {
      const name = agents[settled.indexOf(outcome)].name;
      fail(`Agent ${name}`, `Exception: ${outcome.reason}`);
      summaries.push({
        agent: name,
        passed: false,
        detail: `${outcome.reason}`,
      });
    }
  }

  return summaries;
}

function formatAgentResult(name: string, result: Record<string, unknown>): string {
  if (name.startsWith("00B")) {
    return `assets=${result.assetsCreated}, clips=${result.clipsCreated}, skipped=${result.skippedDuplicate}`;
  }
  if (name.startsWith("00C")) {
    return `drafts=${result.draftsCreated}, skipped=${result.skippedDuplicate}`;
  }
  if (name.startsWith("00D")) {
    return `drafts=${result.draftsCreated}, skipped=${result.skippedDuplicate}`;
  }
  if (name.startsWith("00F")) {
    return `thumbnails=${result.thumbnailsCreated}, graphics=${result.graphicsCreated}, skipped=${result.skippedDuplicate}`;
  }
  return JSON.stringify(result);
}

// ── Step 7: Verify DB outputs ─────────────────────────────────────
async function stepVerifyOutputs(transcriptId: string): Promise<void> {
  const sb = getSupabaseAdmin();

  // Check content_queue
  const { data: drafts, error: draftErr } = await sb
    .from("content_queue")
    .select("id, agent_id, type, platform")
    .eq("transcript_id", transcriptId);

  if (draftErr) {
    fail("Verify content_queue", `Query error: ${draftErr.message}`);
  } else if (!drafts || drafts.length === 0) {
    fail("Verify content_queue", "No drafts found");
  } else {
    cleanupIds.content_queue.push(...drafts.map((d) => d.id));
    const agents = [...new Set(drafts.map((d) => d.agent_id))].sort();
    pass(
      "Verify content_queue",
      `${drafts.length} drafts from agents: ${agents.join(", ")}`
    );
  }

  // Check media_assets
  const { data: assets, error: assetErr } = await sb
    .from("media_assets")
    .select("id, agent_id, type")
    .eq("transcript_id", transcriptId);

  if (assetErr) {
    fail("Verify media_assets", `Query error: ${assetErr.message}`);
  } else if (!assets || assets.length === 0) {
    fail("Verify media_assets", "No assets found");
  } else {
    cleanupIds.media_assets.push(...assets.map((a) => a.id));
    const agents = [...new Set(assets.map((a) => a.agent_id))].sort();
    pass(
      "Verify media_assets",
      `${assets.length} assets from agents: ${agents.join(", ")}`
    );
  }

  // Check event_consumers
  const { data: consumers, error: consErr } = await sb
    .from("event_consumers")
    .select("id, agent_id, status")
    .in(
      "event_id",
      cleanupIds.events
    );

  if (consErr) {
    fail("Verify event_consumers", `Query error: ${consErr.message}`);
  } else if (!consumers || consumers.length === 0) {
    fail("Verify event_consumers", "No consumer records found");
  } else {
    cleanupIds.event_consumers.push(...consumers.map((c) => c.id));
    const processed = consumers.filter((c) => c.status === "processed").length;
    const failed = consumers.filter((c) => c.status === "failed").length;
    pass(
      "Verify event_consumers",
      `${consumers.length} records (${processed} processed, ${failed} failed)`
    );
  }
}

// ── Cleanup ───────────────────────────────────────────────────────
async function cleanup(): Promise<void> {
  console.log("\n  Cleaning up test data...");
  const sb = getSupabaseAdmin();

  // Delete in dependency order (children first)
  const deleteOrder: [string, string[]][] = [
    ["event_consumers", cleanupIds.event_consumers],
    ["content_queue", cleanupIds.content_queue],
    ["media_assets", cleanupIds.media_assets],
    ["dead_letters", []], // check for any dead letters from our events
    ["events", cleanupIds.events],
    ["transcripts", cleanupIds.transcripts],
  ];

  for (const [table, ids] of deleteOrder) {
    if (ids.length === 0) continue;
    const { error } = await sb.from(table).delete().in("id", ids);
    if (error) {
      console.log(`    ⚠ Failed to clean ${table}: ${error.message}`);
    } else {
      console.log(`    ✓ Cleaned ${table}: ${ids.length} rows`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Smoke Test — Full Pipeline                      ║");
  console.log(`║  TEST_MODE=${TEST_MODE ? "1" : "0"}  CLEANUP=${CLEANUP ? "1" : "0"}  run=${TEST_RUN_ID.slice(-13)}  ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");

  if (!TEST_MODE) {
    console.log(
      "NOTE: TEST_MODE is off. This will attempt real Drive/Whisper calls via Agent 00A.\n" +
        "      Set TEST_MODE=1 to use a dummy transcript instead.\n"
    );
  }

  const startTime = Date.now();

  // Step 1: Connectivity
  console.log("── Step 1: Supabase Connectivity ──");
  const connected = await stepConnectivity();
  if (!connected) {
    printReport(startTime);
    process.exit(1);
  }

  // Step 2: Table check
  console.log("\n── Step 2: Table Check ──");
  const tablesOk = await stepTableCheck();
  if (!tablesOk) {
    printReport(startTime);
    process.exit(1);
  }

  // Step 3: Enqueue recording.uploaded
  console.log("\n── Step 3: Enqueue recording.uploaded ──");
  const recordingEvent = await stepEnqueueRecording();
  if (!recordingEvent) {
    printReport(startTime);
    process.exit(1);
  }

  let transcriptId: string | null = null;
  let transcriptReadyEvent: EventRow | null = null;

  if (TEST_MODE) {
    // Step 4: Insert dummy transcript
    console.log("\n── Step 4: Insert Dummy Transcript (TEST_MODE) ──");
    transcriptId = await stepInsertTranscript();
    if (!transcriptId) {
      printReport(startTime);
      process.exit(1);
    }

    // Step 5: Enqueue transcript.ready
    console.log("\n── Step 5: Enqueue transcript.ready ──");
    transcriptReadyEvent = await stepEnqueueTranscriptReady(transcriptId);
    if (!transcriptReadyEvent) {
      printReport(startTime);
      process.exit(1);
    }
  } else {
    console.log("\n── Step 4-5: Skipped (TEST_MODE=0, would run Agent 00A) ──");
    console.log("  Non-test mode is not yet supported in smoke test.");
    printReport(startTime);
    process.exit(1);
  }

  // Step 6: Run downstream agents
  console.log("\n── Step 6: Run Agents (00B, 00C, 00D, 00F) ──");
  await stepRunAgents(transcriptReadyEvent!);

  // Step 7: Verify DB outputs
  console.log("\n── Step 7: Verify DB Outputs ──");
  await stepVerifyOutputs(transcriptId!);

  // Cleanup
  if (CLEANUP) {
    await cleanup();
  }

  // Report
  printReport(startTime);
}

function printReport(startTime: number) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  const allPassed = failed === 0;

  console.log(`\n${"═".repeat(52)}`);
  console.log(
    allPassed
      ? `  RESULT: ALL ${passed}/${total} CHECKS PASSED  (${elapsed}s)`
      : `  RESULT: ${failed}/${total} CHECKS FAILED  (${elapsed}s)`
  );
  console.log("═".repeat(52));

  if (!allPassed) {
    console.log("\nFailed checks:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ✗ ${r.step}: ${r.detail}`);
    }
  }

  if (!CLEANUP && cleanupIds.events.length > 0) {
    console.log(
      `\nTest data left in DB (run_id: ${TEST_RUN_ID}).` +
        "\nRe-run with CLEANUP=1 to delete, or delete manually."
    );
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
