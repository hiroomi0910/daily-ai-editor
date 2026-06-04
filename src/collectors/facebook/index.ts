import { existsSync } from "node:fs";
import { chromium } from "playwright";
import type { CollectionResult, CollectedActivityItem } from "../types.js";

export type FacebookCollectorOptions = {
  username: string | undefined;
  sessionPath: string;
  now: Date;
};

export async function collectFacebookActivity(
  options: FacebookCollectorOptions,
): Promise<CollectionResult> {
  const collectedAt = options.now.toISOString();
  const username = options.username?.trim();

  if (!username) {
    return {
      source: "facebook",
      collectedAt,
      items: [],
      raw: {
        mode: "skipped",
        username: null,
        note: "SIZU_FACEBOOK_USERNAME is not configured. Facebook collection skipped.",
      },
    };
  }

  if (!existsSync(options.sessionPath)) {
    return {
      source: "facebook",
      collectedAt,
      items: [],
      raw: {
        mode: "skipped",
        username,
        note: `Session file not found at ${options.sessionPath}. Please run 'npm run login:facebook' first.`,
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

    // Navigate directly to Facebook Activity Log for Likes and Reactions
    console.log("[Facebook] Navigating to Likes & Reactions activity log...");
    const url = "https://www.facebook.com/me/allactivity?category_key=LIKEDPOSTS";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });

    // Wait for the activity log container to load
    try {
      await page.waitForSelector("div[role=\"feed\"]", { timeout: 15000 });
    } catch {
      // Fallback selector or let it load
    }

    // Capture the text items in the activity list.
    // Facebook Groups items by days.
    // We look for rows that describe likes/reactions.
    const rawActivities = await page.evaluate(() => {
      // Find all divs that act as text blocks or list rows in activity log
      const divs = Array.from(document.querySelectorAll("div[role=\"article\"], div[class*=\"x1y1t1xp\"]"));
      return divs.map((div: any) => {
        const text = div.textContent || "";
        return {
          text: text.trim(),
        };
      }).filter((item) => item.text.length > 5);
    });

    await browser.close();

    const items: CollectedActivityItem[] = [];
    const dateStamp = getDateStamp(options.now); // YYYY-MM-DD
    
    // Parse the activities. We look for keywords like "いいねしました", "超いいね！しました" or English equivalents.
    // To match today's date, Facebook uses text headers like "今日" or "Today" or specific dates.
    // We'll search for rows indicating likes/reactions and filter out duplicates.
    const uniqueTexts = new Set<string>();

    for (const act of rawActivities) {
      const text = act.text;
      
      // Keywords that match reaction logs
      const isLike = text.includes("いいね") || text.includes("リアクション") || text.includes("liked") || text.includes("reacted");
      
      if (isLike && !uniqueTexts.has(text)) {
        uniqueTexts.add(text);

        // Standardize the text into a clean record
        items.push({
          id: String(Math.random()),
          source: "facebook",
          text: `Facebook アクティビティ: "${text.split("\n")[0]}"`, // Grab the main sentence
          createdAt: collectedAt,
        });
      }
    }

    return {
      source: "facebook",
      collectedAt,
      items: items.slice(0, 10), // Return top 10 matched activities
      raw: {
        mode: "ok",
        url,
        response: rawActivities,
      },
    };

  } catch (error) {
    if (browser) {
      await browser.close();
    }
    return {
      source: "facebook",
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
