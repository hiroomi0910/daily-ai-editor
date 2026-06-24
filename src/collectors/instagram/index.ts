import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import type { CollectionResult, CollectedActivityItem } from "../types.js";

const FEED_MIN_BUDGET_MS = 30_000;
const FEED_MAX_POSTS = 5;
const FEED_DATE_FAILURE_LIMIT = 2;

export type InstagramCollectorOptions = {
  username: string | undefined;
  sessionPath: string;
  now: Date;
  targetDate?: string;
  deadlineMs?: number;
  signal?: AbortSignal;
  aiProvider?: "openai" | "gemini";
  geminiApiKey?: string;
  geminiModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
};

type FeedPostRef = { url: string; text: string };

export async function collectInstagramActivity(
  options: InstagramCollectorOptions,
): Promise<CollectionResult> {
  const collectedAt = options.now.toISOString();
  const username = options.username?.trim();
  const dateStamp = getDateStamp(options.now);
  const storyCreatedAt = resolveStoryCreatedAt(options.targetDate, collectedAt);

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

  const items: CollectedActivityItem[] = [];
  const rawData: Record<string, unknown> = {};
  let feedSkippedReason: string | undefined;
  let partialReason: string | undefined;

  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      storageState: options.sessionPath,
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
    });

    const page = await context.newPage();
    const deadlineMs = options.deadlineMs;

    // First, check login status on stories page
    console.log(`[Instagram] Checking login status on stories page for ${username}...`);
    const storyUrl = `https://www.instagram.com/stories/${username}/`;
    await page.goto(storyUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    throwIfAborted(options.signal);
    await page.waitForTimeout(3000);

    const isNotLoggedIn = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes("消える前にこのストーリーズをチェックしよう") || 
             text.includes("Check out this story before it disappears") ||
             window.location.href.includes("/accounts/login");
    });

    if (isNotLoggedIn) {
      console.warn(`[Instagram] Login wall detected ("消える前にこのストーリーズをチェックしよう" or login redirect). Skipping all collection.`);
      return {
        source: "instagram",
        collectedAt,
        items: [],
        raw: {
          mode: "skipped",
          username,
          note: "ログインしていません（「消える前にこのストーリーズをチェックしよう」を検知しました）。'npm run login:instagram' を実行してログインセッションを更新してください。",
        },
      };
    }

    // Check if targetDate overlaps with the 24-hour active stories window
    let shouldSkipStories = false;
    if (options.targetDate) {
      const nowTime = new Date(); // Actual execution time
      const targetStart = new Date(`${options.targetDate}T00:00:00+09:00`);
      const targetEnd = new Date(`${options.targetDate}T23:59:59.999+09:00`);
      const twentyFourHoursAgo = new Date(nowTime.getTime() - 24 * 60 * 60 * 1000);

      const hasOverlap = targetStart <= nowTime && twentyFourHoursAgo <= targetEnd;
      if (!hasOverlap) {
        shouldSkipStories = true;
      }
    }

    let storyResult = { items: [] as CollectedActivityItem[], rawData: {} as Record<string, unknown> };
    if (shouldSkipStories) {
      console.log(`[Instagram] Target date (${options.targetDate}) is outside the active stories window. Skipping stories collection.`);
      storyResult.rawData = { storiesSkippedReason: `Target date (${options.targetDate}) has no overlap with active stories window.` };
    } else {
      // 1. STORY CRAWLING (always prioritized)
      storyResult = await collectStories(page, {
        username,
        dateStamp,
        storyCreatedAt,
        options,
        signal: options.signal,
        deadlineMs,
        alreadyNavigated: true,
      });
    }
    items.push(...storyResult.items);
    Object.assign(rawData, storyResult.rawData);

    if (isAborted(options.signal)) {
      partialReason = "aborted after story collection";
    } else if (hasTimeBudget(deadlineMs, FEED_MIN_BUDGET_MS)) {
      // 2. FEED POST CRAWLING (only when time budget allows)
      const feedResult = await collectFeedPosts(page, {
        username,
        dateStamp,
        options,
        signal: options.signal,
        deadlineMs,
      });
      items.push(...feedResult.items);
      Object.assign(rawData, feedResult.rawData);
      if (feedResult.skippedReason) {
        feedSkippedReason = feedResult.skippedReason;
      }
      if (isAborted(options.signal)) {
        partialReason = "aborted during feed collection";
      }
    } else {
      feedSkippedReason = `insufficient time budget (need ${FEED_MIN_BUDGET_MS}ms, stories took priority)`;
      console.warn(`[Instagram] ${feedSkippedReason}`);
    }

    const mode = partialReason || feedSkippedReason ? "partial" : "ok";
    return {
      source: "instagram",
      collectedAt,
      items,
      raw: {
        mode,
        rawData,
        ...(partialReason ? { partialReason } : {}),
        ...(feedSkippedReason ? { feedSkippedReason } : {}),
        itemCount: items.length,
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (items.length > 0) {
      console.warn(
        `[Instagram] Error after partial collection (${items.length} items): ${errMsg}`,
      );
      return {
        source: "instagram",
        collectedAt,
        items,
        raw: {
          mode: "partial",
          error: errMsg,
          itemCount: items.length,
          rawData,
        },
      };
    }
    return {
      source: "instagram",
      collectedAt,
      items: [],
      raw: {
        mode: "error",
        error: errMsg,
      },
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: true,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch {
    return await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
}

function hasTimeBudget(deadlineMs: number | undefined, minMs: number): boolean {
  if (deadlineMs === undefined) return true;
  return deadlineMs - Date.now() >= minMs;
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (isAborted(signal)) {
    throw new DOMException("Instagram collection aborted", "AbortError");
  }
}

/** P3: --date 指定時は JST 正午、通常実行時は collectedAt を使用 */
function resolveStoryCreatedAt(
  targetDate: string | undefined,
  collectedAt: string,
): string {
  if (targetDate) {
    return `${targetDate}T12:00:00+09:00`;
  }
  return collectedAt;
}

async function collectStories(
  page: Page,
  ctx: {
    username: string;
    dateStamp: string;
    storyCreatedAt: string;
    options: InstagramCollectorOptions;
    signal?: AbortSignal;
    deadlineMs?: number;
    alreadyNavigated?: boolean;
  },
): Promise<{
  items: CollectedActivityItem[];
  rawData: Record<string, unknown>;
}> {
  const { username, dateStamp, storyCreatedAt, options, signal, alreadyNavigated } = ctx;
  const items: CollectedActivityItem[] = [];
  const rawData: Record<string, unknown> = {};

  if (!alreadyNavigated) {
    console.log(`[Instagram] Checking stories for ${username}...`);
    const storyUrl = `https://www.instagram.com/stories/${username}/`;
    await page.goto(storyUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    throwIfAborted(signal);
    await page.waitForTimeout(3000);
  }

  // ストーリーズが0件の時のプレースホルダー画面（「消える前にこのストーリーズをチェックしよう」）を検知
  const isPlaceholder = await page.evaluate(() => {
    const text = document.body.innerText;
    return text.includes("消える前にこのストーリーズをチェックしよう") || 
           text.includes("Check out this story before it disappears");
  });

  if (isPlaceholder) {
    console.log(`[Instagram] Placeholder "Check out this story" detected. No active stories for ${username}.`);
    return { items, rawData: { ...rawData, hasActiveStory: false } };
  }

  // ストーリーズの枚数（進捗バーのセグメント数）を検出
  const progressBarSelector = 'div[role="progressbar"]';
  await page.waitForSelector(progressBarSelector, { timeout: 5000 }).catch(() => undefined);
  const totalSegments = await page.locator(progressBarSelector).count().catch(() => 0);

  let currentUrl = page.url();
  // 末尾スラッシュなしでも判定できるよう緩和
  const hasStory = currentUrl.includes(`/stories/${username}`);
  rawData.storiesUrl = currentUrl;
  rawData.hasActiveStory = hasStory;

  const storyItems: { text: string; url: string }[] = [];

  if (hasStory) {
    if (totalSegments > 0) {
      console.log(`[Instagram] ${totalSegments} 枚のストーリーズを検出しました。`);
    }
    let storyIndex = 1;
    const seenUrls = new Set<string>();

    try {
      // 枚数カウントは参考値とし、URLがユーザーのストーリーズである限り巡回を続ける
      while (currentUrl.includes(`/stories/${username}`)) {
        throwIfAborted(signal);

        const normalizedUrl = currentUrl.split("?")[0] ?? currentUrl;

        if (storyIndex > 20) {
          console.warn(
            "[Instagram] 処理したストーリーズが安全上限の20件を超えたため中断します。",
          );
          break;
        }

        if (seenUrls.has(normalizedUrl)) {
          console.log(
            `[Instagram] ストーリーズのURL遷移が検出されなかったためループを終了します。 (URL: ${normalizedUrl})`,
          );
          break;
        }
        seenUrls.add(normalizedUrl);

        const countSuffix = totalSegments > 0 ? `/${totalSegments}` : "";
        console.log(
          `[Instagram] ストーリーズ #${storyIndex}${countSuffix} を処理中... URL: ${currentUrl}`,
        );

        // ローディング画面を避けるため、画像または動画が表示されるまで待機
        await page
          .waitForSelector("section img[srcset], section video", {
            timeout: 10000,
          })
          .catch(() => undefined);
        // 動画や高解像度画像の読み込み完了を待つため、待機時間を延長
        await page.waitForTimeout(5000);
        throwIfAborted(signal);

        const storyText: string = await page.evaluate(() => {
          const viewer = document.querySelector("section");
          if (!viewer) return "";

          const elements = Array.from(viewer.querySelectorAll("span, div, p"));
          const texts = elements
            .filter((el) => {
              if (el.closest("nav") || el.closest('[role="navigation"]'))
                return false;
              const parent = el.parentElement?.tagName.toLowerCase();
              return parent !== "script" && parent !== "style";
            })
            .map((el) => (el.textContent || "").trim())
            .filter((t) => {
              const isGeneric =
                t.includes("stories") ||
                t.includes("Instagram") ||
                t.includes("{") ||
                t.includes("!");
              const isNavClump =
                t.includes("ホーム") &&
                t.includes("リール") &&
                t.includes("メッセージ");
              return t.length > 5 && !isGeneric && !isNavClump;
            });
          return texts.length > 0 ? (texts[0]?.trim() ?? "") : "";
        });

        let imageDescription = "";
        try {
          console.log(
            `[Instagram] ストーリーズ #${storyIndex} のスクリーンショットをキャプチャ中...`,
          );
          // ストーリーズは全画面表示のため、locator.screenshot の安定待ちを避け page.screenshot を使用
          const screenshotBuffer = await page.screenshot({ timeout: 15000 });
          throwIfAborted(signal);
          const base64Image = screenshotBuffer.toString("base64");

          console.log(
            `[Instagram] ストーリーズ #${storyIndex} の画像をAIで分析中...`,
          );
          imageDescription = await describeVisionImage(base64Image, options);
          console.log(`[Instagram] 画像描写結果: ${imageDescription}`);
        } catch (visionErr) {
          console.error(
            `[Instagram] 画像分析に失敗しました: ${visionErr instanceof Error ? visionErr.message : String(visionErr)}`,
          );
        }

        let itemText = "";
        if (storyText && imageDescription) {
          itemText = `Instagram ストーリーズを投稿しました: "${storyText}" (画像描写: ${imageDescription})`;
        } else if (storyText) {
          itemText = `Instagram ストーリーズを投稿しました: "${storyText}"`;
        } else if (imageDescription) {
          itemText = `Instagram ストーリーズを投稿しました (画像内容: ${imageDescription})`;
        } else {
          itemText = "Instagram ストーリーズを投稿しました。";
        }

        storyItems.push({ text: itemText, url: currentUrl });

        console.log(
          "[Instagram] キーボードの右矢印キーを入力して次のスライドへ遷移します...",
        );
        await page.focus("section").catch(() => undefined);

        const oldUrl = currentUrl;

        // キーボード操作とクリックを同時に行うと、スライドを飛ばしたりビューワーを閉じてしまう原因になるため、
        // まずキーボードを試し、URLが更新されなければクリックを試行するように変更。
        await page.keyboard.press("ArrowRight");

        // URLが更新されるまで待機（最大6秒に延長）
        let changed = await page
          .waitForFunction((prev) => window.location.href !== prev, oldUrl, {
            timeout: 6000,
          })
          .catch(() => false);
        if (!changed) {
          console.log(
            "[Instagram] キーボード反応なし。要素クリックまたは座標クリックを試行します...",
          );

          // 「次へ」ボタンのセレクタを試行
          const nextBtn = page
            .locator(
              'div[role="button"][aria-label="Next"], div[role="button"][aria-label="次へ"]',
            )
            .first();
          if (await nextBtn.isVisible()) {
            await nextBtn.click({ timeout: 3000 }).catch(() => undefined);
          } else {
            const { width, height } = page.viewportSize() || {
              width: 1280,
              height: 800,
            };
            // 閉じるボタン（右上）を避けるため、右から20%・中央の高さあたりをクリック
            await page.mouse
              .click(width * 0.8, height / 2)
              .catch(() => undefined);
          }

          await page
            .waitForFunction((prev) => window.location.href !== prev, oldUrl, {
              timeout: 6000,
            })
            .catch(() => undefined);
        }

        // スライド切り替え後の安定待ち（動画ストーリーズなどの読み込みを考慮）
        await page.waitForTimeout(3000);

        currentUrl = page.url();
        storyIndex++;
      }

      console.log(
        `[Instagram] ストーリーズの巡回が完了しました。 (最終URL: ${currentUrl})`,
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) throw e;
      console.warn(
        `[Instagram] ストーリーズ収集中に中断 — それまでの ${storyItems.length} 件を保持します`,
      );
    }

    let idx = 1;
    for (const story of storyItems) {
      items.push({
        id: `instagram-story-${dateStamp}-${idx}`,
        source: "instagram",
        text: story.text,
        createdAt: storyCreatedAt,
        url: story.url,
        metadata: {
          type: "story",
          index: idx,
          total: storyItems.length,
        },
      });
      idx++;
    }

    rawData.storyItems = storyItems;
    rawData.hasActiveStory = true;
  }

  return { items, rawData };
}

async function collectFeedPosts(
  page: Page,
  ctx: {
    username: string;
    dateStamp: string;
    options: InstagramCollectorOptions;
    signal?: AbortSignal;
    deadlineMs?: number;
  },
): Promise<{
  items: CollectedActivityItem[];
  rawData: Record<string, unknown>;
  skippedReason?: string;
}> {
  const { username, options, signal } = ctx;
  const items: CollectedActivityItem[] = [];
  const rawData: Record<string, unknown> = {};

  console.log(`[Instagram] Checking feed posts for ${username}...`);
  const profileUrl = `https://www.instagram.com/${username}/`;
  await page.goto(profileUrl, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  throwIfAborted(signal);

  try {
    await page.waitForSelector("article img", { timeout: 8000 });
  } catch {
    // No posts loaded
  }

  const rawFeedPosts = dedupeFeedPosts(
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
      return links.map((link) => {
        const href = link.getAttribute("href") ?? "";
        const url = href.startsWith("http")
          ? href
          : `https://www.instagram.com${href}`;
        const img = link.querySelector("img");
        const altText = img ? img.getAttribute("alt") || "" : "";
        return { url, text: altText };
      });
    }),
  );

  rawData.feedPosts = rawFeedPosts;
  rawData.feedPostsChecked = rawFeedPosts.length;

  let consecutiveDateFailures = 0;
  const targetDateStr = getDateStamp(options.now);

  for (const post of rawFeedPosts) {
    throwIfAborted(signal);

    if (!post?.url) continue;

    console.log(`[Instagram] 投稿の日付を検証中: ${post.url}`);
    try {
      await page.goto(post.url, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      throwIfAborted(signal);

      const timestamp = await page.getAttribute("time", "datetime");
      if (!timestamp) {
        consecutiveDateFailures++;
        console.warn(
          `[Instagram] 投稿 (${post.url}) の日付要素が取得できません (${consecutiveDateFailures}/${FEED_DATE_FAILURE_LIMIT})`,
        );
        if (consecutiveDateFailures >= FEED_DATE_FAILURE_LIMIT) {
          console.warn(
            "[Instagram] 日付取得の連続失敗上限に達したため、フィード収集を終了します。",
          );
          break;
        }
        continue;
      }

      consecutiveDateFailures = 0;
      const postDate = new Date(timestamp);
      const postDateStr = postDate.toLocaleDateString("sv-SE", {
        timeZone: "Asia/Tokyo",
      });

      console.log(
        `[Instagram] Post date: ${postDateStr}, Target date: ${targetDateStr}`,
      );

      if (postDateStr === targetDateStr) {
        // 対象日と一致：収集を継続
      } else if (postDateStr < targetDateStr) {
        // 対象日より古い：これ以上新しい投稿はないと判断し終了
        console.log(`[Instagram] 投稿 (${post.url}) は対象日 (${targetDateStr}) より古いため、フィード収集を終了します。`);
        break;
      } else {
        // 対象日より新しい：スキップして次を探す（遡り実行時など）
        console.log(`[Instagram] 投稿 (${post.url}) は対象日 (${targetDateStr}) より新しいため、スキップします。`);
        continue;
      }

      const imageDescriptions: string[] = [];
      try {
        console.log(
          "[Instagram] フィード投稿の分析を開始します（カルーセル対応）...",
        );
        let carouselIdx = 1;
        let hasNext = true;

        while (hasNext && carouselIdx <= 10) {
          throwIfAborted(signal);

          console.log(
            `[Instagram] フィード画像 #${carouselIdx} をキャプチャ中...`,
          );
          const articleLocator = page.locator("article").first();
          const hasArticle = (await articleLocator.count()) > 0;
          const screenshotBuffer = await (
            hasArticle ? articleLocator : page
          ).screenshot({
            timeout: 15000,
            animations: "disabled",
          });
          throwIfAborted(signal);
          const base64Image = screenshotBuffer.toString("base64");

          console.log(
            `[Instagram] フィード画像 #${carouselIdx} をAIで分析中...`,
          );
          const desc = await describeVisionImage(base64Image, options);
          imageDescriptions.push(desc);
          console.log(`[Instagram] 画像 #${carouselIdx} 描写: ${desc}`);

          const nextButton = page.locator('button[aria-label*="次へ"]').first();
          if (await nextButton.isVisible()) {
            await nextButton.click();
            await page.waitForTimeout(1200);
            carouselIdx++;
          } else {
            hasNext = false;
          }
        }
      } catch (visionErr) {
        console.error(
          `[Instagram] フィード投稿の画像分析中にエラーが発生しました: ${visionErr instanceof Error ? visionErr.message : String(visionErr)}`,
        );
      }

      const feedImageDescription = imageDescriptions.join("、");
      const baseText = post.text.trim();
      let itemText = "";
      if (baseText && feedImageDescription) {
        itemText = `Instagram に写真を投稿しました: "${baseText}" (画像描写: ${feedImageDescription})`;
      } else if (baseText) {
        itemText = `Instagram に写真を投稿しました: "${baseText}"`;
      } else if (feedImageDescription) {
        itemText = `Instagram に写真を投稿しました (画像内容: ${feedImageDescription})`;
      } else {
        itemText = "Instagram に写真を投稿しました。";
      }

      items.push({
        id: post.url,
        source: "instagram",
        text: itemText,
        createdAt: postDate.toISOString(),
        url: post.url,
        metadata: { type: "post" },
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      console.error(
        `[Instagram] Failed to verify post date: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { items, rawData };
}

function dedupeFeedPosts(posts: FeedPostRef[]): FeedPostRef[] {
  const seen = new Set<string>();
  const result: FeedPostRef[] = [];

  for (const post of posts) {
    const normalized = post.url.split("?")[0] ?? post.url;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ ...post, url: normalized });
    if (result.length >= FEED_MAX_POSTS) break;
  }

  return result;
}

function getDateStamp(date: Date): string {
  // 実行環境によらず、常に日本時間での YYYY-MM-DD を取得する
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

type VisionResult = { text: string; truncated: boolean };

async function withSimpleRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  delay = 2000,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < maxRetries)
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
    }
  }
  throw lastError;
}

export async function describeVisionImage(
  base64Image: string,
  options: {
    aiProvider?: "openai" | "gemini";
    geminiApiKey?: string;
    geminiModel?: string;
    openaiApiKey?: string;
    openaiModel?: string;
    signal?: AbortSignal;
  },
): Promise<string> {
  const prompt =
    "これはInstagramのスクリーンショットです。画像内の主な内容を、前置きなく1文（80字以内）の日本語で客観的に描写してください。絶対に画像内の文字を1文字ずつインデックス番号付きで書き出したりしないでください（例：『あ(1) い(2)』のような形式は禁止）。箇条書きや不必要な数字、座標の付与も絶対に避けてください。";

  const attemptGemini = async (): Promise<VisionResult> => {
    if (!options.geminiApiKey)
      throw new Error("Gemini API key is not configured.");
    const model = options.geminiModel ?? "gemini-3.1-flash-lite";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${options.geminiApiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType: "image/png", data: base64Image } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1024,
        },
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Vision API error: ${res.status} - ${errText}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    };
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error("Empty response from Gemini Vision API");

    const truncated = candidate?.finishReason === "MAX_TOKENS";
    if (truncated) {
      console.warn(
        "[Instagram] Gemini Vision output was truncated (MAX_TOKENS)",
      );
    }
    return { text, truncated };
  };

  const attemptOpenAI = async (): Promise<VisionResult> => {
    if (!options.openaiApiKey)
      throw new Error("OpenAI API key is not configured.");
    const model = options.openaiModel ?? "gpt-4o-mini";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${base64Image}` },
              },
            ],
          },
        ],
        temperature: 0.4,
        max_tokens: 1024,
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI Vision API error: ${res.status} - ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
    };
    const choice = data.choices?.[0];
    const text = choice?.message?.content?.trim();
    if (!text) throw new Error("Empty response from OpenAI Vision API");

    const truncated = choice?.finish_reason === "length";
    if (truncated) {
      console.warn("[Instagram] OpenAI Vision output was truncated (length)");
    }
    return { text, truncated };
  };

  const runWithFallback = async (
    primary: () => Promise<VisionResult>,
    fallback: (() => Promise<VisionResult>) | undefined,
  ): Promise<string> => {
    try {
      const result = await withSimpleRetry(primary);
      if (result.truncated && fallback) {
        try {
          const fallbackResult = await withSimpleRetry(fallback);
          return fallbackResult.text;
        } catch {
          return result.text;
        }
      }
      return result.text;
    } catch (err) {
      if (!fallback) throw err;
      console.warn(
        `[Instagram] Primary Vision failed: ${err instanceof Error ? err.message : String(err)}. Trying fallback...`,
      );
      const fallbackResult = await withSimpleRetry(fallback);
      return fallbackResult.text;
    }
  };

  const primaryProvider = options.aiProvider ?? "openai";
  if (primaryProvider === "gemini" && options.geminiApiKey) {
    return runWithFallback(
      () => attemptGemini(),
      options.openaiApiKey ? () => attemptOpenAI() : undefined,
    );
  }
  if (options.openaiApiKey) {
    return runWithFallback(
      () => attemptOpenAI(),
      options.geminiApiKey ? () => attemptGemini() : undefined,
    );
  }
  if (options.geminiApiKey) {
    const result = await withSimpleRetry(() => attemptGemini());
    return result.text;
  }
  throw new Error(
    "No Vision API key configured (GEMINI_API_KEY or OPENAI_API_KEY required).",
  );
}
