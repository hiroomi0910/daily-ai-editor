import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseBlueskyFeedFilter } from "../collectors/bluesky/index.js";
import type { AppConfig, OutputMode } from "./types.js";

/**
 * Derive a platform-appropriate default Obsidian vault path from the home directory.
 * This is only a fallback — set SIZU_OBSIDIAN_VAULT_PATH in your .env for reliable operation.
 *
 * Mac (iCloud / Synology Drive / local): ~/Documents/obsidian_vault
 * Windows: %USERPROFILE%\Documents\obsidian_vault
 */
function deriveDefaultVaultPath(): string {
  return join(homedir(), "Documents", "obsidian_vault");
}

export function loadConfig(): AppConfig {
  loadDotEnv(".env");

  const outputMode = parseOutputMode(process.env.SIZU_OUTPUT_MODE);
  const vaultPathEnv = process.env.SIZU_OBSIDIAN_VAULT_PATH;
  if (outputMode === "obsidian" && !vaultPathEnv) {
    console.warn(
      "[config] SIZU_OBSIDIAN_VAULT_PATH is not set in .env. " +
        "Falling back to a default path — please set the correct path for your environment. " +
        `(platform: ${process.platform})`
    );
  }
  const vaultPath = vaultPathEnv ?? deriveDefaultVaultPath();
  const projectWorkspace =
    process.env.SIZU_PROJECT_WORKSPACE ?? "03_Projects/SIZU_PROJECT";
  const blueskyActor = emptyToUndefined(process.env.SIZU_BLUESKY_ACTOR);
  const blueskyLimit = parseBoundedInteger(process.env.SIZU_BLUESKY_LIMIT, {
    defaultValue: 25,
    min: 1,
    max: 100,
  });
  const blueskyFilter = parseBlueskyFeedFilter(process.env.SIZU_BLUESKY_FILTER);
  const openaiApiKey = emptyToUndefined(process.env.OPENAI_API_KEY);
  const openaiModel = emptyToUndefined(process.env.SIZU_OPENAI_MODEL) ?? "gpt-4o-mini";
  const geminiApiKey = emptyToUndefined(process.env.GEMINI_API_KEY);
  const geminiModel = emptyToUndefined(process.env.SIZU_GEMINI_MODEL) ?? "gemini-2.5-flash";

  // ブラウザのチャンネル設定（デフォルトは 'chrome'、必要に応じて .env で 'msedge' などに変更可能）
  // const browserChannel = process.env.SIZU_BROWSER_CHANNEL ?? "chrome";

  const githubUsername = emptyToUndefined(process.env.SIZU_GITHUB_USERNAME);
  const githubToken = emptyToUndefined(process.env.GITHUB_TOKEN);
  const rssFeeds = parseRssFeeds(process.env.SIZU_RSS_FEEDS);
  const twitterUsername = emptyToUndefined(process.env.SIZU_TWITTER_USERNAME);
  const sizuUsername = emptyToUndefined(process.env.SIZU_USERNAME);
  const xSessionPath = resolve(vaultPath, projectWorkspace, "ai-editor", "settings", "x-session.json");

  const threadsUsername = emptyToUndefined(process.env.SIZU_THREADS_USERNAME);
  const instagramUsername = emptyToUndefined(process.env.SIZU_INSTAGRAM_USERNAME);
  const facebookUsername = emptyToUndefined(process.env.SIZU_FACEBOOK_USERNAME);
  const instagramSessionPath = resolve(vaultPath, projectWorkspace, "ai-editor", "settings", "instagram-session.json");
  const facebookSessionPath = resolve(vaultPath, projectWorkspace, "ai-editor", "settings", "facebook-session.json");
  const sizuSessionPath = resolve(vaultPath, projectWorkspace, "ai-editor", "settings", "sizu-session.json");

  // Parse command line arguments for --date=YYYY-MM-DD and --redo
  let targetDate: string | undefined = undefined;
  let redoMode = false;
  for (const arg of process.argv) {
    if (arg.startsWith("--date=")) {
      const val = arg.slice(7).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        targetDate = val;
      }
    }
    if (arg === "--redo") {
      redoMode = true;
    }
  }

  let aiProvider: "openai" | "gemini" = "openai";
  const providerEnv = process.env.SIZU_AI_PROVIDER;
  if (providerEnv === "gemini") {
    aiProvider = "gemini";
  } else if (providerEnv === "openai") {
    aiProvider = "openai";
  } else {
    if (geminiApiKey && !openaiApiKey) {
      aiProvider = "gemini";
    }
  }

  return {
    outputMode,
    vaultPath,
    projectWorkspace,
    blueskyActor,
    blueskyLimit,
    blueskyFilter,
    localOutputPath: resolve("outputs"),
    localLogPath: resolve("logs"),
    localRawLogPath: resolve("raw_logs"),
    localGenerationInputPath: resolve("generation_inputs"),
    openaiApiKey,
    openaiModel,
    aiProvider,
    geminiApiKey,
    geminiModel,
    githubUsername,
    githubToken,
    rssFeeds,
    twitterUsername,
    xSessionPath,
    threadsUsername,
    instagramUsername,
    facebookUsername,
    instagramSessionPath,
    facebookSessionPath,
    sizuSessionPath,
    sizuUsername,
    targetDate,
    redoMode,
  };
}

function parseRssFeeds(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseOutputMode(value: string | undefined): OutputMode {
  if (value === "obsidian") {
    return "obsidian";
  }

  return "local";
}

function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = stripQuotes(value);
    }
  }
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoundedInteger(
  value: string | undefined,
  options: { defaultValue: number; min: number; max: number },
): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return options.defaultValue;
  }

  return Math.min(Math.max(parsed, options.min), options.max);
}
