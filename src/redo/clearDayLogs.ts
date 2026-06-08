import { readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";

export type ClearDayLogsResult = {
  date: string;
  deletedFiles: string[];
  deletedCount: number;
};

/**
 * 指定日付の raw_logs と generation_inputs を削除する。
 *
 * 削除対象:
 *   - raw_logs/{source}/YYYY/MM/YYYY-MM-DD-*.json
 *   - generation_inputs/YYYY/MM/YYYY-MM-DD-*.md
 *   - generation_inputs/YYYY/MM/YYYY-MM-DD-*.json
 *
 * 削除しないもの:
 *   - daily_ai/ 以下の記事ファイル（ユーザーが手動編集している可能性があるため）
 *   - sizu.me の下書き（外部サービスのため自動削除しない）
 */
export async function clearDayLogs(
  config: AppConfig,
  date: string,
): Promise<ClearDayLogsResult> {
  const year = date.slice(0, 4);
  const month = date.slice(5, 7);
  const deletedFiles: string[] = [];

  const rawLogRoot =
    config.outputMode === "obsidian"
      ? join(config.vaultPath, config.projectWorkspace, "raw_logs")
      : config.localRawLogPath;

  const generationInputRoot =
    config.outputMode === "obsidian"
      ? join(config.vaultPath, config.projectWorkspace, "generation_inputs")
      : config.localGenerationInputPath;

  // raw_logs/{source}/YYYY/MM/ 以下を全ソースについてスキャン
  if (existsSync(rawLogRoot)) {
    let sources: string[] = [];
    try {
      sources = await readdir(rawLogRoot);
    } catch {
      sources = [];
    }

    for (const source of sources) {
      const monthDir = join(rawLogRoot, source, year, month);
      const removed = await removeMatchingFiles(monthDir, date);
      deletedFiles.push(...removed);
    }
  }

  // generation_inputs/YYYY/MM/ 以下をスキャン
  const genInputMonthDir = join(generationInputRoot, year, month);
  const removedGenInputs = await removeMatchingFiles(genInputMonthDir, date);
  deletedFiles.push(...removedGenInputs);

  return {
    date,
    deletedFiles,
    deletedCount: deletedFiles.length,
  };
}

/**
 * 指定ディレクトリ内で `YYYY-MM-DD` で始まるファイルを削除する。
 * ディレクトリが存在しない場合は何もしない。
 */
async function removeMatchingFiles(
  directory: string,
  date: string,
): Promise<string[]> {
  if (!existsSync(directory)) {
    return [];
  }

  let entries: string[] = [];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const deleted: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith(date)) {
      const filePath = join(directory, entry);
      try {
        await rm(filePath, { force: true });
        deleted.push(filePath);
      } catch (err) {
        // 削除失敗は警告として記録するが全体を止めない
        console.warn(`[Redo] Failed to delete ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return deleted;
}
