/**
 * Local integration test for Agents 00B, 00C, 00D, 00F.
 * NO Supabase required — uses hardcoded transcript, calls GPT directly.
 *
 * Usage:
 *   npx tsx src/scripts/test_agents_local.ts
 *
 * Tests:
 *   1. Agent 00C: LinkedIn article generation + JSON validation
 *   2. Agent 00C: Blog post generation + JSON validation
 *   3. Agent 00C: Social posts generation + JSON validation
 *   4. Agent 00D: Skool posts generation + JSON validation
 *   5. Agent 00B: Chapter markers generation + JSON validation
 *   6. Agent 00B: Clip suggestions generation + JSON validation
 *   7. Agent 00F: Thumbnail concepts generation + JSON validation
 *   8. Agent 00F: Social graphics generation + JSON validation
 *
 * Requires only OPENAI_API_KEY in .env
 */
import "dotenv/config";
import OpenAI from "openai";
import {
  LINKEDIN_ARTICLE_PROMPT,
  BLOG_POST_PROMPT,
  SOCIAL_POSTS_PROMPT,
  JSON_FIX_PROMPT,
} from "../jobs/agent_00C_writer/prompts";
import { SKOOL_POSTS_PROMPT } from "../jobs/agent_00D_skool/prompts";
import {
  CHAPTER_MARKERS_PROMPT,
  CLIP_SUGGESTIONS_PROMPT,
  JSON_FIX_PROMPT as JSON_FIX_PROMPT_B,
} from "../jobs/agent_00B_video/prompts";
import {
  THUMBNAIL_PROMPT,
  SOCIAL_GRAPHICS_PROMPT,
  JSON_FIX_PROMPT as JSON_FIX_PROMPT_F,
} from "../jobs/agent_00F_graphics/prompts";
import type { LinkedInArticle, BlogPost, SocialPost } from "../jobs/agent_00C_writer/types";
import type { SkoolPost } from "../jobs/agent_00D_skool/types";
import type { ChapterMarkers, ClipSuggestion } from "../jobs/agent_00B_video/types";
import type { ThumbnailConcept, SocialGraphic } from "../jobs/agent_00F_graphics/types";

// ---- Hardcoded test transcript ----
const TEST_TRANSCRIPT = `
So today I want to talk about something that I think a lot of business owners get wrong,
and that's the idea of content repurposing. Most people think content repurposing means
just taking a blog post and turning it into a tweet. But that's not what it is at all.

Content repurposing is about taking one core idea and expressing it in multiple formats
for multiple audiences. Think about it this way: when you record a video like this one,
you've got maybe 20 minutes of raw material. From that single recording, you can extract
a LinkedIn article, three to five social media posts, a blog post with SEO optimization,
and even community posts for your Skool group or membership site.

The key insight here is that each platform has its own language. LinkedIn wants professional
insights with a personal story. Twitter wants punchy one-liners that make people stop
scrolling. Instagram wants visual storytelling. And Skool wants actionable takeaways
that spark discussion.

Here's my three-step framework for content repurposing:

Step one: Record once. Don't overthink it. Just hit record and share your expertise for
15 to 20 minutes. Talk about a problem your audience faces and how you'd solve it.

Step two: Transcribe and extract. Use AI tools to transcribe your recording and pull out
the key themes, frameworks, and quotable moments. This is where the magic happens because
AI can see patterns in your content that you might miss.

Step three: Distribute with intent. Don't just blast the same content everywhere. Tailor
each piece to the platform it's going on. A LinkedIn article should be 800 to 1200 words
with a strong hook and practical steps. A tweet should be under 280 characters and make
one sharp point. A Skool post should end with a discussion question.

The biggest mistake I see is people who record great content and then let it die in one
format. You're leaving so much value on the table. One recording can fuel your entire
content calendar for a week.

Let me give you a real example. Last week I recorded a 15-minute video about pricing
strategies for consultants. From that single video, my team created a LinkedIn article
titled "Why Your Consulting Rates Are Too Low," five social media posts covering different
angles like value-based pricing, competitor analysis, and client psychology. We also
created a blog post targeting the keyword "consulting pricing strategy 2025" and two
Skool posts that generated over 40 comments in our community.

That's the power of systematic content repurposing. You're not creating more content,
you're creating smarter content. And when you have a system for this, you can go from
posting once a week to having a presence on every platform without burning out.

So here's what I want you to do right now: take your last recording, whether it's a
Zoom call, a Loom video, or even a voice memo, and run it through this three-step
framework. I guarantee you'll find at least five pieces of content hiding in there.

If you want to learn more about building a content repurposing system, drop a comment
below or DM me. I'm happy to share more frameworks and templates.
`;

