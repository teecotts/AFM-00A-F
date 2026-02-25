// ---- Agent 00B output types (strict JSON schemas) ----

export interface Chapter {
  title: string;
  start_time: string;
  description: string;
}

export interface ChapterMarkers {
  chapters: Chapter[];
}

export interface ClipSuggestion {
  title: string;
  hook: string;
  start_time: string;
  end_time: string;
  reason: string;
  platform_fit: string[];
}

export interface VideoSummary {
  core_message: string;
  key_moments: string[];
  high_emotion_sections: string[];
  contrarian_statements: string[];
}
