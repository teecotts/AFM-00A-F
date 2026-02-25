/**
 * Full pipeline test — NO Supabase required.
 *
 * Real Google Drive → Real Whisper → Real GPT-4o → Local JSON files
 *
 * What it does:
 *   1. Connects to your Google Drive folder (real service account)
 *   2. Lists video files, picks the most recent one
 *   3. Downloads it to /tmp
 *   4. Transcribes via OpenAI Whisper (real API call)
 *   5. Feeds transcript to Agent 00C (LinkedIn + blog + social)
 *   6. Feeds transcript to Agent 00D (Skool posts)
 *   7. Feeds transcript to Agent 00B (chapter markers + clips)
 *   8. Feeds transcript to Agent 00F (thumbnails + social graphics)
 *   9. Saves ALL output to ./test_output/ as JSON files
 *
 * Usage:
 *   npx tsx src/scripts/test_full_pipeline_local.ts
 *
 * Requires in .env:
 *   - GOOGLE_SERVICE_ACCOUNT_KEY_PATH (or GOOGLE_SERVICE_ACCOUNT_JSON)
 *   - GOOGLE_DRIVE_FOLDER_ID
 *   - OPENAI_API_KEY
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";
import { listNewVideoFiles, downloadFile, getFileMetadata } from "../lib/drive";
import { transcribeFile } from "../lib/openai";
import {
  LINKEDIN_ARTICLE_PROMPT,
  BLOG_POST_PROMPT,
  SOCIAL_POSTS_PROMPT,
  JSON_FIX_PROMPT as FIX_PROMPT_C,
} from "../jobs/agent_00C_writer/prompts";
import { SKOOL_POSTS_PROMPT, JSON_FIX_PROMPT as FIX_PROMPT_D } from "../jobs/agent_00D_skool/prompts";
import {
  CHAPTER_MARKERS_PROMPT,
  CLIP_SUGGESTIONS_PROMPT,
  JSON_FIX_PROMPT as FIX_PROMPT_B,
} from "../jobs/agent_00B_video/prompts";
import {
  THUMBNAIL_PROMPT,
  SOCIAL_GRAPHICS_PROMPT,
  JSON_FIX_PROMPT as FIX_PROMPT_F,
} from "../jobs/agent_00F_graphics/prompts";
import type { LinkedInArticle, BlogPost, SocialPost } from "../jobs/agent_00C_writer/types";
import type { SkoolPost } from "../jobs/agent_00D_skool/types";
import type { ChapterMarkers, ClipSuggestion } from "../jobs/agent_00B_video/types";
import type { ThumbnailConcept, SocialGraphic } from "../jobs/agent_00F_graphics/types";

// ---- Config ----
const OUTPUT_DIR = path.join(process.cwd(), "test_output");
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

// ---- Helpers ----
function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error("\n[FATAL] OPENAI_API_KEY not set\n"); process.exit(1); }
  return new OpenAI({ apiKey });
}

async function callGPT(prompt: string): Promise<string> {
  const client = getOpenAI();
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 4096,
  });
  return res.choices[0]?.message?.content?.trim() || "";
}

function cleanJSON(raw: string): string {
  let c = raw.trim();
  if (c.startsWith("```")) c = c.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  return c;
}

async function parseWithRetry<T>(raw: string, schema: string, fixPrompt: string): Promise<T> {
  try {
    return JSON.parse(cleanJSON(raw)) as T;
  } catch {
    console.log("    ⟳ JSON parse failed, retrying with fix prompt...");
    const fixed = await callGPT(fixPrompt.replace("{{SCHEMA}}", schema).replace("{{TEXT}}", raw));
    return JSON.parse(cleanJSON(fixed)) as T;
  }
}

function saveJSON(filename: string, data: unknown) {
  const filePath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  ✓ Saved: ${filePath}`);
}

function step(num: number, label: string) {
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  STEP ${num}: ${label}`);
  console.log("═".repeat(50));
}

// ---- Main ----
async function main() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  FULL PIPELINE TEST — No Supabase Required    ║");
  console.log("║  Drive → Whisper → GPT-4o → Local JSON Files  ║");
  console.log("╚═══════════════════════════════════════════════╝");

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const startTime = Date.now();

  // ──────────────────────────────────────────
  // STEP 1: List files from Google Drive
  // ──────────────────────────────────────────
  step(1, "Connect to Google Drive & list video files");

  let files;
  try {
    files = await listNewVideoFiles();
  } catch (err) {
    console.error(`\n  ✗ Drive connection failed: ${err instanceof Error ? err.message : err}`);
    console.error("  Check your GOOGLE_SERVICE_ACCOUNT_KEY_PATH and GOOGLE_DRIVE_FOLDER_ID");
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("\n  ⚠ No video files found in Drive folder (last 7 days).");
    console.log("  Drop a short test video into your folder and try again.");
    process.exit(0);
  }

  console.log(`\n  Found ${files.length} video file(s):\n`);
  for (const f of files) {
    const sizeMB = (parseInt(f.size || "0", 10) / 1024 / 1024).toFixed(1);
    console.log(`    ${f.name}  (${sizeMB} MB)  ${f.createdTime}`);
  }

  // Pick the most recent file
  const target = files[0];
  console.log(`\n  → Using: ${target.name}`);

  saveJSON("01_drive_listing.json", files);

  // ──────────────────────────────────────────
  // STEP 2: Check file size
  // ──────────────────────────────────────────
  step(2, "Check file size");

  const meta = await getFileMetadata(target.id);
  const sizeMB = (meta.size / 1024 / 1024).toFixed(1);
  console.log(`\n  File: ${meta.name}`);
  console.log(`  Size: ${sizeMB} MB`);
  console.log(`  Type: ${meta.mimeType}`);

  if (meta.size > MAX_FILE_SIZE) {
    console.error(`\n  ✗ File too large (${sizeMB} MB). Max is 200 MB.`);
    process.exit(1);
  }
  console.log("  ✓ Size OK");

  // ──────────────────────────────────────────
  // STEP 3: Download from Drive
  // ──────────────────────────────────────────
  step(3, "Download file from Google Drive");

  let tmpPath: string;
  try {
    tmpPath = await downloadFile(target.id, target.name);
    const localSize = fs.statSync(tmpPath).size;
    console.log(`\n  ✓ Downloaded to: ${tmpPath}`);
    console.log(`  ✓ Local size: ${(localSize / 1024 / 1024).toFixed(1)} MB`);
  } catch (err) {
    console.error(`\n  ✗ Download failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // ──────────────────────────────────────────
  // STEP 4: Transcribe with Whisper
  // ──────────────────────────────────────────
  step(4, "Transcribe with OpenAI Whisper");
  console.log("\n  Sending to Whisper API (this may take a minute)...");

  let transcript: string;
  try {
    transcript = await transcribeFile(tmpPath);
    console.log(`\n  ✓ Transcription complete`);
    console.log(`  ✓ Length: ${transcript.length} chars / ${transcript.split(/\s+/).length} words`);
    console.log(`\n  --- First 500 chars ---`);
    console.log(`  ${transcript.substring(0, 500)}...`);

    saveJSON("02_transcript.json", {
      file_id: target.id,
      file_name: target.name,
      transcript_length: transcript.length,
      transcript,
    });
  } catch (err) {
    console.error(`\n  ✗ Transcription failed: ${err instanceof Error ? err.message : err}`);
    // Clean up temp file
    try { fs.unlinkSync(tmpPath); } catch {}
    process.exit(1);
  }

  // Clean up downloaded file
  try { fs.unlinkSync(tmpPath); console.log(`\n  ✓ Temp file cleaned up`); } catch {}

  // ──────────────────────────────────────────
  // STEP 5: Agent 00C — LinkedIn Article
  // ──────────────────────────────────────────
  step(5, "Agent 00C → LinkedIn Article");
  console.log("\n  Calling GPT-4o...");

  try {
    const raw = await callGPT(LINKEDIN_ARTICLE_PROMPT.replace("{{CONTENT}}", transcript));
    const article = await parseWithRetry<LinkedInArticle>(
      raw,
      '{ "title", "alt_titles", "content_markdown", "hashtags", "suggested_publish_window" }',
      FIX_PROMPT_C
    );
    const wc = article.content_markdown.split(/\s+/).length;
    console.log(`\n  ✓ Title: ${article.title}`);
    console.log(`  ✓ ${wc} words, ${article.hashtags.length} hashtags`);
    saveJSON("03_linkedin_article.json", article);
  } catch (err) {
    console.error(`  ✗ LinkedIn article failed: ${err instanceof Error ? err.message : err}`);
  }

  // ──────────────────────────────────────────
  // STEP 6: Agent 00C — Blog Post
  // ──────────────────────────────────────────
  step(6, "Agent 00C → SEO Blog Post");
  console.log("\n  Calling GPT-4o...");

  try {
    const raw = await callGPT(BLOG_POST_PROMPT.replace("{{CONTENT}}", transcript));
    const blog = await parseWithRetry<BlogPost>(
      raw,
      '{ "title", "target_keywords", "meta_description", "content_markdown" }',
      FIX_PROMPT_C
    );
    console.log(`\n  ✓ Title: ${blog.title}`);
    console.log(`  ✓ Keywords: ${blog.target_keywords.join(", ")}`);
    console.log(`  ✓ Meta: ${blog.meta_description}`);
    saveJSON("04_blog_post.json", blog);
  } catch (err) {
    console.error(`  ✗ Blog post failed: ${err instanceof Error ? err.message : err}`);
  }

  // ──────────────────────────────────────────
  // STEP 7: Agent 00C — Social Posts
  // ──────────────────────────────────────────
  step(7, "Agent 00C → Social Posts");
  console.log("\n  Calling GPT-4o...");

  try {
    const raw = await callGPT(SOCIAL_POSTS_PROMPT.replace("{{CONTENT}}", transcript));
    const posts = await parseWithRetry<SocialPost[]>(
      raw,
      '[{ "platform", "content", "hook", "cta", "suggested_time" }]',
      FIX_PROMPT_C
    );
    const byPlatform: Record<string, number> = {};
    for (const p of posts) byPlatform[p.platform] = (byPlatform[p.platform] || 0) + 1;
    console.log(`\n  ✓ ${posts.length} posts generated`);
    console.log(`  ✓ Breakdown: ${Object.entries(byPlatform).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
    saveJSON("05_social_posts.json", posts);
  } catch (err) {
    console.error(`  ✗ Social posts failed: ${err instanceof Error ? err.message : err}`);
  }

  // ──────────────────────────────────────────
  // STEP 8: Agent 00D — Skool Posts
  // ──────────────────────────────────────────
  step(8, "Agent 00D → Skool Posts");
  console.log("\n  Calling GPT-4o...");

  try {
    const raw = await callGPT(SKOOL_POSTS_PROMPT.replace("{{CONTENT}}", transcript));
    const posts = await parseWithRetry<SkoolPost[]>(
      raw,
      '[{ "title", "content_markdown", "discussion_question", "suggested_time" }]',
      FIX_PROMPT_D
    );
    console.log(`\n  ✓ ${posts.length} Skool posts generated`);
    for (const p of posts) {
      console.log(`    - ${p.title}`);
      console.log(`      Q: ${p.discussion_question}`);
    }
    saveJSON("06_skool_posts.json", posts);
  } catch (err) {
    console.error(`  ✗ Skool posts failed: ${err instanceof Error ? err.message : err}`);
  }

  // ──────────────────────────────────────────
  // STEP 9: Agent 00B — Chapter Markers + Clips
  // ──────────────────────────────────────────
  step(9, "Agent 00B → Chapter Markers");
  console.log("\n  Calling GPT-4o...");

  try {
    const raw = await callGPT(CHAPTER_MARKERS_PROMPT.replace("{{CONTENT}}", transcript));
    const chapters = await parseWithRetry<ChapterMarkers>(
      raw,
      '{ "chapters": [{ "title": "...", "start_time": "00:00", "description": "..." }] }',
      FIX_PROMPT_B
    );
    console.log(`\n  ✓ ${chapters.chapters.length} chapters generated`);
    for (const ch of chapters.chapters) {
      console.log(`    [${ch.start_time}] ${ch.title}`);
    }
    saveJSON("07_chapter_markers.json", chapters);
  } catch (err) {
    console.error(`  ✗ Chapter markers failed: ${err instanceof Error ? err.message : err}`);
  }

  step(9, "Agent 00B → Clip Suggestions");
  console.log("\n  Calling GPT-4o...");

  try {
    const raw = await callGPT(CLIP_SUGGESTIONS_PROMPT.replace("{{CONTENT}}", transcript));
    const clips = await parseWithRetry<ClipSuggestion[]>(
      raw,
      '[{ "title": "...", "hook": "...", "start_time": "...", "end_time": "...", "reason": "...", "platform_fit": [...] }]',
      FIX_PROMPT_B
    );
    console.log(`\n  ✓ ${clips.length} clip suggestions generated`);
    for (const clip of clips) {
      console.log(`    [${clip.start_time}-${clip.end_time}] ${clip.title}`);
      console.log(`      Platforms: ${clip.platform_fit.join(", ")}`);
    }
    saveJSON("08_clip_suggestions.json", clips);
  } catch (err) {
    console.error(`  ✗ Clip suggestions failed: ${err instanceof Error ? err.message : err}`);
  }

  // ──────────────────────────────────────────
  // STEP 10: Agent 00F — Thumbnails + Social Graphics
  // ──────────────────────────────────────────
  step(10, "Agent 00F → Thumbnail Concepts");
  console.log("\n  Calling GPT-4o...");

  try {
    const raw = await callGPT(THUMBNAIL_PROMPT.replace("{{CONTENT}}", transcript));
    const thumbnails = await parseWithRetry<ThumbnailConcept[]>(
      raw,
      '[{ "headline": "...", "subtext": "...", "emotion": "...", "visual_direction": "...", "color_notes": "...", "why_it_works": "..." }]',
      FIX_PROMPT_F
    );
    console.log(`\n  ✓ ${thumbnails.length} thumbnail concepts generated`);
    for (const th of thumbnails) {
      console.log(`    "${th.headline}" — ${th.emotion}`);
      console.log(`      ${th.visual_direction.substring(0, 80)}...`);
    }
    saveJSON("09_thumbnails.json", thumbnails);
  } catch (err) {
    console.error(`  ✗ Thumbnails failed: ${err instanceof Error ? err.message : err}`);
  }

  step(10, "Agent 00F → Social Graphics");
  console.log("\n  Calling GPT-4o...");

  try {
    const raw = await callGPT(SOCIAL_GRAPHICS_PROMPT.replace("{{CONTENT}}", transcript));
    const graphics = await parseWithRetry<SocialGraphic[]>(
      raw,
      '[{ "type": "quote_card|stat_card|insight_card", "text": "...", "visual_direction": "...", "platform": "linkedin|instagram", "why_it_works": "..." }]',
      FIX_PROMPT_F
    );
    const byType: Record<string, number> = {};
    for (const g of graphics) byType[g.type] = (byType[g.type] || 0) + 1;
    console.log(`\n  ✓ ${graphics.length} social graphics generated`);
    console.log(`  ✓ Breakdown: ${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
    saveJSON("10_social_graphics.json", graphics);
  } catch (err) {
    console.error(`  ✗ Social graphics failed: ${err instanceof Error ? err.message : err}`);
  }

  // ──────────────────────────────────────────
  // DONE
  // ──────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  console.log(`\n${"═".repeat(50)}`);
  console.log("  PIPELINE COMPLETE");
  console.log("═".repeat(50));
  console.log(`\n  Total time: ${elapsed}s`);
  console.log(`  All output saved to: ${OUTPUT_DIR}/`);
  console.log(`\n  Files:`);

  const outputFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith(".json")).sort();
  for (const f of outputFiles) {
    const size = fs.statSync(path.join(OUTPUT_DIR, f)).size;
    console.log(`    ${f}  (${(size / 1024).toFixed(1)} KB)`);
  }

  console.log(`\n  Open any JSON file to review the generated content.`);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