// ---- Helpers ----
let openai: OpenAI;

function getClient(): OpenAI {
  if (openai) return openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("\n[FATAL] OPENAI_API_KEY not set in .env\n");
    process.exit(1);
  }
  openai = new OpenAI({ apiKey });
  return openai;
}

async function callGPT(prompt: string): Promise<string> {
  const client = getClient();
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 4096,
  });
  return res.choices[0]?.message?.content?.trim() || "";
}

function cleanJSON(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  return cleaned;
}

async function parseWithRetry<T>(raw: string, schema: string, fixTemplate: string = JSON_FIX_PROMPT): Promise<T> {
  try {
    return JSON.parse(cleanJSON(raw)) as T;
  } catch {
    console.log("  [RETRY] First JSON parse failed, asking GPT to fix...");
    const fixPrompt = fixTemplate
      .replace("{{SCHEMA}}", schema)
      .replace("{{TEXT}}", raw);
    const fixed = await callGPT(fixPrompt);
    return JSON.parse(cleanJSON(fixed)) as T;
  }
}

// ---- Test runners ----
let passed = 0;
let failed = 0;

function check(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function testLinkedInArticle() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST 1: Agent 00C — LinkedIn Article");
  console.log("═══════════════════════════════════════");

  const prompt = LINKEDIN_ARTICLE_PROMPT.replace("{{CONTENT}}", TEST_TRANSCRIPT);
  console.log("  Calling GPT-4o...");
  const raw = await callGPT(prompt);

  const article = await parseWithRetry<LinkedInArticle>(
    raw,
    '{ "title": "...", "alt_titles": [...], "content_markdown": "...", "hashtags": [...], "suggested_publish_window": "..." }'
  );

  check(typeof article.title === "string" && article.title.length > 0, "title is non-empty string");
  check(Array.isArray(article.alt_titles) && article.alt_titles.length >= 2, "alt_titles has 2+ entries");
  check(typeof article.content_markdown === "string" && article.content_markdown.length > 500, "content_markdown is 500+ chars");
  check(Array.isArray(article.hashtags) && article.hashtags.length >= 3, "hashtags has 3+ entries");
  check(typeof article.suggested_publish_window === "string", "suggested_publish_window is set");

  const wordCount = article.content_markdown.split(/\s+/).length;
  check(wordCount >= 400, `word count >= 400 (got ${wordCount})`);

  console.log("\n  --- PREVIEW ---");
  console.log(`  Title: ${article.title}`);
  console.log(`  Alt titles: ${article.alt_titles.join(" | ")}`);
  console.log(`  Words: ${wordCount}`);
  console.log(`  Hashtags: ${article.hashtags.join(", ")}`);
  console.log(`  Window: ${article.suggested_publish_window}`);
  console.log(`  First 300 chars:\n  ${article.content_markdown.substring(0, 300)}...`);
}

async function testBlogPost() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST 2: Agent 00C — SEO Blog Post");
  console.log("═══════════════════════════════════════");

  const prompt = BLOG_POST_PROMPT.replace("{{CONTENT}}", TEST_TRANSCRIPT);
  console.log("  Calling GPT-4o...");
  const raw = await callGPT(prompt);

  const blog = await parseWithRetry<BlogPost>(
    raw,
    '{ "title": "...", "target_keywords": [...], "meta_description": "...", "content_markdown": "..." }'
  );

  check(typeof blog.title === "string" && blog.title.length > 0, "title is non-empty string");
  check(Array.isArray(blog.target_keywords) && blog.target_keywords.length >= 2, "target_keywords has 2+ entries");
  check(typeof blog.meta_description === "string" && blog.meta_description.length <= 160, `meta_description <= 160 chars (got ${blog.meta_description.length})`);
  check(typeof blog.content_markdown === "string" && blog.content_markdown.length > 500, "content_markdown is 500+ chars");
  check(blog.content_markdown.includes("##"), "content has H2 headings");
  check(blog.content_markdown.toLowerCase().includes("faq") || blog.content_markdown.toLowerCase().includes("question"), "content has FAQ section");

  console.log("\n  --- PREVIEW ---");
  console.log(`  Title: ${blog.title}`);
  console.log(`  Keywords: ${blog.target_keywords.join(", ")}`);
  console.log(`  Meta: ${blog.meta_description}`);
  console.log(`  Length: ${blog.content_markdown.length} chars`);
}

