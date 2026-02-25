// ---- Agent 00F: Prompt templates ----

export const VISUAL_SUMMARY_PROMPT = `You are a visual content strategist. Given a transcript, extract the most visually compelling elements.

Return ONLY valid JSON matching this exact schema — no markdown fences, no commentary:
{
  "core_message": "1-2 sentence summary of the video's main point",
  "key_moments": ["Moment 1", "Moment 2", ...],
  "high_emotion_sections": ["Emotionally charged section description", ...],
  "contrarian_statements": ["Bold or surprising claim", ...]
}

TRANSCRIPT:
{{TRANSCRIPT}}`;

export const THUMBNAIL_PROMPT = `You are a YouTube thumbnail strategist. Based on the following content, generate 3 thumbnail concepts.

Each thumbnail should:
- Have a bold headline (max 5 words, ALL CAPS works)
- Include subtext for context
- Specify the dominant emotion to convey (curiosity, shock, excitement, etc.)
- Give art direction for the visual layout
- Include color notes (default brand: Yellow/Black)
- Explain why this thumbnail will get clicks

CRITICAL: Return ONLY a valid JSON array with exactly 3 objects. No markdown fences. No commentary.
Every object MUST have exactly these 6 keys:

"headline" — bold text overlay (max 5 words)
"subtext" — supporting text
"emotion" — primary emotion to convey
"visual_direction" — layout and visual instructions
"color_notes" — color palette guidance
"why_it_works" — click psychology explanation

Example:
[
  {
    "headline": "STOP DOING THIS",
    "subtext": "The mistake killing your sales",
    "emotion": "shock",
    "visual_direction": "Speaker pointing at camera, split screen with X mark on common mistake",
    "color_notes": "Yellow/Black brand, red accent for the X",
    "why_it_works": "Pattern interrupt with negative framing creates curiosity gap"
  }
]

CONTENT:
{{CONTENT}}`;

export const SOCIAL_GRAPHICS_PROMPT = `You are a social media graphic designer strategist. From the following content, create 5-10 social graphic concepts.

Types to mix:
- quote_card: A powerful quote or statement from the content
- stat_card: A number, percentage, or data point made visual
- insight_card: A key insight or framework visualized

For each graphic:
- Specify the type
- Write the exact text to appear on the graphic
- Give visual direction (layout, style, imagery)
- Tag the target platform: linkedin or instagram
- Explain why it will perform well

CRITICAL: Return ONLY a valid JSON array. No markdown fences. No commentary.
Every object MUST have exactly these 5 keys:

"type" — one of: quote_card, stat_card, insight_card
"text" — exact text for the graphic
"visual_direction" — design instructions
"platform" — linkedin or instagram
"why_it_works" — engagement psychology

Example:
[
  {
    "type": "quote_card",
    "text": "One recording can fuel your entire content calendar for a week.",
    "visual_direction": "Bold white text on dark gradient, speaker headshot in corner, brand yellow accent bar",
    "platform": "linkedin",
    "why_it_works": "Aspirational statement that makes the reader want to learn the method"
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
