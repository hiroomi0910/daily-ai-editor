import { existsSync } from "node:fs";
import { chromium } from "playwright";
import type { CollectionResult, CollectedActivityItem } from "../types.js";

export type InstagramCollectorOptions = {
  username: string | undefined;
  sessionPath: string;
  now: Date;
};

export async function collectInstagramActivity(
  options: InstagramCollectorOptions,
): Promise<CollectionResult> {
  const collectedAt = options.now.toISOString();
  const username = options.username?.trim();

  if (!username) {
    return {
      source: "instagram",
      collectedAt,
      items: [],
      raw: {
        mode: "skipped",
        username: null,
        note: "SIZU_INSTAGRAM_USERNAME is not configured. Instagram collection skipped.",
      },
    };
  }

  if (!existsSync(options.sessionPath)) {
    return {
      source: "instagram",
      collectedAt,
      items: [],
      raw: {
        mode: "skipped",
        username,
        note: `Session file not found at ${options.sessionPath}. Please run 'npm run login:instagram' first.`,
      },
    };
  }

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
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
    });

    const page = await context.newPage();
    const dateStamp = getDateStamp(options.now); // YYYY-MM-DD
    const items: CollectedActivityItem[] = [];
    const rawData: Record<string, any> = {};

    // 1. STORY CRAWLING
    console.log(`[Instagram] Checking stories for ${username}...`);
    const storyUrl = `https://www.instagram.com/stories/${username}/`;
    await page.goto(storyUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000); // Wait for potential redirects

    const currentUrl = page.url();
    const hasStory = currentUrl.includes("/stories/");
    rawData.storiesUrl = currentUrl;
    rawData.hasActiveStory = hasStory;

    if (hasStory) {
      // Stories exist! Let's check if there is any visible text inside the story
      const storyText: string = await page.evaluate(() => {
        // Look for text in stories (commonly spans/divs inside a story element)
        // Exclude script, style and common UI patterns
        const elements = Array.from(document.querySelectorAll("span, div, p"));
        const texts = elements
          .filter(el => {
            const parent = el.parentElement?.tagName.toLowerCase();
            return parent !== 'script' && parent !== 'style';
          })
          .map((el: any) => el.textContent || "")
          .filter((t) => t.trim().length > 5 && !t.includes("stories") && !t.includes("Instagram") && !t.includes("{") && !t.includes("!"));
        return texts.length > 0 ? texts[0].trim() : "";
      });

      rawData.storyText = storyText;
      if (storyText) {
        items.push({
          id: `instagram-story-${dateStamp}`,
          source: "instagram",
          text: `Instagram ストーリーズを投稿しました: "${storyText}"`,
          createdAt: collectedAt,
          url: currentUrl,
          metadata: {
            type: "story",
          },
        });
      }
    }

    // 2. FEED POST CRAWLING
    console.log(`[Instagram] Checking feed posts for ${username}...`);
    const profileUrl = `https://www.instagram.com/${username}/`;
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

    try {
      await page.waitForSelector("article img", { timeout: 10000 });
    } catch {
      // No posts loaded
    }

    // Extract latest posts from profile grid
    const rawFeedPosts = await page.evaluate(() => {
      // In Instagram web profile, posts are under link tags containing "/p/"
      const links = Array.from(document.querySelectorAll("a[href*=\"/p/\"]"));
      return links.map((link: any) => {
        const url = "https://www.instagram.com" + link.getAttribute("href");
        const img = link.querySelector("img");
        const altText = img ? img.getAttribute("alt") || "" : "";
        return {
          url,
          text: altText,
        };
      });
    });

    rawData.feedPosts = rawFeedPosts;

    // Strictly verify the date of the latest post
    if (rawFeedPosts.length > 0) {
      const latestPost = rawFeedPosts[0];
      if (latestPost && latestPost.url) {
        console.log(`[Instagram] Verifying date for the latest post: ${latestPost.url}`);

        try {
          await page.goto(latestPost.url, { waitUntil: "domcontentloaded", timeout: 15000 });
          // Instagram posts have a <time> element with a datetime attribute
          const timestamp = await page.getAttribute("time", "datetime");

          if (timestamp) {
            const postDate = new Date(timestamp);
            const postDateStr = postDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
            const targetDateStr = getDateStamp(options.now);

            console.log(`[Instagram] Post date: ${postDateStr}, Target date: ${targetDateStr}`);

            if (postDateStr === targetDateStr) {
              items.push({
                id: latestPost.url,
                source: "instagram",
                text: latestPost.text.trim()
                  ? `Instagram に写真を投稿しました: "${latestPost.text}"`
                  : "Instagram に写真を投稿しました。",
                createdAt: postDate.toISOString(),
                url: latestPost.url,
                metadata: {
                  type: "post",
                },
              });
            } else {
              console.log("[Instagram] The latest post is not from today. Skipping.");
            }
          }
        } catch (e) {
          console.error(`[Instagram] Failed to verify post date: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    await browser.close();

    return {
      source: "instagram",
      collectedAt,
      items,
      raw: {
        mode: "ok",
        rawData,
      },
    };

  } catch (error) {
    if (browser) {
      await browser.close();
    }
    return {
      source: "instagram",
      collectedAt,
      items: [],
      raw: {
        mode: "error",
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function getDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
