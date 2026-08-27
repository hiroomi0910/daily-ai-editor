import { existsSync } from "node:fs";
import { join } from "node:path";
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
import { generateArticleWithGemini } from "./generators/geminiArticle.js";
import { calculateTargetLength } from "./generators/lengthCalculator.js";
import { buildGenerationInput } from "./generationInputs/renderGenerationInput.js";
import { writeDailyArticle } from "./writers/obsidian/writeDailyArticle.js";
import { writeGenerationInput } from "./writers/generationInputs/writeGenerationInput.js";
import { writeRawLog } from "./writers/rawLogs/writeRawLog.js";
import { clearDayLogs } from "./redo/clearDayLogs.js";
import { Spinner } from "./utils/spinner.js";

// --- CONSOLE COLORIZATION OVERRIDES ---
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
};

const snsColors: Record<string, string> = {
  "[Instagram]": colors.magenta, // Purple/Magenta
  "[Bluesky]": colors.cyan,     // Cyan
  "[GitHub]": colors.gray,       // Gray
  "[Twitter]": colors.blue,      // Blue
  "[Threads]": colors.bold + colors.white, // Bold White
  "[Facebook]": colors.blue,     // Deep Blue
  "[RSS]": colors.green,         // Green
  "[info]": colors.cyan,         // Cyan
  "[warn]": colors.yellow,       // Yellow
  "[error]": colors.red,         // Red
};

function colorizeText(text: string): string {
  if (typeof text !== "string") return text;
  let result = text;

  // 1. Prefix matches
  for (const [prefix, color] of Object.entries(snsColors)) {
    if (result.includes(prefix)) {
      result = result.replaceAll(prefix, `${color}${prefix}${colors.reset}`);
    }
  }

  // 2. Found N items matches
  result = result.replace(/Found (\d+) items/g, (match, countStr) => {
    const count = parseInt(countStr, 10);
    const color = count > 0 ? colors.green : colors.yellow;
    return `${color}${match}${colors.reset}`;
  });

  // 3. Error and failure matches
  const lowerResult = result.toLowerCase();
  if (lowerResult.includes("error") || lowerResult.includes("failed") || result.includes("✗")) {
    if (result.startsWith("[error]") || result.startsWith("✗") || result.includes("Collection failed")) {
      return `${colors.red}${result}${colors.reset}`;
    }
    result = result.replace(/(error|failed|✗)/gi, `${colors.red}$&${colors.reset}`);
  }

  return result;
}

const originalLog = console.log;
console.log = function (...args: any[]) {
  const colorizedArgs = args.map(arg => (typeof arg === "string" ? colorizeText(arg) : arg));
  originalLog.apply(console, colorizedArgs);
};

const originalError = console.error;
console.error = function (...args: any[]) {
  const colorizedArgs = args.map(arg => {
    if (typeof arg === "string") {
      const colorized = colorizeText(arg);
      return colorized.includes("\x1b[") ? colorized : `${colors.red}${colorized}${colors.reset}`;
    }
    return arg;
  });
  originalError.apply(console, colorizedArgs);
};

