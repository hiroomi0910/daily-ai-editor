import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "../../config/types.js";
import type { GeneratedArticle } from "../../types/article.js";
import { renderDailyArticleMarkdown } from "./markdown.js";

export type WriteDailyArticleResult = {
  filePath: string;
  outputMode: AppConfig["outputMode"];
};

export async function writeDailyArticle(
  config: AppConfig,
  article: GeneratedArticle,
): Promise<WriteDailyArticleResult> {
  const year = article.date.slice(0, 4);
  const month = article.date.slice(5, 7);
  const outputRoot =
    config.outputMode === "obsidian"
      ? join(config.vaultPath, config.projectWorkspace)
      : config.localOutputPath;

  const directory = join(outputRoot, "daily_ai", year, month);
  const markdown = renderDailyArticleMarkdown(article);

  await mkdir(directory, { recursive: true });
  const filePath = await writeUniqueDailyArticle(directory, article.date, markdown);

  return {
    filePath,
    outputMode: config.outputMode,
  };
}

async function writeUniqueDailyArticle(
  directory: string,
  date: string,
  markdown: string,
): Promise<string> {
  const candidates = [
    `${date}.md`,
    ...Array.from({ length: 999 }, (_, index) => {
      const suffix = String(index + 1).padStart(3, "0");
      return `${date}-${suffix}.md`;
    }),
  ];

  for (const candidate of candidates) {
    const filePath = join(directory, candidate);

    try {
      await writeFile(filePath, markdown, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error) {
      if (isFileExistsError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Could not allocate daily article path for ${date}`);
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}
