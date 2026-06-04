import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CollectionResult } from "../../collectors/types.js";
import type { AppConfig } from "../../config/types.js";

export type WriteRawLogResult = {
  filePath: string;
  itemCount: number;
  source: CollectionResult["source"];
};

export async function writeRawLog(
  config: AppConfig,
  collection: CollectionResult,
): Promise<WriteRawLogResult> {
  const date = collection.collectedAt.slice(0, 10);
  const outputRoot =
    config.outputMode === "obsidian"
      ? join(config.vaultPath, config.projectWorkspace, "raw_logs")
      : config.localRawLogPath;
  const directory = join(outputRoot, collection.source, date.slice(0, 4), date.slice(5, 7));
  const fileName = `${date}-${toTimestampSlug(collection.collectedAt)}.json`;
  const filePath = join(directory, fileName);

  await mkdir(directory, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(collection, null, 2)}\n`, {
    encoding: "utf8",
    flag: "w",
  });

  return {
    filePath,
    itemCount: collection.items.length,
    source: collection.source,
  };
}

function toTimestampSlug(value: string): string {
  return value.replaceAll(":", "").replaceAll(".", "-");
}
