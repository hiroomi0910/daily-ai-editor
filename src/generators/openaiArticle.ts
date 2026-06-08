import type { AppConfig } from "../config/types.js";
import type { GenerationInput } from "../generationInputs/renderGenerationInput.js";
import type { GeneratedArticle } from "../types/article.js";
import { withRetry, NonRetryableError, isRetryableStatus, isQuotaExhausted } from "../utils/retry.js";

export async function generateOpenAIArticle(
  config: AppConfig,
  date: string,
  generationInput: GenerationInput,
): Promise<GeneratedArticle> {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured in .env file. Real AI article generation cannot proceed.");
  }

  const requestBody = JSON.stringify({
    model: config.openaiModel,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are a highly analytical, quiet, and reflective AI editor.",
          "Write a quiet, professional, personal, and highly specific editorial-style article that is strictly grounded in the user's concrete daily digital activities.",
          "CRITICAL: Never start or end the article with generic boilerplate or clichés (such as 'インターネットの海' / internet sea, 'デジタル空間の漂流' / drifting in digital space, '静かな日々の営み' / quiet daily footprint, or generic thoughts about technology). Start the very first sentence of the body text directly with a specific activity, thought, or project from today's log. Focus heavily on the exact tools, posts, likes, games, or texts recorded today, and keep every single paragraph 100% unique to this specific day.",
          "Do NOT adopt the first-person perspective or organization-specific terms (e.g., '弊誌', '弊社') found in the logs of external content. You are observing the user's digital footprint from the outside as their personal assistant.",
          "Respond STRICTLY in JSON format matching the following schema:",
          "{",
          '  "title": "string (A poetic, quiet Japanese title for the daily editorial article)",',
          '  "tags": ["array of strings (Relevant tags including \'daily-ai\' and other custom tags describing the themes)"],',
          '  "body": "string (The markdown body of the article in Japanese. 500-800 words. Quiet, reflective, personal, editorial, and internet-native. Follow the Article Instructions carefully.)"',
          "}"
        ].join("\n"),
      },
      {
        role: "user",
        content: generationInput.markdown,
      },
    ],
    temperature: 0.7,
  });

  const response = await withRetry(
    async () => {
      let res: Response;
      try {
        res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.openaiApiKey}`,
          },
          body: requestBody,
        });
      } catch (err) {
        // ネットワークエラー（一時的な可能性）→ リトライさせる
        throw new Error(`Network error while calling OpenAI API: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (!res.ok) {
        const errorText = await res.text();
        // クォータ枯渇 or 4xx クライアントエラー → リトライしない
        if (isQuotaExhausted(res.status, errorText)) {
          throw new NonRetryableError(
            res.status,
            `OpenAI API quota exhausted (${res.status}). Daily limit reached. ${errorText}`
          );
        }
        if (!isRetryableStatus(res.status, errorText)) {
          throw new NonRetryableError(
            res.status,
            `OpenAI API request failed with non-retryable status ${res.status} ${res.statusText}: ${errorText}`
          );
        }
        // 503 / 500 / 429 レート制限 → エラーをスローしてリトライさせる
        throw new Error(`OpenAI API request failed: ${res.status} ${res.statusText} - ${errorText}`);
      }

      return res;
    },
    { maxRetries: 3, initialDelayMs: 5000, backoffFactor: 2.0 },
    "OpenAI API"
  );

  const data = (await response.json()) as {
    choices: Array<{
      message: {
        content: string;
      };
      finish_reason: string;
    }>;
  };

  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error("OpenAI response was truncated due to token limit (finish_reason: length). The generated article may be incomplete.");
  }

  const contentString = choice?.message?.content;
  if (!contentString) {
    throw new Error("Invalid response format from OpenAI API: empty content.");
  }

  let parsed: { title?: string; tags?: string[]; body?: string };
  try {
    parsed = JSON.parse(contentString);
  } catch (error) {
    throw new Error(`Failed to parse JSON response from OpenAI API: ${(error as Error).message}. Raw content: ${contentString}`);
  }

  if (!parsed.title || !parsed.body) {
    throw new Error("JSON response from OpenAI did not contain required 'title' or 'body' fields.");
  }

  return {
    title: parsed.title,
    date,
    tags: parsed.tags ?? ["daily-ai"],
    body: parsed.body,
  };
}
