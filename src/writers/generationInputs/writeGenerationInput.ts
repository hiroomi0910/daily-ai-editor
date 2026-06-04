import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "../../config/types.js";
import type { GenerationInput } from "../../generationInputs/renderGenerationInput.js";

export type WriteGenerationInputResult = {
  markdownPath: string;
  jsonPath: string;
  itemCount: number;
};

export async function writeGenerationInput(
  config: AppConfig,
  input: GenerationInput,
): Promise<WriteGenerationInputResult> {
  const outputRoot =
    config.outputMode === "obsidian"
      ? join(config.vaultPath, config.projectWorkspace, "generation_inputs")
      : config.localGenerationInputPath;
  const directory = join(outputRoot, input.date.slice(0, 4), input.date.slice(5, 7));
  const baseName = `${input.date}-${toTimestampSlug(input.generatedAt)}`;
  const markdownPath = join(directory, `${baseName}.md`);
  const jsonPath = join(directory, `${baseName}.json`);

  await mkdir(directory, { recursive: true });
  await writeFile(markdownPath, input.markdown, { encoding: "utf8", flag: "w" });
  await writeFile(jsonPath, `${JSON.stringify(input, null, 2)}\n`, {
    encoding: "utf8",
    flag: "w",
  });

  return {
    markdownPath,
    jsonPath,
    itemCount: input.items.length,
  };
}

function toTimestampSlug(value: string): string {
  return value.replaceAll(":", "").replaceAll(".", "-");
}
