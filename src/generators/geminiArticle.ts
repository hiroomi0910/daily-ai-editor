import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import type { AppConfig } from "../config/types.js";
import type { GeneratedArticle } from "../types/article.js";

/**
 * 収集されたアクティビティ項目の最小インターフェース
 */
interface ActivityItem {
  source: string;
  text: string;
  metadata?: {
    imageContent?: string; // Base64 エンコードされた画像データ
    [key: string]: any;
  };
}

/**
 * Geminiを使用し、画像解析を含む日記記事（タイトル・タグ・本文）を生成する。
 * 
 * ※注意: 本関数は本文の生成だけでなく、AIが自動決定した「タイトル」や「タグ」を含めたJSONを返却する設計です。
 * 本文のみを返却するように変更すると、タイトルが日付固定値にデグレードします。
 */
export async function generateArticleWithGemini(
  config: AppConfig,
  items: ActivityItem[],
  systemPrompt: string,
  date: string
): Promise<GeneratedArticle> {
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません。");
  }

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          tags: {
            type: "ARRAY",
            items: { type: "STRING" }
          },
          body: { type: "STRING" }
        },
        required: ["title", "body"]
      } as any,
      temperature: 0.7,
    }
  });

  const promptParts: (string | Part)[] = [];
  promptParts.push("以下は本日の私のデジタルアクティビティの記録です。これらを素材に、静かで情緒的な日記を作成してください。画像が含まれる場合は、その視覚情報を描写に積極的に取り入れてください。\n\n");

  for (const item of items) {
    promptParts.push(`--- [${item.source}] ---\n${item.text}\n`);

    if (item.metadata?.imageContent) {
      promptParts.push({
        inlineData: {
          mimeType: "image/png",
          data: item.metadata.imageContent,
        },
      });
    }
  }

  const result = await model.generateContent(promptParts);
  const responseText = result.response.text();

  let parsed: { title?: string; tags?: string[]; body?: string };
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Failed to parse JSON response from Gemini API: ${(error as Error).message}. Raw content: ${responseText}`);
  }

  if (!parsed.title || !parsed.body) {
    throw new Error("JSON response from Gemini did not contain required 'title' or 'body' fields.");
  }

  return {
    title: parsed.title,
    date,
    tags: parsed.tags ?? ["daily-ai", "gemini"],
    body: parsed.body,
  };
}
