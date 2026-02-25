// ---- Agent 00C: Prompt templates ----

export const OUTLINE_PROMPT = `You are a content strategist. Given a transcript of a video recording, produce a structured outline.

Return ONLY valid JSON matching this exact schema — no markdown fences, no commentary:
{
  "summary": "2-3 sentence summary of the transcript's core message",
  "sections": ["Section 1 title", "Section 2 title", ...],
  "key_points": ["Key insight 1", "Key insight 2", ...]
}

TRANSCRIPT:
{{TRANSCRIPT}}`;

export const LINKEDIN_ARTICLE_PROMPT = `You are an expert LinkedIn ghostwriter. From the following content, write a LinkedIn article.

Requirements:
- 800–1200 words
- Punchy hook in the first line (pattern-interrupt or bold statement)
- Short paragraphs (2–3 sentences max)
- Practical steps the reader can take today
- A "Why this matters" section
- A "Do this next" call-to-action at the end
- Professional but conversational tone

Return ONLY valid JSON matching this exact schema — no markdown fences, no commentary:
{
  "title": "Article title (under 100 chars)",
  "alt_titles": ["Alternative title 1", "Alternative title 2", "Alternative title 3"],
  "content_markdown": "Full article in markdown...",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
  "suggested_publish_window": "Tue/Thu 8–11 AM ET"
}

CONTENT:
{{CONTENT}}`;

export const BLOG_POST_PROMPT = `You are an SEO content writer. From the following content, write a blog post optimized for search.

Requirements:
- Clear H2/H3 heading structure
- "Key Takeaways" section near the top (bullet points)
- Practical, actionable advice throughout
- FAQ section at the end with 3 questions and answers
- Natural keyword usage (not stuffed)
- 1000–1500 words

Return ONLY valid JSON matching this exact schema — no markdown fences, no commentary:
{
  "title": "SEO-friendly blog post title",
  "target_keywords": ["primary keyword", "secondary keyword", "long-tail keyword"],
  "meta_description": "155 chars max meta description for SEO",
  "content_markdown": "Full blog post in markdown with H2/H3 structure..."
}

CONTENT:
{{CONTENT}}`;

export const SOCIAL_POSTS_PROMPT = `You are a social media strategist. From the following content, create 8–12 social media posts.

Requirements:
- Mix of platforms: linkedin, x, instagram
- Mix of styles: insight, contrarian take, question, CTA, quote
- LinkedIn posts: 150–300 words, professional tone
- X posts: under 280 characters, punchy
- Instagram posts: 100–200 words, visual language, include emoji sparingly
- Each post must stand alone (don't reference other posts)
- Include a hook and a CTA for each

Return ONLY a valid JSON array matching this exact schema — no markdown fences, no commentary:
[
  {
    "platform": "linkedin",
    "content": "Full post text...",
    "hook": "The opening line that grabs attention",
    "cta": "What you want the reader to do",
    "suggested_time": "Tue 9:00 AM ET"
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
