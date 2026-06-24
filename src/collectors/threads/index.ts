import { chromium, type Page } from "playwright";
import type { CollectionResult, CollectedActivityItem } from "../types.js";
import { describeVisionImage } from "../instagram/index.js";

export type ThreadsCollectorOptions = {
  username: string | undefined;
  now: Date;
  signal?: AbortSignal;
  aiProvider?: "openai" | "gemini";
  geminiApiKey?: string;
  geminiModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
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

  // ユーザー名に @ が含まれている場合を考慮して正規化
  const sanitizedUsername = username.startsWith('@') ? username.slice(1) : username;
  const profileUrl = `https://www.threads.net/@${sanitizedUsername}`;

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
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
    });

    const page = await context.newPage();
    // networkidle まで待機して React の初期描画を確実にする
    await page.goto(profileUrl, { waitUntil: "load", timeout: 35000 });
    await page.waitForTimeout(5000);

    // ログイン画面へリダイレクトされたかチェック（公開プロフィールの閲覧制限）
    if (page.url().includes("login") || page.url().includes("flow/login")) {
      console.warn(`[Threads] ログイン画面へリダイレクトされました。プロフィールの閲覧が制限されている可能性があります: ${page.url()}`);
    }

    // 要素の出現を待機
    try {
      await page.waitForSelector("article, time, [role='main']", { timeout: 20000 });
    } catch (e) {
      console.warn(`[Threads] コンテンツの待機中にタイムアウトしましたが、取得を試みます。`);
    }

    // スクロールしてコンテンツをハイドレーションさせる
    console.log(`[Threads] 過去の投稿を捕捉するためスクロール中...`);
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(2000);
      if (options.signal?.aborted) throw new Error("Aborted");
    }

    // スクロール後に要素が安定するのを待つ
    await page.waitForTimeout(3000);

    // Crawl thread items
    // articleタグやtime要素を起点に記事を特定
    const rawThreads = await page.evaluate((targetUsername) => {
      // Threads の投稿には必ず /post/ または /t/ を含むリンクが存在する
      const postLinks = Array.from(document.querySelectorAll('a[href*="/post/"], a[href*="/t/"]'));
      
      // 重複排除のためのURLセット
      const seenUrls = new Set<string>();

      return postLinks
        .map((el) => {
          // リンクから親コンテナ（投稿の塊）を探す
          const container = el.closest('article') || 
                            el.closest('[role="article"]') || 
                            el.closest('div[data-pressable="true"]') ||
                            el.parentElement?.closest('div');
          
          if (!container) return null;

          const href = el.getAttribute("href") || "";
          const url = href.startsWith("http") ? href : "https://www.threads.net" + href;
          const normalizedUrl = url.split("?")[0] || "";

          if (seenUrls.has(normalizedUrl)) return null;
          seenUrls.add(normalizedUrl);

          const timeEl = container.querySelector("time");
          const datetime = timeEl ? timeEl.getAttribute("datetime") || "" : "";

          const spans = Array.from(container.querySelectorAll("span"));
          const text = spans
            .map((s: any) => s.textContent || "")
            .filter((t: string) => {
              const val = t.trim();
              // UI部品（返信数、相対時間表示など）やユーザー名を除去
              return (
                val.length > 0 &&
                !/^\d+件の返信$/.test(val) &&
                !/^\d+件の「いいね！」$/.test(val) &&
                !/^\d+[秒分時日]/.test(val) &&
                !/^\d+[smhd]$/.test(val) &&
                !val.includes("前") &&
                val !== targetUsername
              );
            })
            .join(" ");

          // 画像の有無: scontent (Instagram/Threadsの画像サーバー) のURLを持つimgタグを探す
          const hasImages = container.querySelectorAll('img[src*="scontent"]').length > 1;

          return {
            text: text.trim(),
            url: normalizedUrl,
            datetime,
            hasImages,
          };
        })
        .filter((item): item is NonNullable<typeof item> => !!(item && item.url && item.text))
        .reduce((acc, current) => {
          if (!acc.find(item => item.url === current.url)) {
            acc.push(current);
          }
          return acc;
        }, [] as any[]);
    }, sanitizedUsername);

    const dateStamp = getDateStamp(options.now); // YYYY-MM-DD
    const items: CollectedActivityItem[] = [];

    console.log(
      `[Threads] ページから ${rawThreads.length} 件の投稿を検出しました。日付: ${dateStamp} でフィルタリング中...`,
    );

    for (const t of rawThreads) {
      const textPreview = t.text.trim().slice(0, 40).replace(/\r?\n/g, " ");
      if (!t.text.trim()) {
        console.log(`[Threads] Skip: 本文が空です (${t.url})`);
        continue;
      }

      const d = t.datetime ? new Date(t.datetime) : null;
      const jstDate = d
        ? d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })
        : "unknown";
      const isToday = jstDate === dateStamp;

      if (isToday) {
        let finalText = t.text;

        // 画像解析の実行
        if (t.hasImages && (options.geminiApiKey || options.openaiApiKey)) {
          try {
            console.log(
              `[Threads] 画像が含まれる投稿を検出しました。解析中: ${t.url}`,
            );            // 対象の投稿要素を特定してスクリーンショット撮影
            const postPath = t.url.match(/\/post\/[^\/\?]+/)?.[0];
            const article = page
              .locator(`article:has(a[href*="${postPath}"])`)
              .first();
            if (await article.count() > 0) {
              const screenshotBuffer = await article.screenshot({ timeout: 10000 });
              const base64Image = screenshotBuffer.toString("base64");
              const description = await describeVisionImage(base64Image, {
                aiProvider: options.aiProvider,
                geminiApiKey: options.geminiApiKey,
                geminiModel: options.geminiModel,
                openaiApiKey: options.openaiApiKey,
                openaiModel: options.openaiModel,
                signal: options.signal,
              });
              finalText = `${t.text} (画像描写: ${description})`;
              console.log(`[Threads] 画像解析完了: ${description}`);
            }
          } catch (e) {
            console.warn(
              `[Threads] 画像解析に失敗しましたが、テキストのみで続行します: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }

        console.log(`[Threads] Match: [${jstDate}] ${textPreview}...`);
        items.push({
          id: t.url || String(Math.random()),
          source: "threads",
          text: finalText,
          createdAt: t.datetime || collectedAt,
          url: t.url || undefined,
        });
      } else {
        if (jstDate !== "unknown") {
          console.log(`[Threads] Skip: [${jstDate}] (ターゲット外) ${textPreview}...`);
        }
      }
    }

    await browser.close();

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
  // 実行環境によらず、常に日本時間での YYYY-MM-DD を取得する
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
