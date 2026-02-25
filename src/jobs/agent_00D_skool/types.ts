// ---- Agent 00D output types (strict JSON schemas) ----

export interface SkoolPost {
  title: string;
  content_markdown: string;
  discussion_question: string;
  suggested_time: string;
}

export interface TranscriptOutline {
  summary: string;
  sections: string[];
  key_points: string[];
}
