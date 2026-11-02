import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { waitForLogin } from "../utils/loginPrompt.js";
import { LOGIN_COOKIES } from "../utils/session.js";

async function run() {
  const config = loadConfig();
  const sessionPath = config.xSessionPath;

  console.log("=========================================");
  console.log("X.com (Twitter) 手動ログインセッション保存スクリプト");
  console.log(`保存先: ${sessionPath}`);
  console.log("=========================================");

  // Ensure settings directory exists
  await mkdir(dirname(sessionPath), { recursive: true });

  const launchOptions = {
    headless: false,
    channel: "chrome" as const,
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  };

  let browser;
  try {
    console.log("PCにインストールされている本物の Google Chrome を使用してブラウザを起動します...");
    browser = await chromium.launch(launchOptions);
  } catch (e) {
    console.log("本物の Google Chrome の起動に失敗したため、通常の Playwright Chromium で起動します...");
    const { channel, ...fallbackOptions } = launchOptions;
    browser = await chromium.launch(fallbackOptions);
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });

  // 自動化フラグ（navigator.webdriver）の偽装・無効化
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
  });

  const page = await context.newPage();

  console.log("ブラウザを起動しています... https://x.com/i/flow/login を開きます。");
  await page.goto("https://x.com/i/flow/login");

  console.log("\n【重要】ブラウザウィンドウでTwitter/Xアカウントに手動でログインしてください。");
  console.log("二要素認証などを含め、ログインを完了させてください。");
  console.log("ログインが完了し、タイムライン（ホーム）が表示されたら、");
  console.log("このターミナルに戻り、Enterキーを押してください。");

  const loggedIn = await waitForLogin(context, LOGIN_COOKIES.x);
  if (!loggedIn) {
    await browser.close();
    console.log("ログインが完了していないため、保存せずに終了しました。");
    process.exitCode = 1;
    return;
  }

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
