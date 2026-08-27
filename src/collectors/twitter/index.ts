import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium, type Page } from "playwright";
import type { CollectionResult, CollectedActivityItem } from "../types.js";
import { describeVisionImage } from "../instagram/index.js";

export type LikesLedgerEntry = {
  url: string;
  id?: string;
  text: string;
  tweetCreatedAt?: string;
  firstSeenDate: string; // YYYY-MM-DD (JST)
  firstSeenTimestamp: string; // ISO 8601
  hasImages?: boolean;
};

export type LikesLedger = Record<string, LikesLedgerEntry>;

export type TwitterCollectorOptions = {
  username: string | undefined;
  sessionPath: string;
  ledgerPath?: string;
  now: Date;
  signal?: AbortSignal;
  aiProvider?: "openai" | "gemini";
  geminiApiKey?: string;
  geminiModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  rawLogDir?: string;
  targetDate?: string;
};

export async function collectTwitterPosts(
  options: TwitterCollectorOptions,
): Promise<CollectionResult> {
  const collectedAt = options.now.toISOString();
  const username = options.username?.trim();

  if (!username) {
    return {
      source: "twitter",
      collectedAt,
      items: [],
      raw: {
        mode: "skipped",
        username: null,
        note: "SIZU_TWITTER_USERNAME is not configured. Twitter collection skipped.",
      },
    };
  }

  if (!existsSync(options.sessionPath)) {
    return {
      source: "twitter",
      collectedAt,
      items: [],
      raw: {
        mode: "skipped",
        username,
        note: `Session file not found at ${options.sessionPath}. Please run 'npm run login:x' first to log in and save the session.`,
      },
    };
  }

  const dateStamp = getDateStamp(options.now);
  const todayStamp = getDateStamp(new Date());
  const isPastDate = dateStamp < todayStamp;

  // 1. Load likes ledger and perform automatic migration if empty
  const ledger = options.ledgerPath ? await loadLikesLedger(options.ledgerPath) : {};
  if (Object.keys(ledger).length === 0 && options.rawLogDir) {
    const { migratedCount } = await migrateFromRawLogs(options.rawLogDir, ledger);
    if (migratedCount > 0 && options.ledgerPath) {
      console.log(`[Twitter Ledger] 過去のraw_logsから ${migratedCount} 件の「いいね」履歴を台帳に初期移行しました。`);
      await saveLikesLedger(options.ledgerPath, ledger);
    }
  }

  console.log(`[Twitter] Checking tweets for ${username}...`);

  let browser;
  try {
    try {
      browser = await chromium.launch({
        headless: true,
        channel: "chrome",
        args: ["--disable-blink-features=AutomationControlled"],
      });
    } catch {
      browser = await chromium.launch({
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
      });
    }
    const context = await browser.newContext({
      storageState: options.sessionPath,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
    });
    const page = await context.newPage();

    // Check if we got redirected to a login page (session expired)
    await page.goto(`https://x.com/home`, { waitUntil: "load", timeout: 25000 });
    await page.waitForTimeout(3000);

    if (page.url().includes("login") || page.url().includes("flow/login")) {
      console.warn(`[Twitter] ログイン画面へリダイレクトされました。セッションが切れている可能性があります: ${page.url()}`);
    }

    // 2. Fetch own tweets from the profile timeline
    const profileUrl = `https://x.com/${username}`;
    console.log(`[Twitter] Loading profile: ${profileUrl}`);
    await page.goto(profileUrl, { waitUntil: "load", timeout: 25000 });
    if (options.signal?.aborted) throw new Error("Twitter collection aborted");
    const rawTweets = await scrapeTweetsFromPage(page);
    const processedTweets = await enrichTweetsWithVision(page, rawTweets, options, dateStamp, false);

    // 3. Process likes via Ledger
    let rawLikes: any[] = [];
    let likesForTargetDate: LikesLedgerEntry[] = [];

    const existingLedgerLikes = getLikesForDate(ledger, dateStamp);

    if (isPastDate && existingLedgerLikes.length > 0) {
      // 過去日の再実行かつ台帳に記録済みの場合：
      // Xの最新画面を見に行かず台帳から直接復元（未来のいいね混入を完全に防止）
      console.log(`[Twitter] 過去日 (${dateStamp}) の指定です。永続台帳から ${existingLedgerLikes.length} 件の「いいね」を復元しました（スクレイピングを安全にスキップ）。`);
      likesForTargetDate = existingLedgerLikes;
      rawLikes = existingLedgerLikes;
    } else {
      // 当日実行または台帳に未記録の日の場合：Xからスクレイピングして台帳に記録
      const likesUrl = `https://x.com/${username}/likes`;
      console.log(`[Twitter] Loading likes: ${likesUrl}`);
      await page.goto(likesUrl, { waitUntil: "load", timeout: 25000 });
      if (options.signal?.aborted) throw new Error("Twitter collection aborted");
      rawLikes = await scrapeTweetsFromPage(page);

      const { newLikesCount, dateLikes } = registerScrapedLikes(
        ledger,
        rawLikes,
        dateStamp,
        collectedAt,
      );

      console.log(`[Twitter] スクレイピングした ${rawLikes.length} 件中、新規「いいね」${newLikesCount} 件を検知・台帳登録しました (対象日: ${dateLikes.length} 件)。`);

      if (options.ledgerPath && newLikesCount > 0) {
        await saveLikesLedger(options.ledgerPath, ledger);
      }

      likesForTargetDate = dateLikes;
    }

    const processedLikes = await enrichTweetsWithVision(page, likesForTargetDate, options, dateStamp, true);

    const allRawTweets = [...rawTweets, ...rawLikes]; // For raw log
    const allProcessedTweets = [...processedTweets, ...processedLikes];

    await browser.close();

    const items: CollectedActivityItem[] = [];

    for (const t of allProcessedTweets) {
      if (!t.text?.trim()) {
        continue;
      }

      const isLike = t.url && !t.url.includes(`/${username}/status/`);
      items.push({
        id: t.id || String(Math.random()),
        source: "twitter",
        text: isLike ? `Twitterで「いいね」しました: "${t.text}"` : t.text,
        createdAt: isLike ? (t.firstSeenTimestamp || collectedAt) : (t.createdAt || collectedAt),
        url: t.url || undefined,
        metadata: {
          originalUrl: t.url,
          tweetCreatedAt: t.tweetCreatedAt || t.createdAt,
          firstSeenDate: t.firstSeenDate || dateStamp,
        },
      });
    }

    return {
      source: "twitter",
      collectedAt,
      items,
      raw: {
        mode: "ok",
        url: profileUrl,
        response: allRawTweets,
      },
    };
  } catch (error) {
    if (browser) {
      await browser.close();
    }
    return {
      source: "twitter",
      collectedAt,
      items: [],
      raw: {
        mode: "error",
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function enrichTweetsWithVision(
  page: Page,
  rawItems: any[],
  options: TwitterCollectorOptions,
  dateStamp: string,
  isLikeTimeline: boolean,
): Promise<any[]> {
  const results: any[] = [];
  for (const t of rawItems) {
    if (!isLikeTimeline) {
      if (!t.createdAt) continue;
      const d = new Date(t.createdAt);
      const jstDate = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
      if (jstDate !== dateStamp) continue;
    }

    let finalText = t.text;
    if (t.hasImages && (options.geminiApiKey || options.openaiApiKey) && !page.isClosed()) {
      try {
        console.log(`[Twitter] 画像が含まれるポストを検出しました。解析中: ${t.url}`);
        const article = page.locator(`article:has(a[href*="${t.id}"])`).first();
        if (await article.count() > 0) {
          const screenshotBuffer = await article.screenshot({ timeout: 10000 });
          const base64Image = screenshotBuffer.toString("base64");
          const description = await describeVisionImage(base64Image, options);
          finalText = `${t.text} (画像描写: ${description})`;
          console.log(`[Twitter] 画像解析完了: ${description}`);
        }
      } catch (e) {
        console.warn(`[Twitter] 画像解析に失敗しましたが、テキストのみで続行します: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    results.push({ ...t, text: finalText });
  }
  return results;
}

async function scrapeTweetsFromPage(page: any): Promise<any[]> {
  // Wait for React to settle
  await page.waitForTimeout(20000);
  await page.waitForSelector('article[data-testid="tweet"]', { timeout: 10000 }).catch(() => undefined);

  // Scroll down to load more tweets
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(2000);
  }

  return await page.$$eval('article[data-testid="tweet"]', (articles: Element[]) => {
    return articles.map((article) => {
      const textEl = article.querySelector('[data-testid="tweetText"]');
      const timeEl = article.querySelector('time');
      const linkEl = article.querySelector('a[href*="/status/"]');
      const hasImages = !!article.querySelector('[data-testid="tweetPhoto"]');

      return {
        text: textEl ? textEl.textContent || "" : "",
        createdAt: timeEl ? timeEl.getAttribute("datetime") || "" : "",
        url: linkEl ? "https://x.com" + linkEl.getAttribute("href") : "",
        id: linkEl ? linkEl.getAttribute("href") || "" : "",
        hasImages,
      };
    });
  });
}

function getDateStamp(date: Date): string {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/**
 * Load the likes ledger JSON file. Returns an empty object if the file doesn't exist.
 */
export async function loadLikesLedger(ledgerPath: string): Promise<LikesLedger> {
  if (!existsSync(ledgerPath)) {
    return {};
  }
  try {
    const content = await readFile(ledgerPath, "utf8");
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as LikesLedger;
    }
  } catch (error) {
    console.warn(`[Twitter Ledger] Failed to parse ledger at ${ledgerPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {};
}

/**
 * Save the likes ledger to disk atomically.
 */
export async function saveLikesLedger(ledgerPath: string, ledger: LikesLedger): Promise<void> {
  try {
    const dir = dirname(ledgerPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const jsonString = JSON.stringify(ledger, null, 2);
    await writeFile(ledgerPath, jsonString, "utf8");
  } catch (error) {
    console.error(`[Twitter Ledger] Failed to save ledger to ${ledgerPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Scan historical raw logs (raw_logs/twitter/YYYY/MM/*.json) and migrate them into the ledger.
 */
export async function migrateFromRawLogs(
  rawLogDir: string,
  ledger: LikesLedger,
): Promise<{ migratedCount: number }> {
  if (!existsSync(rawLogDir)) {
    return { migratedCount: 0 };
  }

  const logFiles: { path: string; fileDate: string }[] = [];

  async function collectFiles(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const fileDate = entry.name.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(fileDate)) {
          logFiles.push({ path: fullPath, fileDate });
        }
      }
    }
  }

  try {
    await collectFiles(rawLogDir);
  } catch (e) {
    console.warn(`[Twitter Ledger] Failed to scan raw logs for migration: ${e instanceof Error ? e.message : String(e)}`);
    return { migratedCount: 0 };
  }

  // Sort files chronologically so older logs take precedence for firstSeenDate
  logFiles.sort((a, b) => a.fileDate.localeCompare(b.fileDate));

  let migratedCount = 0;

  for (const file of logFiles) {
    try {
      const content = await readFile(file.path, "utf8");
      const data = JSON.parse(content);

      // Check items
      if (data && Array.isArray(data.items)) {
        for (const item of data.items) {
          const url = item.url || item.metadata?.originalUrl;
          if (url && typeof url === "string" && !ledger[url]) {
            const isLike = !url.includes(`/status/`) || item.text?.includes("Twitterで「いいね」しました");
            if (isLike) {
              ledger[url] = {
                url,
                id: item.id,
                text: cleanLikeText(item.text || ""),
                tweetCreatedAt: item.metadata?.tweetCreatedAt,
                firstSeenDate: file.fileDate,
                firstSeenTimestamp: item.createdAt || `${file.fileDate}T23:59:59.000Z`,
              };
              migratedCount++;
            }
          }
        }
      }

      // Check raw response array if present
      if (data && data.raw && Array.isArray(data.raw.response)) {
        for (const res of data.raw.response) {
          if (res && res.url && typeof res.url === "string" && !ledger[res.url]) {
            ledger[res.url] = {
              url: res.url,
              id: res.id,
              text: res.text || "",
              tweetCreatedAt: res.createdAt,
              firstSeenDate: file.fileDate,
              firstSeenTimestamp: `${file.fileDate}T23:59:59.000Z`,
              hasImages: res.hasImages,
            };
            migratedCount++;
          }
        }
      }
    } catch {
      // Ignore individual file parse errors
    }
  }

  return { migratedCount };
}

function cleanLikeText(text: string): string {
  const prefix = 'Twitterで「いいね」しました: "';
  if (text.startsWith(prefix) && text.endsWith('"')) {
    return text.slice(prefix.length, -1);
  }
  return text;
}

export function getLikesForDate(ledger: LikesLedger, targetDate: string): LikesLedgerEntry[] {
  return Object.values(ledger).filter((entry) => entry.firstSeenDate === targetDate);
}

export function registerScrapedLikes(
  ledger: LikesLedger,
  scrapedLikes: Array<{
    url: string;
    id?: string;
    text: string;
    createdAt?: string;
    hasImages?: boolean;
  }>,
  dateStamp: string,
  nowIso: string,
): { newLikesCount: number; dateLikes: LikesLedgerEntry[] } {
  let newLikesCount = 0;

  for (const item of scrapedLikes) {
    if (!item.url) continue;

    if (!ledger[item.url]) {
      ledger[item.url] = {
        url: item.url,
        id: item.id,
        text: item.text,
        tweetCreatedAt: item.createdAt,
        firstSeenDate: dateStamp,
        firstSeenTimestamp: nowIso,
        hasImages: item.hasImages,
      };
      newLikesCount++;
    }
  }

  const dateLikes = getLikesForDate(ledger, dateStamp);
  return { newLikesCount, dateLikes };
}
