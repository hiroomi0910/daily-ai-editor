import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

/**
 * Playwright storageState JSONファイルの妥当性を事前検証する
 */
export async function validateStorageState(filePath: string): Promise<{ valid: boolean; error?: string }> {
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
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `JSONパースに失敗しました (${err instanceof Error ? err.message : String(err)})` };
  }
}
