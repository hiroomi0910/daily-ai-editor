import { createInterface } from "node:readline";
import type { BrowserContext } from "playwright";
import { hasValidCookie } from "./session.js";

/**
 * 手動ログインの完了を待つ。Enter のたびにログイン状態のクッキーを確かめ、
 * なければ再確認を求める（ログイン前に Enter を押して未ログインのセッションを保存してしまうのを防ぐ）。
 * q が入力されたら false を返す
 */
export async function waitForLogin(context: BrowserContext, cookieName: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  try {
    let answer = await ask("\nログイン完了後にEnterキーを押してください > ");
    while (!hasValidCookie(await context.cookies(), cookieName)) {
      if (answer.trim().toLowerCase() === "q") return false;
      console.warn(`\n⚠️ まだログインが完了していません（${cookieName} クッキーがありません）。`);
      console.warn("ブラウザでログインを済ませ、ログイン後の画面が表示されてから Enter を押してください。");
      answer = await ask("Enter で再確認 / q で保存せずに終了 > ");
    }
    return true;
  } finally {
    rl.close();
  }
}