const originalWarn = console.warn;
console.warn = function (...args: any[]) {
  const colorizedArgs = args.map(arg => {
    if (typeof arg === "string") {
      const colorized = colorizeText(arg);
      return colorized.includes("\x1b[") ? colorized : `${colors.yellow}${colorized}${colors.reset}`;
    }
    return arg;
  });
  originalWarn.apply(console, colorizedArgs);
};
// --------------------------------------

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
   * AbortSignal によるタイムアウトを使い、Instagram 等は部分成功を返せるようにする。
   */
  async function runGracefulCollector(
    source: CollectionResult["source"],
    isEnabled: boolean,
    fn: (signal: AbortSignal) => Promise<CollectionResult>,
    timeoutMs: number = config.collectorTimeoutMs,
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

    console.log(`[${displayName}] Starting collection... (timeout: ${Math.round(timeoutMs / 1000)}s)`);
    const abortController = new AbortController();
    const timerId = setTimeout(() => {
      abortController.abort(new Error(`Collection timed out (${Math.round(timeoutMs / 1000)} seconds limit reached)`));
    }, timeoutMs);

    try {
      const result = await fn(abortController.signal);
      const partialNote =
        result.raw && typeof result.raw === "object" && "mode" in result.raw && result.raw.mode === "partial"
          ? " (partial)"
          : "";
      console.log(`[${displayName}] Collection finished. Found ${result.items.length} items.${partialNote}`);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[${displayName}] Collection failed: ${msg}`);
      logger.error(`Graceful collector caught error on source [${source}]`, {
        error: msg,
      });
      return {
        source,
        collectedAt: now.toISOString(),
        items: [],
        raw: { error: msg },
      };
    } finally {
      clearTimeout(timerId);
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
    runGracefulCollector("bluesky", !!config.blueskyActor, (_signal) => collectBlueskyPosts({
      actor: config.blueskyActor,
      limit: config.blueskyLimit,
      filter: config.blueskyFilter,
      now,
    })),
    runGracefulCollector("github", !!config.githubUsername, (_signal) => collectGitHubEvents({
      username: config.githubUsername,
      token: config.githubToken,
      now,
    })),
    runGracefulCollector("rss", config.rssFeeds.length > 0, (_signal) => collectRssFeeds({
      feeds: config.rssFeeds,
      now,
    })),
    runGracefulCollector("twitter", !!config.twitterUsername, (signal) => collectTwitterPosts({
      username: config.twitterUsername,
      sessionPath: config.xSessionPath,
      ledgerPath: config.xLikesLedgerPath,
      now,
      signal,
      aiProvider: config.aiProvider,
      geminiApiKey: config.geminiApiKey,
      geminiModel: config.geminiModel,
      openaiApiKey: config.openaiApiKey,
      openaiModel: config.openaiModel,
      rawLogDir: config.outputMode === "obsidian"
        ? join(config.vaultPath, config.projectWorkspace, "raw_logs", "twitter")
        : join(config.localRawLogPath, "twitter"),
      targetDate: date,
    })),
    runGracefulCollector("threads", !!config.threadsUsername, (signal) => collectThreadsPosts({
      username: config.threadsUsername,
      now,
      signal,
      aiProvider: config.aiProvider,
      geminiApiKey: config.geminiApiKey,
      geminiModel: config.geminiModel,
      openaiApiKey: config.openaiApiKey,
      openaiModel: config.openaiModel,
    })),
    runGracefulCollector(
      "instagram",
      !!config.instagramUsername,
      (signal) => collectInstagramActivity({
        username: config.instagramUsername,
        sessionPath: config.instagramSessionPath,
        now,
        targetDate: config.targetDate,
        deadlineMs: Date.now() + config.instagramTimeoutMs,
        signal,
        aiProvider: config.aiProvider,
        geminiApiKey: config.geminiApiKey,
        geminiModel: config.geminiModel,
        openaiApiKey: config.openaiApiKey,
        openaiModel: config.openaiModel,
      }),
      config.instagramTimeoutMs,
    ),
    runGracefulCollector("facebook", !!config.facebookUsername, (_signal) => collectFacebookActivity({
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

  // Calculate dynamic article length profile
  const lengthInfo = calculateTargetLength(generationInput.items, config.articleLengthOverride);
  logger.info("Calculated target article length profile", {
    score: lengthInfo.score,
    tier: lengthInfo.tier,
    japaneseRange: lengthInfo.japaneseLengthRange,
    englishRange: lengthInfo.englishLengthRange,
  });
  console.log(`[Article Length] Score: ${lengthInfo.score}, Tier: ${lengthInfo.tier} (${lengthInfo.japaneseLengthRange})`);

  const spinner = new Spinner();

  try {
    let article;
    if (config.aiProvider === "gemini") {
      logger.info("Generating article using Gemini API", { model: config.geminiModel });
      try {
        const systemPrompt = [
          "あなたは冷静で思索的なAI編集者です。ユーザーの活動記録を元に、静かで情緒的な日記を作成してください。画像が含まれる場合は、その視覚情報を描写に積極的に取り入れてください。",
          "CRITICAL: Never start or end the article with generic boilerplate or clichés. Start the very first sentence of the body text directly with a specific activity, thought, or project from today's log.",
          "以下のスキーマに沿ったJSON形式で厳密に出力してください：",
          "{",
          `  "title": "日記の生成内容にふさわしい、詩的で静かな日本語のタイトル${lengthInfo.titleRestrictionJa} (string)",`,
          "  \"tags\": [\"テーマを表す関連タグ ('daily-ai' を必ず含め、その他カスタムタグを数個) (array of strings)\"],",
          `  "body": "日記の本文（日本語）。${lengthInfo.japaneseLengthRange}。思索的でパーソナル、ネットネイティブなトーン。 (string)"`,
          "}"
        ].join("\n");
        article = await spinner.wrap(
          `Generating article with Gemini (${config.geminiModel})...`,
          () => generateArticleWithGemini(config, generationInput.items, systemPrompt, date),
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
            () => generateOpenAIArticle(config, date, generationInput, lengthInfo),
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
        () => generateOpenAIArticle(config, date, generationInput, lengthInfo),
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
  // 常に日本時間（Asia/Tokyo）の YYYY-MM-DD 文字列を取得する
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

main().catch((error: unknown) => {
  console.error(error);
  ;(globalThis as any).process.exitCode = 1;
});
