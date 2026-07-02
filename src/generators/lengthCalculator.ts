import type { CollectedActivityItem } from "../collectors/types.js";

export interface LengthRange {
  score: number;
  tier: 1 | 2 | 3;
  japaneseLengthRange: string;
  englishLengthRange: string;
  titleRestriction: string;
  titleRestrictionJa: string;
}

export function calculateTargetLength(
  items: CollectedActivityItem[],
  overrideOption?: string
): LengthRange {
  // 手動指定がある場合の処理
  if (overrideOption) {
    if (overrideOption === "short" || overrideOption === "tier1") {
      return {
        score: 0,
        tier: 1,
        japaneseLengthRange: "600〜800字程度",
        englishLengthRange: "600-800 characters",
        titleRestriction: "",
        titleRestrictionJa: "",
      };
    }
    if (overrideOption === "medium" || overrideOption === "tier2") {
      return {
        score: 300,
        tier: 2,
        japaneseLengthRange: "1000〜1200字程度",
        englishLengthRange: "1000-1200 characters",
        titleRestriction: ", in a poetic and thoughtful tone, but strictly avoid using '静かな', '穏やかな', 'silent', 'quiet' or any synonyms related to quietness/silence in the title.",
        titleRestrictionJa: "（タイトルには「静かな」「穏やかな」などの静寂を連想させるワードを絶対に使用しないでください）",
      };
    }
    if (overrideOption === "long" || overrideOption === "tier3") {
      return {
        score: 600,
        tier: 3,
        japaneseLengthRange: "1500〜1800字程度",
        englishLengthRange: "1500-1800 characters",
        titleRestriction: ", in a poetic and thoughtful tone, but strictly avoid using '静かな', '穏やかな', 'silent', 'quiet' or any synonyms related to quietness/silence in the title.",
        titleRestrictionJa: "（タイトルには「静かな」「穏やかな」などの静寂を連想させるワードを絶対に使用しないでください）",
      };
    }
  }

  // 1. アクティビティ総数 (N_items)
  const itemsCount = items.length;

  // 2. ユニークなアクティブソース数 (N_sources)
  const activeSources = new Set(items.map((item) => item.source));
  const activeSourcesCount = activeSources.size;

  // 3. 総テキスト長 (L_text)
  const totalTextLength = items.reduce(
    (sum, item) => sum + (item.text?.length || 0),
    0
  );

  // スコア計算式
  // S = (N_items * 15) + ((N_sources - 1) * 100) + min(L_text / 5, 300)
  const itemsScore = itemsCount * 15;
  const sourcesScore = Math.max(0, activeSourcesCount - 1) * 100;
  const textScore = Math.min(Math.floor(totalTextLength / 5), 300);
  const score = itemsScore + sourcesScore + textScore;

  // ティア判定
  if (score >= 500) {
    return {
      score,
      tier: 3,
      japaneseLengthRange: "1500〜1800字程度",
      englishLengthRange: "1500-1800 characters",
      titleRestriction: ", in a poetic and thoughtful tone, but strictly avoid using '静かな', '穏やかな', 'silent', 'quiet' or any synonyms related to quietness/silence in the title.",
      titleRestrictionJa: "（タイトルには「静かな」「穏やかな」などの静寂を連想させるワードを絶対に使用しないでください）",
    };
  } else if (score >= 200) {
    return {
      score,
      tier: 2,
      japaneseLengthRange: "1000〜1200字程度",
      englishLengthRange: "1000-1200 characters",
      titleRestriction: ", in a poetic and thoughtful tone, but strictly avoid using '静かな', '穏やかな', 'silent', 'quiet' or any synonyms related to quietness/silence in the title.",
      titleRestrictionJa: "（タイトルには「静かな」「穏やかな」などの静寂を連想させるワードを絶対に使用しないでください）",
    };
  } else {
    return {
      score,
      tier: 1,
      japaneseLengthRange: "600〜800字程度",
      englishLengthRange: "600-800 characters",
      titleRestriction: "",
      titleRestrictionJa: "",
    };
  }
}
