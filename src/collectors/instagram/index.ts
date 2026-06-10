import { existsSync } from "node:fs";
import { chromium } from "playwright";
import type { CollectionResult, CollectedActivityItem } from "../types.js";

export type InstagramCollectorOptions = {
  username: string | undefined;
  sessionPath: string;
  now: Date;
  aiProvider?: "openai" | "gemini";
  geminiApiKey?: string;
  geminiModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
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

    let currentUrl = page.url();
    // ユーザー名が含まれるストーリーズURLであることを厳密にチェック
    const hasStory = currentUrl.includes(`/stories/${username}/`);
    rawData.storiesUrl = currentUrl;
    rawData.hasActiveStory = hasStory;

    const storyItems: { text: string; url: string }[] = [];

    if (hasStory) {
      let storyIndex = 1;
      const seenUrls = new Set<string>();

      while (currentUrl.includes(`/stories/${username}/`)) {
        // 無限ループ防止用の安全弁（最大20件まで）
        if (storyIndex > 20) {
          console.warn("[Instagram] 処理したストーリーズが安全上限の20件を超えたため中断します。");
          break;
        }

        // ページ遷移がスタックした場合の重複処理防止
        if (seenUrls.has(currentUrl)) {
          console.log("[Instagram] ストーリーズのURL遷移が検出されなかったためループを終了します。");
          break;
        }
        seenUrls.add(currentUrl);

        console.log(`[Instagram] ストーリーズ #${storyIndex} を処理中... URL: ${currentUrl}`);
        // メディアのロードとアニメーションの落ち着きを待つ
        await page.waitForTimeout(2000);

        // Check if there is any visible text inside the story
        const storyText: string = await page.evaluate(() => {
          const viewer = document.querySelector('section');
          if (!viewer) return "";

          const elements = Array.from(viewer.querySelectorAll("span, div, p"));
          const texts = elements
            .filter(el => {
              if (el.closest('nav') || el.closest('[role="navigation"]')) return false;
              const parent = el.parentElement?.tagName.toLowerCase();
              return parent !== 'script' && parent !== 'style';
            })
            .map((el: any) => (el.textContent || "").trim())
            .filter((t) => {
              const isGeneric = t.includes("stories") || t.includes("Instagram") || t.includes("{") || t.includes("!");
              const isNavClump = t.includes("ホーム") && t.includes("リール") && t.includes("メッセージ");
              return t.length > 5 && !isGeneric && !isNavClump;
            });
          return texts.length > 0 ? texts[0].trim() : "";
        });

        let imageDescription = "";
        try {
          console.log(`[Instagram] ストーリーズ #${storyIndex} のスクリーンショットをキャプチャ中...`);
          let screenshotBuffer: Buffer;
          if (await page.locator('section').count() > 0) {
            screenshotBuffer = await page.locator('section').screenshot();
          } else {
            screenshotBuffer = await page.screenshot();
          }
          const base64Image = screenshotBuffer.toString("base64");

          console.log(`[Instagram] ストーリーズ #${storyIndex} の画像をAIで分析中...`);
          imageDescription = await describeStoryImage(base64Image, options);
          console.log(`[Instagram] 画像描写結果: ${imageDescription}`);
        } catch (visionErr) {
          console.error(`[Instagram] 画像分析に失敗しました: ${visionErr instanceof Error ? visionErr.message : String(visionErr)}`);
        }

        // 取得結果テキストを構築
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

        storyItems.push({
          text: itemText,
          url: currentUrl,
        });

        // キーボードの矢印キーで次のストーリーズへ遷移をシミュレート
        console.log("[Instagram] キーボードの右矢印キーを入力して次のスライドへ遷移します...");
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(1500); // 遷移アニメーション待機

        currentUrl = page.url();
        storyIndex++;
      }

      // 収集したストーリーズを収集データ項目に追加
      let idx = 1;
      for (const story of storyItems) {
        items.push({
          id: `instagram-story-${dateStamp}-${idx}`,
          source: "instagram",
          text: story.text,
          createdAt: collectedAt,
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

async function describeStoryImage(
  base64Image: string,
  options: InstagramCollectorOptions,
): Promise<string> {
  const prompt = "これはユーザーのInstagramストーリーズのスクリーンショットです。この画像に写っている内容（テキストがあればそれも含め、画像に描かれているものや情景、雰囲気）を簡潔に1〜2文の日本語で客観的に説明してください。日記の材料として使います。「ユーザーが投稿した画像には〜が写っています」などのように三人称で客観的に描写してください。余計な前置き（「はい、お答えします」など）は省き、描写のみを返してください。";

  const attemptGemini = async () => {
    if (!options.geminiApiKey) throw new Error("Gemini API key is not configured.");
    const model = options.geminiModel ?? "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${options.geminiApiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/png",
                  data: base64Image,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1000,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Vision API error: ${res.status} - ${errText}`);
    }

    const data = await res.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return text.trim();
    throw new Error("Empty response from Gemini Vision API");
  };

  const attemptOpenAI = async () => {
    if (!options.openaiApiKey) throw new Error("OpenAI API key is not configured.");
    const model = options.openaiModel ?? "gpt-4o-mini";
    const url = "https://api.openai.com/v1/chat/completions";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${options.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        temperature: 0.4,
        max_tokens: 1000,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI Vision API error: ${res.status} - ${errText}`);
    }

    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content;
    if (text) return text.trim();
    throw new Error("Empty response from OpenAI Vision API");
  };

  const primaryProvider = options.aiProvider ?? "openai";
  if (primaryProvider === "gemini") {
    try {
      return await attemptGemini();
    } catch (err) {
      console.warn(`[Instagram] Gemini Vision failed: ${err instanceof Error ? err.message : String(err)}. Trying OpenAI fallback...`);
      if (options.openaiApiKey) {
        return await attemptOpenAI();
      }
      throw err;
    }
  } else {
    try {
      return await attemptOpenAI();
    } catch (err) {
      console.warn(`[Instagram] OpenAI Vision failed: ${err instanceof Error ? err.message : String(err)}. Trying Gemini fallback...`);
      if (options.geminiApiKey) {
        return await attemptGemini();
      }
      throw err;
    }
  }
}
