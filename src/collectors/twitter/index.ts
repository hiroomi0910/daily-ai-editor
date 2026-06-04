import { existsSync } from "node:fs";
import { chromium } from "playwright";
import type { CollectionResult, CollectedActivityItem } from "../types.js";

export type TwitterCollectorOptions = {
  username: string | undefined;
  sessionPath: string;
  now: Date;
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
    await page.goto(`https://x.com/home`, { waitUntil: "domcontentloaded", timeout: 20000 });
    if (page.url().includes("login") || page.url().includes("flow/login")) {
      throw new Error(`Redirected to login page. Your Twitter/X session may have expired. Please re-authenticate by running 'npm run login:x'.`);
    }

    // 1. Fetch own tweets from the profile timeline
    const profileUrl = `https://x.com/${username}`;
    console.log(`[Twitter] Loading profile: ${profileUrl}`);
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    const rawTweets = await scrapeTweetsFromPage(page);

    // 2. Fetch likes
    const likesUrl = `https://x.com/${username}/likes`;
    console.log(`[Twitter] Loading likes: ${likesUrl}`);
    await page.goto(likesUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    const rawLikes = await scrapeTweetsFromPage(page);

    const allRawTweets = [...rawTweets, ...rawLikes];

    await browser.close();

    const dateStamp = getDateStamp(options.now); // YYYY-MM-DD

    // Filter items matching the target date
    const filteredItems = allRawTweets.filter((t) => {
      if (!t.createdAt) return false;
      try {
        const d = new Date(t.createdAt);
        // 日本時間(JST)での日付文字列を取得して比較
        const jstDate = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
        return jstDate === dateStamp;
      } catch {
        return t.createdAt.startsWith(dateStamp);
      }
    });

    console.log(`[Twitter] Total found: ${allRawTweets.length}. Today (${dateStamp}): ${filteredItems.length} matches.`);

    const items: CollectedActivityItem[] = [];

    for (const t of filteredItems) {
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

async function scrapeTweetsFromPage(page: any): Promise<any[]> {
  // Wait for React to settle
  await page.waitForTimeout(4000);
  
  try {
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 10000 });
  } catch (e) {
    // It's possible there are no tweets visible yet
  }

  return await page.$$eval('article[data-testid="tweet"]', (articles: Element[]) => {
    return articles.map((article) => {
      const textEl = article.querySelector('[data-testid="tweetText"]');
      const timeEl = article.querySelector('time');
      const linkEl = article.querySelector('a[href*="/status/"]');

      return {
        text: textEl ? textEl.textContent || "" : "",
        createdAt: timeEl ? timeEl.getAttribute("datetime") || "" : "",
        url: linkEl ? "https://x.com" + linkEl.getAttribute("href") : "",
        id: linkEl ? linkEl.getAttribute("href") || "" : "",
      };
    });
  });
}

function getDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
