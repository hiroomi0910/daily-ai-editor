/**
 * API リトライユーティリティ
 *
 * HTTPレスポンスのステータスコードとエラー内容を判定し、
 * 一時的なエラーの場合は指数バックオフでリトライする。
 *
 * リトライする（一時的エラー）:
 *   - 503 Service Unavailable（サーバー一時過負荷）
 *   - 500 Internal Server Error（サーバー内部エラー）
 *   - 429 Too Many Requests + レート制限（per-minute）
 *
 * リトライしない（恒久エラー）:
 *   - 429 + クォータ枯渇（daily quota exceeded）→ 即停止
 *   - 400 Bad Request（リクエスト不正）
 *   - 401 Unauthorized / 403 Forbidden（認証エラー）
 *   - その他 4xx クライアントエラー
 */

export type RetryOptions = {
  /** 最大リトライ回数（デフォルト: 3） */
  maxRetries?: number;
  /** 初回リトライまでの待機ミリ秒（デフォルト: 5000） */
  initialDelayMs?: number;
  /** バックオフ倍率（デフォルト: 2.0） */
  backoffFactor?: number;
};

/** リトライ不可能なエラーであることを示す専用エラークラス */
export class NonRetryableError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/**
 * クォータ枯渇かどうかを判定する。
 * Gemini API の 429 には「レート制限」と「日次クォータ超過」の2種類がある。
 */
function isQuotaExhausted(statusCode: number, responseBody: string): boolean {
  if (statusCode !== 429) return false;

  const lower = responseBody.toLowerCase();
  // Gemini: "quota", "resource_exhausted" + "per day" / "daily"
  // OpenAI: "quota", "billing", "insufficient_quota"
  return (
    lower.includes("quota") ||
    lower.includes("per day") ||
    lower.includes("daily limit") ||
    lower.includes("insufficient_quota") ||
    lower.includes("billing")
  );
}

/**
 * リトライすべきステータスコードかどうかを判定する。
 */
function isRetryableStatus(statusCode: number, responseBody: string): boolean {
  // クォータ枯渇は 429 でもリトライ不可
  if (isQuotaExhausted(statusCode, responseBody)) return false;

  return statusCode === 503 || statusCode === 500 || statusCode === 429;
}

/**
 * 指定ミリ秒待機する。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * API 呼び出しをリトライ付きで実行する。
 *
 * @param fn 実行する非同期関数。NonRetryableError を throw するとリトライ中断。
 * @param options リトライ設定
 * @param label ログ表示用ラベル（例: "Gemini API"）
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  label = "API",
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 5000;
  const backoffFactor = options.backoffFactor ?? 2.0;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // NonRetryableError は即座に再スロー（リトライしない）
      if (error instanceof NonRetryableError) {
        console.error(
          `[${label}] Non-retryable error (status ${error.statusCode}): ${error.message}`
        );
        throw error;
      }

      if (attempt >= maxRetries) {
        // 最大リトライ回数を超えた
        break;
      }

      const waitMs = initialDelayMs * Math.pow(backoffFactor, attempt);
      console.warn(
        `[${label}] Attempt ${attempt + 1}/${maxRetries} failed: ${error instanceof Error ? error.message : String(error)}`
      );
      console.warn(`[${label}] Retrying in ${(waitMs / 1000).toFixed(1)}s...`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

export { isRetryableStatus, isQuotaExhausted };
