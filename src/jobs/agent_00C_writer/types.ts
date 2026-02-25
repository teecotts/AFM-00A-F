// ---- Agent 00C output types (strict JSON schemas) ----

export interface LinkedInArticle {
  title: string;
  alt_titles: string[];
  content_markdown: string;
  hashtags: string[];
  suggested_publish_window: string;
}

export interface BlogPost {
  title: string;
  target_keywords: string[];
  meta_description: string;
  content_markdown: string;
}

export interface SocialPost {
  platform: "linkedin" | "x" | "instagram";
  content: string;
  hook: string;
  cta: string;
  suggested_time: string;
}

export interface TranscriptOutline {
  summary: string;
  sections: string[];
  key_points: string[];
}

export interface Agent00COutput {
  linkedin_article: LinkedInArticle;
  blog_post: BlogPost;
  social_posts: SocialPost[];
}