async function testSocialPosts() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST 3: Agent 00C — Social Posts");
  console.log("═══════════════════════════════════════");

  const prompt = SOCIAL_POSTS_PROMPT.replace("{{CONTENT}}", TEST_TRANSCRIPT);
  console.log("  Calling GPT-4o...");
  const raw = await callGPT(prompt);

  const posts = await parseWithRetry<SocialPost[]>(
    raw,
    '[{ "platform": "...", "content": "...", "hook": "...", "cta": "...", "suggested_time": "..." }]'
  );

  check(Array.isArray(posts), "result is an array");
  check(posts.length >= 8, `8+ posts generated (got ${posts.length})`);

  const platforms = new Set(posts.map((p) => p.platform));
  check(platforms.has("linkedin"), "has linkedin posts");
  check(platforms.has("x"), "has x (twitter) posts");
  check(platforms.has("instagram"), "has instagram posts");

  for (const post of posts) {
    check(typeof post.content === "string" && post.content.length > 0, `${post.platform} post has content`);
    check(typeof post.hook === "string", `${post.platform} post has hook`);
    check(typeof post.cta === "string", `${post.platform} post has CTA`);
  }

  console.log("\n  --- PREVIEW (first 3) ---");
  for (const p of posts.slice(0, 3)) {
    console.log(`  [${p.platform}] ${p.hook.substring(0, 80)}...`);
    console.log(`    CTA: ${p.cta}`);
    console.log(`    Time: ${p.suggested_time}`);
    console.log();
  }
}

async function testSkoolPosts() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST 4: Agent 00D — Skool Posts");
  console.log("═══════════════════════════════════════");

  const prompt = SKOOL_POSTS_PROMPT.replace("{{CONTENT}}", TEST_TRANSCRIPT);
  console.log("  Calling GPT-4o...");
  const raw = await callGPT(prompt);

  const posts = await parseWithRetry<SkoolPost[]>(
    raw,
    '[{ "title": "...", "content_markdown": "...", "discussion_question": "...", "suggested_time": "..." }]'
  );

  check(Array.isArray(posts), "result is an array");
  check(posts.length >= 2 && posts.length <= 3, `2-3 posts generated (got ${posts.length})`);

  for (let i = 0; i < posts.length; i++) {
    const sp = posts[i];
    check(typeof sp.title === "string" && sp.title.length > 0, `post ${i + 1} has title`);
    check(typeof sp.content_markdown === "string" && sp.content_markdown.length > 100, `post ${i + 1} has substantial content`);
    check(typeof sp.discussion_question === "string" && sp.discussion_question.length > 0, `post ${i + 1} has discussion question`);
    check(typeof sp.suggested_time === "string", `post ${i + 1} has suggested_time`);
  }

  console.log("\n  --- PREVIEW ---");
  for (const sp of posts) {
    console.log(`  Title: ${sp.title}`);
    console.log(`  Question: ${sp.discussion_question}`);
    console.log(`  Time: ${sp.suggested_time}`);
    console.log(`  Content length: ${sp.content_markdown.length} chars`);
    console.log();
  }
}

