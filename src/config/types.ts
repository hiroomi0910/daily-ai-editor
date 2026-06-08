export type OutputMode = "local" | "obsidian";
export type BlueskyFeedFilter =
  | "posts_with_replies"
  | "posts_no_replies"
  | "posts_with_media"
  | "posts_and_author_threads"
  | "posts_with_video";

export type AppConfig = {
  outputMode: OutputMode;
  vaultPath: string;
  projectWorkspace: string;
  blueskyActor: string | undefined;
  blueskyLimit: number;
  blueskyFilter: BlueskyFeedFilter;
  localOutputPath: string;
  localLogPath: string;
  localRawLogPath: string;
  localGenerationInputPath: string;
  openaiApiKey: string | undefined;
  openaiModel: string;
  aiProvider: "openai" | "gemini";
  geminiApiKey: string | undefined;
  geminiModel: string;
  githubUsername: string | undefined;
  githubToken: string | undefined;
  rssFeeds: string[];
  twitterUsername: string | undefined;
  xSessionPath: string;
  threadsUsername: string | undefined;
  instagramUsername: string | undefined;
  facebookUsername: string | undefined;
  instagramSessionPath: string;
  facebookSessionPath: string;
  sizuSessionPath: string;
  sizuUsername: string | undefined;
  targetDate: string | undefined;
  redoMode: boolean;
};
