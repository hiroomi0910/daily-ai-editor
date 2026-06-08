import type { AppConfig } from "../config/types.js";
import type { GenerationInput } from "../generationInputs/renderGenerationInput.js";
import type { GeneratedArticle } from "../types/article.js";
import { withRetry, NonRetryableError, isRetryableStatus, isQuotaExhausted } from "../utils/retry.js";

export async function generateGeminiArticle(
  config: AppConfig,
  date: string,
  generationInput: GenerationInput,
): Promise<GeneratedArticle> {
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not configured in .env file. Gemini AI article generation cannot proceed.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;

  const systemInstructions = [
    "You are a highly analytical, quiet, and reflective AI editor.",
    "Write a quiet, professional, personal, and highly specific editorial-style article that is strictly grounded in the user's concrete daily digital activities.",
    "CRITICAL: Never start or end the article with generic boilerplate or clichés (such as 'インターネットの海' / internet sea, 'デジタル空間の漂流' / drifting in digital space, '静かな日々の営み' / quiet daily footprint, or generic thoughts about technology). Start the very first sentence of the body text directly with a specific activity, thought, or project from today's log. Focus heavily on the exact tools, posts, likes, games, or texts recorded today, and keep every single paragraph 100% unique to this specific day.",
    "Do NOT adopt the first-person perspective or organization-specific terms (e.g., '弊誌', '弊社') found in the logs of external content. You are observing the user's digital footprint from the outside as their personal assistant.",
    "Respond STRICTLY in JSON format matching this schema:",
    "{",
    '  "title": "A poetic, quiet Japanese title for the daily editorial article (string)",',
    '  "tags": ["Relevant tags including \'daily-ai\' and other custom tags describing the themes (array of strings)"],',
    '  "body": "The markdown body of the article in Japanese. 500-800 words. Quiet, reflective, personal, editorial, and internet-native. Follow the Article Instructions carefully. (string)"',
    "}"
  ].join("\n");

  const requestBody = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: generationInput.markdown }]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemInstructions }]
    },
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
      },
      temperature: 0.7,
    }
  });

  const response = await withRetry(
    async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: requestBody,
      });

      if (!res.ok) {
        const errorText = await res.text();
        // クォータ枯渇 or 4xx クライアントエラー → リトライしない
        if (isQuotaExhausted(res.status, errorText)) {
          throw new NonRetryableError(
            res.status,
            `Gemini API quota exhausted (${res.status}). Daily limit reached. ${errorText}`
          );
        }
        if (!isRetryableStatus(res.status, errorText)) {
          throw new NonRetryableError(
            res.status,
            `Gemini API request failed with non-retryable status ${res.status} ${res.statusText}: ${errorText}`
          );
        }
        // 503 / 500 / 429 レート制限 → エラーをスローしてリトライさせる
        throw new Error(`Gemini API request failed: ${res.status} ${res.statusText} - ${errorText}`);
      }

      return res;
    },
    { maxRetries: 3, initialDelayMs: 5000, backoffFactor: 2.0 },
    "Gemini API"
  );


  const rawBody = await response.text();
  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch (err) {
    throw new Error(`Failed to parse Gemini API response as JSON: ${(err as Error).message}. Raw body: ${rawBody}`);
  }

  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new Error("Gemini response was truncated due to token limit (finishReason: MAX_TOKENS). The generated article may be incomplete.");
  }

  const contentString = candidate?.content?.parts?.[0]?.text;
  if (!contentString) {
    throw new Error(`Invalid response format from Gemini API: empty content. Full response: ${JSON.stringify(data)}`);
  }

  let parsed: { title?: string; tags?: string[]; body?: string };
  try {
    parsed = JSON.parse(contentString);
  } catch (error) {
    throw new Error(`Failed to parse JSON response from Gemini API: ${(error as Error).message}. Raw content: ${contentString}`);
  }

  if (!parsed.title || !parsed.body) {
    throw new Error("JSON response from Gemini did not contain required 'title' or 'body' fields.");
  }

  return {
    title: parsed.title,
    date,
    tags: parsed.tags ?? ["daily-ai"],
    body: parsed.body,
  };
}
