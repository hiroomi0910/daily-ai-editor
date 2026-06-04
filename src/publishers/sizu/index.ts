import { existsSync } from "node:fs";
import { chromium } from "playwright";
import type { AppConfig } from "../../config/types.js";
import type { GeneratedArticle } from "../../types/article.js";

export async function publishToSizuDraft(
  config: AppConfig,
  article: GeneratedArticle,
): Promise<{ success: boolean; note: string; url?: string }> {
  const sessionPath = config.sizuSessionPath;

  if (!existsSync(sessionPath)) {
    return {
      success: false,
      note: `しずかなインターネットのセッションファイルが見つかりません。先に 'npm run login:sizu' を実行してください。`,
    };
  }

  console.log("[Sizu Publisher] しずかなインターネットへの自動下書き保存を開始します...");
  let browser: any = null;
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
      storageState: sessionPath,
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
    });

    const page = await context.newPage();
    const newPostUrl = "https://sizu.me/new";

    console.log("[Sizu Publisher] 新規投稿画面（エディタ）へアクセス中...");
    await page.goto(newPostUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    // エディタのルート要素が表示されるまで待機
    await page.waitForSelector(".ProseMirror", { state: "visible", timeout: 15000 });

    // Check if redirected to login page (session expired)
    const currentUrl = page.url();
    if (currentUrl.includes("/login") || currentUrl.includes("/signin")) {
      throw new Error("しずかなインターネットのセッションが期限切れです。再度 'npm run login:sizu' を実行してください。");
    }

    console.log(`[Sizu Publisher] エディタURL: ${currentUrl}`);
    console.log("[Sizu Publisher] エディタフォームを読み込んでいます...");

    const titleSelector = "textarea#post-title";
    const bodySelector = "div.ProseMirror";

    await page.waitForSelector(titleSelector, { timeout: 15000 });
    await page.waitForSelector(bodySelector, { timeout: 15000 });

    // 1. Fill Title
    console.log(`[Sizu Publisher] タイトルを入力中: "${article.title}"`);
    await page.fill(titleSelector, article.title);

    // 2. Fill Body using native keyboard.insertText for 100% tiptap/prosemirror compatibility
    console.log("[Sizu Publisher] 本文を入力中...");
    await page.focus(bodySelector);
    await page.keyboard.insertText(article.body);

    // 2.5. Add Sizu native tags: AI文章生成, 実験中, 日々是好日, Phase4
    console.log("[Sizu Publisher] ネイティブの「タグ」ボタンをクリックしてタグ追加パネルを開きます...");
    const tagButton = page.locator('button:has-text("タグ")');
    await tagButton.click();
    await page.waitForTimeout(1000);

    console.log("[Sizu Publisher] タグ入力フィールドの読み込みを待機しています...");
    const tagInput = page.locator('.z-popover input[type="text"]');
    await tagInput.waitFor({ state: "visible", timeout: 10000 });

    const targetTags = ["AI文章生成", "実験中", "日々是好日", "Phase5"];
    for (const tag of targetTags) {
      console.log(`[Sizu Publisher] タグを入力中: "${tag}"`);
      await tagInput.fill(tag);
      await page.waitForTimeout(200);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500); // Wait for tag list to update in the UI
    }

    // 2.8. Close the popover to remove the backdrop overlay blocking clicks
    console.log("[Sizu Publisher] Escapeキーを入力してタグポップオーバーを閉じます...");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000); // Wait for modal close animation

    // 3. Click "保存する" to persist the post privately (Sizu.me defaults new posts to private "自分だけ")
    console.log("[Sizu Publisher] 「保存する」ボタンをクリックして下書き保存を確定しています...");
    await page.click('button:has-text("保存する")');

    // 4. Wait for the save sync to complete
    console.log("[Sizu Publisher] 保存完了の同期を待っています...");
    await page.waitForTimeout(5000);

    const afterPublishUrl = page.url();
    console.log(`[Sizu Publisher] 下書き保存が完了しました！ URL: ${afterPublishUrl}`);

    // 4.5. Transition to preview page to edit the publication/creation date
    const match = afterPublishUrl.match(/posts\/([^\/]+)\/edit/);
    if (match) {
      const slug = match[1];
      const username = config.sizuUsername || config.twitterUsername || config.instagramUsername || "user";
      const previewUrl = `https://sizu.me/${username}/posts/${slug}`;
      console.log(`[Sizu Publisher] プレビュー画面へ直接遷移します: ${previewUrl}`);
      await page.goto(previewUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      console.log(`[Sizu Publisher] プレビュー画面へ到達しました: ${page.url()}`);
    } else {
      console.warn("[Sizu Publisher] URLからスラッグを抽出できませんでした。編集終了ボタンのクリックを試みます...");
      const closeBtn = page.locator('button[aria-label="編集を終了"]');
      await closeBtn.click();
      await page.waitForTimeout(4000);
      console.log(`[Sizu Publisher] プレビュー画面へ到達しました (Fallback): ${page.url()}`);
    }

    // 4.6. Click "日付を編集" button via page.evaluate (to bypass hover styling)
    console.log("[Sizu Publisher] 「日付を編集」ボタンをクリックします...");
    const clickedDateBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes("日付を編集"));
      if (btn) {
        (btn as HTMLButtonElement).click();
        return true;
      }
      return false;
    });

    if (clickedDateBtn) {
      console.log("[Sizu Publisher] 日付選択ダイアログの読み込みを待機しています...");
      const dateInputSelector = 'input[type="date"]';
      await page.waitForSelector(dateInputSelector, { timeout: 10000 });

      console.log(`[Sizu Publisher] 作成日をターゲット日付に変更中: ${article.date}`);
      await page.fill(dateInputSelector, article.date);
      await page.waitForTimeout(200);

      console.log("[Sizu Publisher] 日付変更を保存しています...");
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);
      console.log("[Sizu Publisher] 作成日の日付変更が正常に保存されました！");
    } else {
      console.warn("[Sizu Publisher] 「日付を編集」ボタンが見つかりませんでした。スキップします。");
    }

    return {
      success: true,
      note: "しずかなインターネットへの下書き自動保存および日付設定に成功しました！",
      url: afterPublishUrl,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Sizu Publisher] 下書き保存に失敗しました: ${errMsg}`);
    return {
      success: false,
      note: `しずかなインターネットへの下書き保存エラー: ${errMsg}`,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
