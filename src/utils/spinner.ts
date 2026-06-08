/**
 * ターミナルスピナー
 *
 * よく見るブレイルドット（⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏）が四角くグルグル回るアニメーション。
 *
 * 安全設計:
 * - stdout が TTY（インタラクティブなターミナル）の場合のみアニメーションを実行する。
 * - ファイルリダイレクト・Windows タスクスケジューラの非表示実行など、
 *   TTY でない環境では通常の console.log にフォールバックし、クラッシュしない。
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private isRunning = false;
  private isTTY: boolean;

  constructor() {
    this.isTTY = Boolean(process.stdout.isTTY);
  }

  /** スピナーを開始する */
  start(label: string): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.frameIndex = 0;

    if (!this.isTTY) {
      // TTY でない環境（バッチ実行・ファイルリダイレクトなど）はそのままログ出力
      console.log(`[...] ${label}`);
      return;
    }

    process.stdout.write(`${FRAMES[0]} ${label}`);
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
      process.stdout.write(`\r${FRAMES[this.frameIndex]} ${label}`);
    }, INTERVAL_MS);
  }

  /** スピナーを停止し、完了メッセージを表示する */
  stop(finalMessage: string): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.isTTY) {
      // スピナー行を消してから最終メッセージを出力
      process.stdout.write(`\r\x1b[K${finalMessage}\n`);
    } else {
      console.log(finalMessage);
    }
  }

  /**
   * 非同期処理の実行中にスピナーを表示するヘルパー。
   * 処理が終わると自動でスピナーを停止する。
   *
   * @param label    実行中に表示するラベル
   * @param fn       待機する非同期処理
   * @param doneMsg  完了時に表示するメッセージ（省略すると表示しない）
   */
  async wrap<T>(
    label: string,
    fn: () => Promise<T>,
    doneMsg?: string,
  ): Promise<T> {
    this.start(label);
    try {
      const result = await fn();
      this.stop(doneMsg ?? `✓ ${label}`);
      return result;
    } catch (err) {
      this.stop(`✗ ${label} (failed)`);
      throw err;
    }
  }
}
