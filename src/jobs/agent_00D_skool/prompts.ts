// ---- Agent 00D: Prompt templates ----

export const OUTLINE_PROMPT = `You are a content strategist. Given a transcript of a video recording, produce a structured outline.

Return ONLY valid JSON matching this exact schema — no markdown fences, no commentary:
{
  "summary": "2-3 sentence summary of the transcript's core message",
  "sections": ["Section 1 title", "Section 2 title", ...],
  "key_points": ["Key insight 1", "Key insight 2", ...]
}

TRANSCRIPT:
{{TRANSCRIPT}}`;

export const SKOOL_POSTS_PROMPT = `You are a community engagement expert writing posts for a Skool community. From the following content, create 2–3 Skool community posts.

Requirements for each post:
- A clear, engaging title
- A brief summary paragraph (2–3 sentences)
- 3–5 bullet points with actionable takeaways
- An action prompt telling the reader what to do right now
- A discussion question to spark engagement in the comments
- Tone: knowledgeable but approachable, like a mentor sharing wisdom
- Each post should cover a different angle/subtopic from the content

CRITICAL: You MUST return ONLY a valid JSON array. No markdown fences. No commentary.
Every object MUST have exactly these 4 keys — do NOT rename or omit any:

"title" — the post title
"content_markdown" — the full post body in markdown
"discussion_question" — a question ending with ? to spark comments
"suggested_time" — e.g. "Thu 3:00 PM ET"

Example:
[
  {
    "title": "Post title that sparks curiosity",
    "content_markdown": "## Summary\n\nBrief summary...\n\n## Key Takeaways\n\n- Bullet 1\n- Bullet 2\n- Bullet 3\n\n## Action Step\n\nWhat to do right now...",
    "discussion_question": "What's your experience with...?",
    "suggested_time": "Thu 3:00 PM ET"
  }
]

CONTENT:
{{CONTENT}}`;

export const JSON_FIX_PROMPT = `The following text was supposed to be valid JSON matching a specific schema, but it's malformed.
Fix it so it is valid JSON. Return ONLY the corrected JSON — no explanation, no markdown fences.

EXPECTED SCHEMA:
{{SCHEMA}}

MALFORMED TEXT:
{{TEXT}}`;
