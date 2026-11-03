import type { Browser } from "playwright";

const CLOSE_TIMEOUT_MS = 10000;

/**
 * ブラウザを閉じる。閉じ終わらないまま戻らないことがあるため、上限時間を過ぎたら警告を出して先に進む
 */
export async function closeBrowserSafely(browser: Browser | undefined, label: string): Promise<void> {
  if (!browser) return;
  let timerId: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timerId = setTimeout(() => resolve("timeout"), CLOSE_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([browser.close().then(() => "closed" as const), timeout]);
    if (result === "timeout") {
      console.warn(`[${label}] ブラウザが ${CLOSE_TIMEOUT_MS / 1000} 秒以内に閉じなかったため、待たずに先に進みます。`);
    }
  } catch (error) {
    console.warn(`[${label}] ブラウザを閉じるときにエラーが出ました: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timerId);
  }
}