async function testChapterMarkers() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST 5: Agent 00B — Chapter Markers");
  console.log("═══════════════════════════════════════");

  const prompt = CHAPTER_MARKERS_PROMPT.replace("{{CONTENT}}", TEST_TRANSCRIPT);
  console.log("  Calling GPT-4o...");
  const raw = await callGPT(prompt);

  const result = await parseWithRetry<ChapterMarkers>(
    raw,
    '{ "chapters": [{ "title": "...", "start_time": "00:00", "description": "..." }] }',
    JSON_FIX_PROMPT_B
  );

  check(result.chapters !== undefined && Array.isArray(result.chapters), "chapters is an array");
  check(result.chapters.length >= 4, `4+ chapters generated (got ${result.chapters.length})`);
  check(result.chapters[0].start_time === "00:00", "first chapter starts at 00:00");

  for (let i = 0; i < result.chapters.length; i++) {
    const ch = result.chapters[i];
    check(typeof ch.title === "string" && ch.title.length > 0, `chapter ${i + 1} has title`);
    check(typeof ch.start_time === "string" && ch.start_time.includes(":"), `chapter ${i + 1} has valid timestamp`);
    check(typeof ch.description === "string" && ch.description.length > 0, `chapter ${i + 1} has description`);
  }

  console.log("\n  --- PREVIEW ---");
  for (const ch of result.chapters) {
    console.log(`  [${ch.start_time}] ${ch.title}`);
    console.log(`    ${ch.description}`);
  }
}

async function testClipSuggestions() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST 6: Agent 00B — Clip Suggestions");
  console.log("═══════════════════════════════════════");

  const prompt = CLIP_SUGGESTIONS_PROMPT.replace("{{CONTENT}}", TEST_TRANSCRIPT);
  console.log("  Calling GPT-4o...");
  const raw = await callGPT(prompt);

  const clips = await parseWithRetry<ClipSuggestion[]>(
    raw,
    '[{ "title": "...", "hook": "...", "start_time": "...", "end_time": "...", "reason": "...", "platform_fit": [...] }]',
    JSON_FIX_PROMPT_B
  );

  check(Array.isArray(clips), "result is an array");
  check(clips.length >= 3 && clips.length <= 5, `3-5 clips generated (got ${clips.length})`);

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    check(typeof clip.title === "string" && clip.title.length > 0, `clip ${i + 1} has title`);
    check(typeof clip.hook === "string" && clip.hook.length > 0, `clip ${i + 1} has hook`);
    check(typeof clip.start_time === "string" && clip.start_time.includes(":"), `clip ${i + 1} has start_time`);
    check(typeof clip.end_time === "string" && clip.end_time.includes(":"), `clip ${i + 1} has end_time`);
    check(typeof clip.reason === "string" && clip.reason.length > 0, `clip ${i + 1} has reason`);
    check(Array.isArray(clip.platform_fit) && clip.platform_fit.length > 0, `clip ${i + 1} has platform_fit`);
  }

  console.log("\n  --- PREVIEW ---");
  for (const clip of clips) {
    console.log(`  [${clip.start_time}-${clip.end_time}] ${clip.title}`);
    console.log(`    Hook: ${clip.hook.substring(0, 80)}...`);
    console.log(`    Platforms: ${clip.platform_fit.join(", ")}`);
    console.log();
  }
}

async function testThumbnails() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST 7: Agent 00F — Thumbnail Concepts");
  console.log("═══════════════════════════════════════");

  const prompt = THUMBNAIL_PROMPT.replace("{{CONTENT}}", TEST_TRANSCRIPT);
  console.log("  Calling GPT-4o...");
  const raw = await callGPT(prompt);

  const thumbnails = await parseWithRetry<ThumbnailConcept[]>(
    raw,
    '[{ "headline": "...", "subtext": "...", "emotion": "...", "visual_direction": "...", "color_notes": "...", "why_it_works": "..." }]',
    JSON_FIX_PROMPT_F
  );

  check(Array.isArray(thumbnails), "result is an array");
  check(thumbnails.length === 3, `exactly 3 thumbnails generated (got ${thumbnails.length})`);

  for (let i = 0; i < thumbnails.length; i++) {
    const th = thumbnails[i];
    check(typeof th.headline === "string" && th.headline.length > 0, `thumbnail ${i + 1} has headline`);
    check(typeof th.subtext === "string" && th.subtext.length > 0, `thumbnail ${i + 1} has subtext`);
    check(typeof th.emotion === "string" && th.emotion.length > 0, `thumbnail ${i + 1} has emotion`);
    check(typeof th.visual_direction === "string" && th.visual_direction.length > 0, `thumbnail ${i + 1} has visual_direction`);
    check(typeof th.color_notes === "string" && th.color_notes.length > 0, `thumbnail ${i + 1} has color_notes`);
    check(typeof th.why_it_works === "string" && th.why_it_works.length > 0, `thumbnail ${i + 1} has why_it_works`);
  }

  console.log("\n  --- PREVIEW ---");
  for (const th of thumbnails) {
    console.log(`  "${th.headline}" — ${th.emotion}`);
    console.log(`    Subtext: ${th.subtext}`);
    console.log(`    Colors: ${th.color_notes}`);
    console.log();
  }
}

