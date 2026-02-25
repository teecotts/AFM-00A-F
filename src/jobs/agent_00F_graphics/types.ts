// ---- Agent 00F output types (strict JSON schemas) ----

export interface ThumbnailConcept {
  headline: string;
  subtext: string;
  emotion: string;
  visual_direction: string;
  color_notes: string;
  why_it_works: string;
}

export interface SocialGraphic {
  type: "quote_card" | "stat_card" | "insight_card";
  text: string;
  visual_direction: string;
  platform: "linkedin" | "instagram";
  why_it_works: string;
}

export interface VisualSummary {
  core_message: string;
  key_moments: string[];
  high_emotion_sections: string[];
  contrarian_statements: string[];
}
