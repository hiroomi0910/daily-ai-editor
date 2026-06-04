import type { GeneratedArticle } from "../types/article.js";
import type { CollectionResult } from "../collectors/types.js";

export function generateMockArticle(
  date: string,
  collections: CollectionResult[],
): GeneratedArticle {
  const itemCount = collections.reduce(
    (count, collection) => count + collection.items.length,
    0,
  );

  return {
    title: "静かな編集のための最初の配線",
    date,
    tags: ["daily-ai", "draft", "sizu-project"],
    body: [
      "今日は、SIZU PROJECTの実装を始める前に、まず記録の流れそのものを整えた。",
      "",
      "このシステムの中心にあるのは、日々の活動をそのまま要約することではなく、そこに流れている関心や違和感を、あとから読み返せる文章に変えることだ。",
      "",
      `今回のdry-runでは、${itemCount}件の活動アイテムをcollector interfaceに通した。`,
      "",
      "Phase 1では、まだ外部サービスには接続しない。設定を読み、raw logを保存し、Markdownを書き出す。小さな配線が正しく動くことを確かめてから、Blueskyの実収集とAI生成を重ねていく。",
    ].join("\n"),
  };
}