async function testSocialGraphics() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST 8: Agent 00F — Social Graphics");
  console.log("═══════════════════════════════════════");

  const prompt = SOCIAL_GRAPHICS_PROMPT.replace("{{CONTENT}}", TEST_TRANSCRIPT);
  console.log("  Calling GPT-4o...");
  const raw = await callGPT(prompt);

  const graphics = await parseWithRetry<SocialGraphic[]>(
    raw,
    '[{ "type": "quote_card|stat_card|insight_card", "text": "...", "visual_direction": "...", "platform": "linkedin|instagram", "why_it_works": "..." }]',
    JSON_FIX_PROMPT_F
  );

  check(Array.isArray(graphics), "result is an array");
  check(graphics.length >= 5, `5+ graphics generated (got ${graphics.length})`);

  const validTypes = ["quote_card", "stat_card", "insight_card"];
  const validPlatforms = ["linkedin", "instagram"];

  for (let i = 0; i < graphics.length; i++) {
    const g = graphics[i];
    check(validTypes.includes(g.type), `graphic ${i + 1} has valid type (${g.type})`);
    check(typeof g.text === "string" && g.text.length > 0, `graphic ${i + 1} has text`);
    check(typeof g.visual_direction === "string" && g.visual_direction.length > 0, `graphic ${i + 1} has visual_direction`);
    check(validPlatforms.includes(g.platform), `graphic ${i + 1} has valid platform (${g.platform})`);
    check(typeof g.why_it_works === "string" && g.why_it_works.length > 0, `graphic ${i + 1} has why_it_works`);
  }

  const byType: Record<string, number> = {};
  for (const g of graphics) byType[g.type] = (byType[g.type] || 0) + 1;

  console.log("\n  --- PREVIEW ---");
  console.log(`  Breakdown: ${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  for (const g of graphics.slice(0, 3)) {
    console.log(`  [${g.type}] (${g.platform}) ${g.text.substring(0, 80)}...`);
    console.log();
  }
}

// ---- Main ----
async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Agent 00B+00C+00D+00F — Local Integration Test  ║");
  console.log("║  NO Supabase required — GPT only                 ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\nUsing transcript: ${TEST_TRANSCRIPT.length} chars`);
  console.log("Model: gpt-4o");

  const startTime = Date.now();

  try {
    await testLinkedInArticle();
  } catch (err) {
    console.error(`\n  ✗ LinkedIn article test CRASHED: ${err instanceof Error ? err.message : err}`);
    failed++;
  }

  try {
    await testBlogPost();
  } catch (err) {
    console.error(`\n  ✗ Blog post test CRASHED: ${err instanceof Error ? err.message : err}`);
    failed++;
  }

  try {
    await testSocialPosts();
  } catch (err) {
    console.error(`\n  ✗ Social posts test CRASHED: ${err instanceof Error ? err.message : err}`);
    failed++;
  }

  try {
    await testSkoolPosts();
  } catch (err) {
    console.error(`\n  ✗ Skool posts test CRASHED: ${err instanceof Error ? err.message : err}`);
    failed++;
  }

  try {
    await testChapterMarkers();
  } catch (err) {
    console.error(`\n  ✗ Chapter markers test CRASHED: ${err instanceof Error ? err.message : err}`);
    failed++;
  }

  try {
    await testClipSuggestions();
  } catch (err) {
    console.error(`\n  ✗ Clip suggestions test CRASHED: ${err instanceof Error ? err.message : err}`);
    failed++;
  }

  try {
    await testThumbnails();
  } catch (err) {
    console.error(`\n  ✗ Thumbnails test CRASHED: ${err instanceof Error ? err.message : err}`);
    failed++;
  }

  try {
    await testSocialGraphics();
  } catch (err) {
    console.error(`\n  ✗ Social graphics test CRASHED: ${err instanceof Error ? err.message : err}`);
    failed++;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n╔══════════════════════════════════════════╗");
  console.log(`║  Results: ${passed} passed, ${failed} failed (${elapsed}s)     ║`);
  console.log("╚══════════════════════════════════════════╝");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
