// ---- Agent 00B: Prompt templates ----

export const VIDEO_SUMMARY_PROMPT = `You are a video content analyst. Given a transcript, produce a structured summary for video editing.

Return ONLY valid JSON matching this exact schema — no markdown fences, no commentary:
{
  "core_message": "1-2 sentence summary of the video's main point",
  "key_moments": ["Moment 1 description", "Moment 2 description", ...],
  "high_emotion_sections": ["Section where speaker shows strong emotion or energy", ...],
  "contrarian_statements": ["Any bold or surprising claims the speaker makes", ...]
}

TRANSCRIPT:
{{TRANSCRIPT}}`;

export const CHAPTER_MARKERS_PROMPT = `You are a video editor creating YouTube-style chapter markers. Analyze the transcript and identify natural topic shifts.

Rules:
- First chapter always starts at 00:00
- Each chapter covers a distinct topic or subtopic
- Titles should be concise (3-7 words) and descriptive
- Estimate timestamps based on position in the transcript (assume even pacing)
- Aim for 4-8 chapters depending on transcript length
- Description should be 1 sentence explaining what's covered

Return ONLY valid JSON matching this exact schema — no markdown fences, no commentary:
{
  "chapters": [
    {
      "title": "Chapter title",
      "start_time": "00:00",
      "description": "What this section covers"
    }
  ]
}

TRANSCRIPT:
{{CONTENT}}`;

export const CLIP_SUGGESTIONS_PROMPT = `You are a short-form video strategist. Analyze the transcript and identify 3-5 segments that would make excellent short-form clips (30-60 seconds each).

Look for:
- Strong hooks or opening statements
- Contrarian or surprising insights
- Practical tips or frameworks
- Emotional or high-energy moments
- Quotable one-liners

For each clip:
- Estimate start_time and end_time based on position in transcript (assume even pacing)
- Format times as MM:SS
- Explain why this clip will perform well
- Tag which platforms it fits: youtube_shorts, instagram, tiktok

Return ONLY a valid JSON array — no markdown fences, no commentary:
[
  {
    "title": "Clip title (catchy, under 60 chars)",
    "hook": "The first sentence that grabs attention",
    "start_time": "00:00",
    "end_time": "00:45",
    "reason": "Why this clip will perform well on social",
    "platform_fit": ["youtube_shorts", "instagram", "tiktok"]
  }
]

TRANSCRIPT:
{{CONTENT}}`;

export const JSON_FIX_PROMPT = `The following text was supposed to be valid JSON matching a specific schema, but it's malformed.
Fix it so it is valid JSON. Return ONLY the corrected JSON — no explanation, no markdown fences.

EXPECTED SCHEMA:
{{SCHEMA}}

MALFORMED TEXT:
{{TEXT}}`;
