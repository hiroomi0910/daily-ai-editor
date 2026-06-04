import type { CollectionResult, CollectedActivityItem } from "../collectors/types.js";

export type GenerationInput = {
  date: string;
  generatedAt: string;
  sources: Array<{
    source: CollectionResult["source"];
    collectedAt: string;
    itemCount: number;
  }>;
  items: CollectedActivityItem[];
  markdown: string;
};

export function buildGenerationInput(
  date: string,
  generatedAt: string,
  collections: CollectionResult[],
): GenerationInput {
  const items = collections.flatMap((collection) => collection.items);
  
  // Filter items strictly matching the target date in Asia/Tokyo timezone
  const targetDateItems = items.filter((item) => {
    try {
      const d = new Date(item.createdAt);
      // 'sv-SE' locale with Asia/Tokyo timezone returns the JST date as 'YYYY-MM-DD'
      const jstDateString = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
      return jstDateString === date;
    } catch {
      return item.createdAt.startsWith(date);
    }
  });

  const sortedItems = [...targetDateItems].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const markdown = renderGenerationInputMarkdown({
    date,
    generatedAt,
    collections,
    items: sortedItems,
  });

  return {
    date,
    generatedAt,
    sources: collections.map((collection) => ({
      source: collection.source,
      collectedAt: collection.collectedAt,
      itemCount: collection.items.length,
    })),
    items: sortedItems,
    markdown,
  };
}

function renderGenerationInputMarkdown(options: {
  date: string;
  generatedAt: string;
  collections: CollectionResult[];
  items: CollectedActivityItem[];
}): string {
  const lines = [
    `# Generation Input ${options.date}`,
    "",
    `Generated at: ${options.generatedAt}`,
    "",
    "## Sources",
    "",
    ...options.collections.map(
      (collection) =>
        `- ${collection.source}: ${collection.items.length} items collected at ${collection.collectedAt}`,
    ),
    "",
    "## Activity Items",
    "",
  ];

  if (options.items.length === 0) {
    lines.push("- No activity items collected.");
  } else {
    for (const item of options.items) {
      lines.push(`### ${item.source} / ${item.createdAt}`);
      lines.push("");
      lines.push(item.text.trim() || "(empty text)");

      if (item.url) {
        lines.push("");
        lines.push(`URL: ${item.url}`);
      }

      lines.push("");
    }
  }

  lines.push(
    "",
    "## Article Instructions",
    "",
    "- Grounding on Today's Activities: The article must be written strictly based on the concrete activity items, thoughts, links, and logs recorded on this specific day. Do not invent any details not present in the logs. If a specific SNS platform has no activity in the logs, do NOT mention that platform or any related generic activities at all.",
    "- Perspective and Terminology: You are the user's personal AI editor. When discussing external content the user liked or shared, do NOT adopt the first-person perspective or specific internal terminology of the original source (e.g., do not use '弊誌', '弊社', '当サイト' which belong to the original author). Treat external content as a subject of the user's observation from a third-person perspective.",
    "- Extreme Uniqueness & No Generic Templates: Every single day's digital footprint is different. You MUST avoid generic introductory and concluding remarks. Do NOT use cliché metaphors such as 'インターネットの海' (internet sea), 'デジタル空間の漂流' (drifting in digital space), '静かな日々の営み' (quiet daily footprint), or general statements about technology/AI that could apply to any day. If you include any such generic boilerplate filler, the generation fails.",
    "- Direct Opening and Closing: Start the very first sentence of the article directly with a highly specific activity, tool, or thought from today's log (e.g. 'ワンダースワンのIPS液晶...', 'ブルースカイのUIの操作感...'). Conclude the article directly based on a specific realization related to today's work, without wrapping up in a generic 'this was my quiet digital day' cliché.",
    "- Personal and Reflective, but Concrete: Write a quiet, reflective, and poetic Japanese personal column that weaves today's specific activities into a coherent reflective narrative. While the tone should be literary and internet-native, the substance must be highly concrete and specific to the actual logs.",
    "- No generic philosophical filler: Do not fill space with generic philosophical statements about life, technology, or AI. Ground every insight directly in a specific activity from today's log.",
    "- Keep the tone quiet, reflective, personal, editorial, and internet-native.",
    "- Generate natural Japanese Markdown.",
    "",
  );

  return lines.join("\n");
}
