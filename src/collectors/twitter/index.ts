import { existsSync } from "node:fs";
import { chromium, type Page } from "playwright";
import type { CollectionResult, CollectedActivityItem } from "../types.js";
import { describeVisionImage } from "../instagram/index.js";

export type TwitterCollectorOptions = {
  username: string | undefined;
  sessionPath: string;
  now: Date;
  signal?: AbortSignal;
  aiProvider?: "openai" | "gemini";
  geminiApiKey?: string;
  geminiModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
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

    // 1. Fetch own tweets from the profile timeline
    const profileUrl = `https://x.com/${username}`;
    console.log(`[Twitter] Loading profile: ${profileUrl}`);
    await page.goto(profileUrl, { waitUntil: "networkidle", timeout: 25000 });
    if (options.signal?.aborted) throw new Error("Twitter collection aborted");
    const rawTweets = await scrapeTweetsFromPage(page);
    const processedTweets = await enrichTweetsWithVision(page, rawTweets, options, getDateStamp(options.now));

    // 2. Fetch likes
    const likesUrl = `https://x.com/${username}/likes`;
    console.log(`[Twitter] Loading likes: ${likesUrl}`);
    await page.goto(likesUrl, { waitUntil: "networkidle", timeout: 25000 });
    if (options.signal?.aborted) throw new Error("Twitter collection aborted");
    const rawLikes = await scrapeTweetsFromPage(page);
    const processedLikes = await enrichTweetsWithVision(page, rawLikes, options, getDateStamp(options.now));

    const allRawTweets = [...rawTweets, ...rawLikes]; // For raw log
    const allProcessedTweets = [...processedTweets, ...processedLikes];

    await browser.close();

    const dateStamp = getDateStamp(options.now); // YYYY-MM-DD

    const items: CollectedActivityItem[] = [];

    for (const t of allProcessedTweets) {
      if (!t.text.trim()) {
        continue;
      }

      const isLike = t.url && !t.url.includes(`/${username}/status/`);
      items.push({
        id: t.id || String(Math.random()),
        source: "twitter",
        text: isLike ? `Twitterで「いいね」しました: "${t.text}"` : t.text,
        createdAt: t.createdAt || collectedAt,
        url: t.url || undefined,
        metadata: {
          originalUrl: t.url,
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
  dateStamp: string
): Promise<any[]> {
  const results: any[] = [];
  for (const t of rawItems) {
    if (!t.createdAt) continue;
    const d = new Date(t.createdAt);
    const jstDate = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    if (jstDate !== dateStamp) continue;

    let finalText = t.text;
    if (t.hasImages && (options.geminiApiKey || options.openaiApiKey)) {
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

  // Scroll down to load more tweets (especially useful for likes)
  // より多くの「いいね」や投稿を捕捉するためスクロール回数を増やします
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
  // Always compare using JST YYYY-MM-DD to match filter logic
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
