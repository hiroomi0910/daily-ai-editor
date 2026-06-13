import { existsSync } from "node:fs";
import { loadConfig } from "./config/loadConfig.js";
import { collectBlueskyPosts } from "./collectors/bluesky/index.js";
import { collectGitHubEvents } from "./collectors/github/index.js";
import { collectRssFeeds } from "./collectors/rss/index.js";
import { collectTwitterPosts } from "./collectors/twitter/index.js";
import { collectThreadsPosts } from "./collectors/threads/index.js";
import { collectInstagramActivity } from "./collectors/instagram/index.js";
import { collectFacebookActivity } from "./collectors/facebook/index.js";
import type { CollectionResult } from "./collectors/types.js";
import { publishToSizuDraft } from "./publishers/sizu/index.js";
import { createLogger } from "./logging/logger.js";
import { generateOpenAIArticle } from "./generators/openaiArticle.js";
import { generateGeminiArticle } from "./generators/geminiArticle.js";
import { buildGenerationInput } from "./generationInputs/renderGenerationInput.js";
import { writeDailyArticle } from "./writers/obsidian/writeDailyArticle.js";
import { writeGenerationInput } from "./writers/generationInputs/writeGenerationInput.js";
import { writeRawLog } from "./writers/rawLogs/writeRawLog.js";
import { clearDayLogs } from "./redo/clearDayLogs.js";
import { Spinner } from "./utils/spinner.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  
  // Use targetDate from CLI if configured (e.g. 2026-05-29) set at 23:59:59 to capture full day activities
  const now = config.targetDate ? new Date(config.targetDate + "T23:59:59") : new Date();
  const date = config.targetDate ?? getDateStamp(now);

  logger.info("SIZU PROJECT run started", {
    outputMode: config.outputMode,
    projectWorkspace: config.projectWorkspace,
    aiProvider: config.aiProvider,
    targetDate: config.targetDate ?? "today",
    blueskyActorConfigured: Boolean(config.blueskyActor),
    githubUsernameConfigured: Boolean(config.githubUsername),
    twitterUsernameConfigured: Boolean(config.twitterUsername),
    threadsUsernameConfigured: Boolean(config.threadsUsername),
    instagramUsernameConfigured: Boolean(config.instagramUsername),
    facebookUsernameConfigured: Boolean(config.facebookUsername),
    sizuUsernameConfigured: Boolean(config.sizuUsername),
    rssFeedsCount: config.rssFeeds.length,
  });

  console.log(`[Target Date] ${date}`);
  console.log(`[Mode] ${config.redoMode ? "REDO (logs will be cleared before collection)" : "Normal"}`);
  console.log(`[Enabled Sources] ${[
    config.blueskyActor ? "Bluesky" : null,
    config.githubUsername ? "GitHub" : null,
    config.rssFeeds.length > 0 ? "RSS" : null,
    config.twitterUsername ? "Twitter" : null,
    config.threadsUsername ? "Threads" : null,
    config.instagramUsername ? "Instagram" : null,
    config.facebookUsername ? "Facebook" : null,
  ].filter(Boolean).join(", ")}`);

  // --redo モード: 収集前に対象日付のログをクリアしてやり直す
  if (config.redoMode) {
    logger.info(`[Redo] Clearing existing logs for ${date} before re-collection...`);
    const clearResult = await clearDayLogs(config, date);
    if (clearResult.deletedCount > 0) {
      logger.info(`[Redo] Cleared ${clearResult.deletedCount} file(s).`, {
        deletedFiles: clearResult.deletedFiles,
      });
    } else {
      logger.info(`[Redo] No existing logs found for ${date}. Proceeding as fresh run.`);
    }
  }

  /**
   * 各コレクターを安全に実行するためのヘルパー。
   * promise ではなく factory 関数 (fn) を渡すことで、実行直前にログを出せるようにします。
   */
  async function runGracefulCollector(
    source: CollectionResult["source"],
    isEnabled: boolean,
    fn: () => Promise<CollectionResult>
  ): Promise<CollectionResult> {
    const displayNames: Record<string, string> = {
      github: "GitHub",
      rss: "RSS",
      bluesky: "Bluesky",
      twitter: "Twitter",
      threads: "Threads",
      instagram: "Instagram",
      facebook: "Facebook",
    };
    const lookupKey = source.toLowerCase();
    const displayName = displayNames[lookupKey] || (source.charAt(0).toUpperCase() + source.slice(1));
    if (!isEnabled) {
      console.log(`[${displayName}] Skipped (Not configured)`);
      return {
        source,
        collectedAt: now.toISOString(),
        items: [],
        raw: { mode: "skipped", note: "Not enabled in config" }
      };
    }

    console.log(`[${displayName}] Starting collection...`);
    let timerId: NodeJS.Timeout | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => {
          reject(new Error("Collection timed out (120 seconds limit reached)"));
        }, 120000);
      });

      const result = await Promise.race([fn(), timeoutPromise]);
      if (timerId) clearTimeout(timerId);
      console.log(`[${displayName}] Collection finished. Found ${result.items.length} items.`);
      return result;
    } catch (error) {
      if (timerId) clearTimeout(timerId);
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[${displayName}] Collection failed: ${msg}`);
      logger.error(`Graceful collector caught error on source [${source}]`, {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        source,
        collectedAt: now.toISOString(),
        items: [],
        raw: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  const [
    blueskyResult,
    githubResult,
    rssResult,
    twitterResult,
    threadsResult,
    instagramResult,
    facebookResult,
  ] = await Promise.all([
    runGracefulCollector("bluesky", !!config.blueskyActor, () => collectBlueskyPosts({
      actor: config.blueskyActor,
      limit: config.blueskyLimit,
      filter: config.blueskyFilter,
      now,
    })),
    runGracefulCollector("github", !!config.githubUsername, () => collectGitHubEvents({
      username: config.githubUsername,
      token: config.githubToken,
      now,
    })),
    runGracefulCollector("rss", config.rssFeeds.length > 0, () => collectRssFeeds({
      feeds: config.rssFeeds,
      now,
    })),
    runGracefulCollector("twitter", !!config.twitterUsername, () => collectTwitterPosts({
      username: config.twitterUsername,
      sessionPath: config.xSessionPath,
      now,
    })),
    runGracefulCollector("threads", !!config.threadsUsername, () => collectThreadsPosts({
      username: config.threadsUsername,
      now,
    })),
    runGracefulCollector("instagram", !!config.instagramUsername, () => collectInstagramActivity({
      username: config.instagramUsername,
      sessionPath: config.instagramSessionPath,
      now,
      aiProvider: config.aiProvider,
      geminiApiKey: config.geminiApiKey,
      geminiModel: config.geminiModel,
      openaiApiKey: config.openaiApiKey,
      openaiModel: config.openaiModel,
    })),
    runGracefulCollector("facebook", !!config.facebookUsername, () => collectFacebookActivity({
      username: config.facebookUsername,
      sessionPath: config.facebookSessionPath,
      now,
    })),
  ]);

  const [
    rawBlueskyLog,
    rawGitHubLog,
    rawRssLog,
    rawTwitterLog,
    rawThreadsLog,
    rawInstagramLog,
    rawFacebookLog,
  ] = await Promise.all([
    writeRawLog(config, blueskyResult),
    writeRawLog(config, githubResult),
    writeRawLog(config, rssResult),
    writeRawLog(config, twitterResult),
    writeRawLog(config, threadsResult),
    writeRawLog(config, instagramResult),
    writeRawLog(config, facebookResult),
  ]);

  logger.info("Raw collection logs written", {
    bluesky: rawBlueskyLog,
    github: rawGitHubLog,
    rss: rawRssLog,
    twitter: rawTwitterLog,
    threads: rawThreadsLog,
    instagram: rawInstagramLog,
    facebook: rawFacebookLog,
  });

  const generationInput = buildGenerationInput(date, now.toISOString(), [
    blueskyResult,
    githubResult,
    rssResult,
    twitterResult,
    threadsResult,
    instagramResult,
    facebookResult,
  ]);
  const generationInputResult = await writeGenerationInput(config, generationInput);

  logger.info("Generation input written", generationInputResult);

  // Skip generating article if there are no activity items for the target date
  if (generationInput.items.length === 0) {
    logger.info(`No active SNS activities collected for target date ${date}. Skipping column generation.`);
    logger.info("SIZU PROJECT run finished");
    return;
  }

  const spinner = new Spinner();

  try {
    let article;
    if (config.aiProvider === "gemini") {
      logger.info("Generating article using Gemini API", { model: config.geminiModel });
      try {
        article = await spinner.wrap(
          `Generating article with Gemini (${config.geminiModel})...`,
          () => generateGeminiArticle(config, date, generationInput),
          "✓ Article generated."
        );
      } catch (geminiError) {
        // Gemini が全リトライ失敗した場合、OpenAI にフォールバック
        if (config.openaiApiKey) {
          console.warn(`[Fallback] Gemini failed. Switching to OpenAI (${config.openaiModel})...`);
          logger.warn("Gemini API failed after all retries. Falling back to OpenAI.", {
            geminiError: geminiError instanceof Error ? geminiError.message : String(geminiError),
            fallbackModel: config.openaiModel,
          });
          article = await spinner.wrap(
            `Generating article with OpenAI (${config.openaiModel})...`,
            () => generateOpenAIArticle(config, date, generationInput),
            "✓ Article generated (via OpenAI fallback)."
          );
        } else {
          // OpenAI も未設定なら諦めて再スロー
          throw geminiError;
        }
      }
    } else {
      logger.info("Generating article using OpenAI API", { model: config.openaiModel });
      article = await spinner.wrap(
        `Generating article with OpenAI (${config.openaiModel})...`,
        () => generateOpenAIArticle(config, date, generationInput),
        "✓ Article generated."
      );
    }
    const result = await writeDailyArticle(config, article);
    logger.info("Daily article written", result);

    // Automate publishing draft to sizu.me if sizu-session.json exists
    if (existsSync(config.sizuSessionPath)) {
      try {
        logger.info("Publishing generated article to Sizu.me as draft...");
        const sizuResult = await spinner.wrap(
          "Saving draft to sizu.me...",
          () => publishToSizuDraft(config, article),
          "✓ Draft saved to sizu.me."
        );
        if (sizuResult.success) {
          logger.info(sizuResult.note, { url: sizuResult.url });
        } else {
          logger.error(`Sizu.me draft publishing failed: ${sizuResult.note}`);
        }
      } catch (sizuError) {
        logger.error("Unexpected error during Sizu.me draft publishing", {
          error: sizuError instanceof Error ? sizuError.message : String(sizuError),
          stack: sizuError instanceof Error ? sizuError.stack : undefined,
        });
        // 記事自体はObsidianに保存済みのため、全体のプロセスとしては失敗扱い(exitCode=1)にしない
      }
    }
  } catch (error) {
    logger.error("Failed to generate or write daily article", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
  }

  logger.info("SIZU PROJECT run finished");
}

function getDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

main().catch((error: unknown) => {
  console.error(error);
  ;(globalThis as any).process.exitCode = 1;
});
