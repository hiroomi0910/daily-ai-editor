import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig } from "../config/loadConfig.js";

async function run() {
  const config = loadConfig();
  const sessionPath = config.instagramSessionPath;

  console.log("=========================================");
  console.log("Instagram 手動ログインセッション保存スクリプト");
  console.log(`保存先: ${sessionPath}`);
  console.log("=========================================");

  // Ensure settings directory exists
  await mkdir(dirname(sessionPath), { recursive: true });

  let browser;
  try {
    console.log("PCにインストールされている本物の Google Chrome を使用してブラウザを起動します...");
    browser = await chromium.launch({
      headless: false,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch (e) {
    console.log("本物の Google Chrome の起動に失敗したため、通常の Playwright Chromium で起動します...");
    browser = await chromium.launch({
      headless: false,
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

  console.log("ブラウザを起動しています... https://www.instagram.com/ を開きます。");
  await page.goto("https://www.instagram.com/");

  console.log("\n【重要】ブラウザウィンドウでInstagramアカウントに手動でログインしてください。");
  console.log("二要素認証などを含め、ログインを完了させてください。");
  console.log("ログインが完了し、ホームタイムラインが表示されたら、");
  console.log("このターミナルに戻り、Enterキーを押してください。");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise<void>((resolve) => {
    rl.question("\nログイン完了後にEnterキーを押してください > ", () => {
      rl.close();
      resolve();
    });
  });

  console.log("\nセッション情報を保存しています...");
  await context.storageState({ path: sessionPath });
  console.log(`セッション情報が正常に保存されました！`);
  console.log(`ファイル: ${sessionPath}`);

  await browser.close();
  console.log("ブラウザを閉じました。設定完了です！");
}

run().catch((error) => {
  console.error("エラーが発生しました:", error);
  process.exit(1);
});
export {};
