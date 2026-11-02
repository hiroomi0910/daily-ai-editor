import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

/**
 * 各サービスでログイン状態を示すクッキー名（ログインしていなければ付かない）
 */
export const LOGIN_COOKIES = {
  x: "auth_token",
  instagram: "sessionid",
  facebook: "c_user",
  sizu: "__Secure-next-auth.session-token",
} as const;

/**
 * Playwright storageState JSONファイルの妥当性を事前検証する
 * requiredCookie を指定すると、そのクッキー（ログイン状態を示すもの）が有効期限内で存在するかも確かめる
 */
export async function validateStorageState(
  filePath: string,
  requiredCookie?: string,
): Promise<{ valid: boolean; error?: string }> {
  if (!existsSync(filePath)) {
    return { valid: false, error: `ファイルが存在しません: ${filePath}` };
  }
  try {
    const content = await readFile(filePath, "utf8");
    if (!content.trim()) {
      return { valid: false, error: `セッションファイルが空（0バイト）です。クラウド同期の遅延かファイル破損の可能性があります。` };
    }
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.cookies)) {
      return { valid: false, error: `セッションファイルの形式が不正です（cookies配列が見つかりません）。` };
    }
    if (requiredCookie && !hasValidCookie(parsed.cookies, requiredCookie)) {
      return { valid: false, error: `ログイン状態のクッキー（${requiredCookie}）がないか期限切れです。ログインが完了していません` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `JSONパースに失敗しました (${err instanceof Error ? err.message : String(err)})` };
  }
}

/**
 * cookies 配列に、指定した名前の有効期限内のクッキーがあるか
 */
export function hasValidCookie(
  cookies: Array<{ name?: string; value?: string; expires?: number }>,
  name: string,
): boolean {
  const nowSec = Date.now() / 1000;
  return cookies.some(
    (c) => c.name === name && !!c.value && (c.expires === undefined || c.expires < 0 || c.expires > nowSec),
  );
}
