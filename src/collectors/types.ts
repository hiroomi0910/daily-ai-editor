export type ActivitySource = "bluesky" | "github" | "rss" | "twitter" | "threads" | "instagram" | "facebook";

export type CollectedActivityItem = {
  id: string;
  source: ActivitySource;
  text: string;
  createdAt: string;
  url?: string;
  metadata?: Record<string, unknown>;
};

export type CollectionResult = {
  source: ActivitySource;
  collectedAt: string;
  items: CollectedActivityItem[];
  raw: unknown;
};
