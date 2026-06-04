import { chromium } from "playwright";
import type { CollectionResult, CollectedActivityItem } from "../types.js";

export type ThreadsCollectorOptions = {
  username: string | undefined;
  now: Date;
};

export async function collectThreadsPosts(
  options: ThreadsCollectorOptions,
): Promise<CollectionResult> {
  const collectedAt = options.now.toISOString();
  const username = options.username?.trim();

  if (!username) {
    return {
      source: "threads",
      collectedAt,
      items: [],
      raw: {
        mode: "skipped",
        username: null,
        note: "SIZU_THREADS_USERNAME is not configured. Threads collection skipped.",
      },
    };
  }

  const profileUrl = `https://www.threads.net/@${username}`;
  let browser;
  try {
    // Launch Chrome with AutomationControlled disabled for stability
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
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
    });

    const page = await context.newPage();
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Wait briefly for content to render. Threads pages are dynamic.
    // Try to wait for any of standard container selectors.
    try {
      await page.waitForSelector("div[data-pressable=\"true\"]", { timeout: 10000 });
    } catch {
      // Fallback or skip if not found
    }

    // Crawl thread items
    // Threads structure: typically elements with text content, links, and times.
    // We can evaluate all text containers to find threads.
    const rawThreads = await page.evaluate(() => {
      // Locate pressable thread cards
      const elements = Array.from(document.querySelectorAll("div[data-pressable=\"true\"]"));
      return elements.map((el: any) => {
        // Look for text, time, and link elements
        const textElements = Array.from(el.querySelectorAll("span"));
        // Filter out very short or purely UI elements
        const text = textElements
          .map((s: any) => s.textContent || "")
          .filter((t: string) => t.trim().length > 3)
          .join(" ") || "";

        // Threads links status status page contains status status ID
        const linkEl = el.querySelector("a[href*=\"/post/\"]") || el.querySelector("a[href*=\"/t/\"]");
        const url = linkEl ? "https://www.threads.net" + linkEl.getAttribute("href") : "";

        // Timestamps in Threads usually have a time element or span with text like "1h", "2d" or datetime.
        // We look for time tags.
        const timeEl = el.querySelector("time");
        const datetime = timeEl ? timeEl.getAttribute("datetime") || "" : "";

        return {
          text,
          url,
          datetime,
        };
      });
    });

    await browser.close();

    const dateStamp = getDateStamp(options.now); // YYYY-MM-DD
    const items: CollectedActivityItem[] = [];

    for (const t of rawThreads) {
      if (!t.text.trim()) {
        continue;
      }

      // Threads datetime is in ISO string, e.g., "2026-05-29T00:46:01.000Z"
      // If we don't have datetime, we fallback to today to be safe, but let's check matches
      const isToday = t.datetime ? t.datetime.startsWith(dateStamp) : true;

      if (isToday) {
        items.push({
          id: t.url || String(Math.random()),
          source: "threads",
          text: t.text,
          createdAt: t.datetime || collectedAt,
          url: t.url || undefined,
        });
      }
    }

    return {
      source: "threads",
      collectedAt,
      items,
      raw: {
        mode: "ok",
        url: profileUrl,
        response: rawThreads,
      },
    };

  } catch (error) {
    if (browser) {
      await browser.close();
    }
    return {
      source: "threads",
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
