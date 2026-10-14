# daily-ai-editor

SNSの日常的なアクティビティを収集し、AIが静かで知的な日本語エッセイを自動生成・保存するパーソナルAIエディトリアルシステムです。

生成した記事は **Obsidian Vault** にMarkdown形式で保存でき、**しずかなインターネット (sizu.me)** へのプライベート下書き自動投稿にも対応しています。

---

## ✨ 機能概要

### SNS 収集チャンネル（7系統）

| チャンネル | 収集内容 |
|---|---|
| **Bluesky** | 公開APIによる自分のポスト収集 |
| **X / Twitter** | Chromeセッションを利用したポスト収集 |
| **Threads** | 公開タイムラインからのポスト収集 |
| **Instagram** | フィード投稿 + アクティブなストーリーズ検知 |
| **Facebook** | 自分のいいね・リアクションアクティビティ |
| **GitHub** | コミット・PR・Issue などの開発アクティビティ |
| **RSS** | 任意のRSSフィードからの記事収集 |

### AI 生成エンジン

- **Gemini 3.8 Flash**（推奨・無料枠対応）
- **OpenAI GPT-4o / GPT-4o-mini**

どちらを使うかは `.env` の `SIZU_AI_PROVIDER` で切り替えられます。

### 出力先

- **Obsidian Vault**（Markdown + Frontmatter 形式）
- **しずかなインターネット (sizu.me)**（Playwright によるプライベート下書き自動保存）

### その他の特徴

- SNSのアクティビティが**ゼロの日は生成をスキップ**し、内容のない記事の生成を防止
- `--date=YYYY-MM-DD` 引数で**過去の日付**を指定した遡り実行に対応
- **Windows タスクスケジューラ**との連携による完全無人自動実行（`batch/` ディレクトリ）

## 📋 前提条件 (Prerequisites)

本システムを利用する前に、以下の準備を行ってください。

1. **各プラットフォームのアカウント作成**
   - **しずかなインターネット (sizu.me)**: 下書きを自動保存するため、あらかじめアカウントを作成し、日記を書ける状態（ログイン可能な状態）にしておいてください。
   - **収集対象の各SNS**: アクティビティを収集したい各SNS（Bluesky, X/Twitter, Threads, Instagram, Facebook, GitHub 等）のアカウント。
2. **APIキー・アクセストークンの取得**
   - **AIプロバイダーのAPIキー**: エッセイの生成に用いる **Google Gemini API** (`GEMINI_API_KEY`) または **OpenAI API** (`OPENAI_API_KEY`) のAPIキーをあらかじめ取得してください。
   - **GitHub / Bluesky**: GitHubのアクティビティを収集する場合は個人用アクセストークン（`GITHUB_TOKEN`）、Blueskyの場合はアカウントのパスワード（またはApp Password）が必要です。

---

## 🛠️ セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、必要な値を入力します。

```bash
cp .env.example .env
```

主な設定項目：

| 変数名 | 説明 |
|---|---|
| `SIZU_OUTPUT_MODE` | `local`（ローカル保存）または `obsidian`（Vault保存） |
| `SIZU_OBSIDIAN_VAULT_PATH` | Obsidian VaultのフルパスをOS環境に合わせて設定 |
| `SIZU_AI_PROVIDER` | `gemini` または `openai` |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/) で取得 |
| `OPENAI_API_KEY` | [OpenAI Platform](https://platform.openai.com/) で取得 |
| `SIZU_BLUESKY_ACTOR` | Blueskyのハンドル（例: `yourname.bsky.social`） |

詳細は `.env.example` のコメントを参照してください。

### 3. 初回ログイン（Cookieセッションの保存）

X.com、Instagram、Facebook、しずかなインターネットは、初回のみブラウザを使った手動ログインが必要です。

```bash
# それぞれ実行し、ブラウザでログイン完了後に Enter を押してセッションを保存します
npm run login:x
npm run login:instagram
npm run login:facebook
npm run login:sizu
```

---

## 🚀 使い方

### 今日の記事を生成・保存

```bash
npm run dev
```

### 過去の日付を指定して実行

```bash
npm run dev -- --date=2026-05-29
```

### 記事の再生成（すでに生成されたログ・記事の作り直し）

`--redo` オプションを付加して実行すると、対象日付の既存ログを自動クリアした上で、収集から下書き登録までを最初からやり直すことができます。

```bash
# 今日の記事を再生成する
npm run dev -- --redo

# 過去の特定日付の記事を再生成する
npm run dev -- --redo --date=2026-05-29
```

### 生成される文章量を指定して実行 (例: 長尺 1500〜1800字程度を強制)

```bash
npm run dev -- --length=long
# オプション値: short (Tier 1: 600〜800字), medium (Tier 2: 1000〜1200字), long (Tier 3: 1500〜1800字)
```

---

## ⏰ Windows での自動実行

`batch/` ディレクトリに、Windows タスクスケジューラと連携するスクリプト一式が含まれています。

### 手動テスト実行

`batch/run-daily.bat` をダブルクリックするだけで、依存チェック → コンパイル → 収集・生成 → 下書き保存までが一括実行されます。ログは `batch/logs/daily.log` に保存されます。

### タスクスケジューラへの登録

1. **管理者権限で PowerShell を起動**します。
2. 以下のコマンドを実行します：
   ```powershell
   powershell -ExecutionPolicy Bypass -File batch/register-task.ps1
   ```
3. 毎日 **23:00** に以下の設定で自動実行されます：
   - ウィンドウ非表示のサイレント実行
   - バッテリー駆動・スリープ中でも動作
   - 成功 / 失敗をWindowsトースト通知でお知らせ
   - `.env` の環境変数をシステム設定を汚さずに自動ロード

---

## 🛡️ 安全性の原則

- **自動公開はしない**: sizu.me への投稿は常に「自分だけ（Private）」の下書き保存。最終的な公開判断はユーザー自身が行います。
- **空振り日はスキップ**: 収集したSNSアクティビティが空の場合、記事の生成・投稿は行いません。
- **認証情報はGitに含めない**: `.env`、セッションCookie、ログ等は `.gitignore` で管理対象外となっています。

---

## 📦 技術スタック

- **Runtime**: Node.js / TypeScript
- **Browser Automation**: Playwright
- **AI**: Google Gemini API / OpenAI API
- **Output**: Obsidian Vault (Markdown) / sizu.me (Playwright)

---

## 📌 バージョン履歴 (Version History)

### Version 1.4.2 (最新版)
- **Gemini APIモデルの最新化（Gemini 3.8 Flash対応とフォールバック再編）**:
  - デフォルトの生成モデルを最新フラッグシップの `gemini-3.8-flash` に刷新。
  - フォールバックリスト（`DEFAULT_GEMINI_MODELS`）を `gemini-3.8-flash` -> `gemini-3.7-flash` -> `gemini-3.6-flash` -> `gemini-3.5-flash-lite` -> `gemini-2.5-flash` の安定稼働順に再編。
  - API側で404（廃止）となった旧モデル（`gemini-1.5-flash`, `gemini-2.0-flash`, `gemini-2.5-flash-lite`）を除外。
  - Instagram Vision 画像解析のモデル順も `gemini-3.8-flash` -> `gemini-3.5-flash-lite` -> `gemini-2.5-flash` に更新。

### Version 1.3.0
- **動的文章量調整機能 ＆ アクティビティ密度スコアリング**:
  - 1日のアクティビティ総数、有効なSNSソースの多様性、テキスト総文字数から「活動密度スコア（Activity Density Score）」を算出。
  - スコアに基づき、生成記事のボリュームを自動的に「600〜800字程度」(Tier 1)、「1000〜1200字程度」(Tier 2)、「1500〜1800字程度」(Tier 3)の3段階へ動的スケール。
  - コマンドライン引数 `--length=short|medium|long` を追加し、文章量の手動指定に対応。
- **活発な日のコラムタイトル自動トーン調整**:
  - 活動的な日（Tier 2 / Tier 3）には、タイトルに「静かな」「穏やかな」「silent」「quiet」といった静寂系語句を含めることをシステムプロンプトで禁止。代わりに、その日の具体的活動やインプットにフォーカスした情緒的タイトルを生成するように改善。
- **Vision API の429レート制限時の即時フォールバック**:
  - Gemini Vision で 429 エラー（RESOURCE_EXHAUSTED）検知時に、無駄なリトライや全モデルの試行をスキップして OpenAI Vision へ高速フォールバックするよう改修。
- **Vision 試行モデル数の最適化**:
  - 画像解析時の無駄なループ遅延を避けるため、Vision での試行モデルを最大3モデル（指定モデル, `gemini-2.5-flash`, `gemini-1.5-flash`）に削減。
- **デフォルトタイムアウト値の緩和**:
  - コレクター全体のタイムアウト設定値 `collectorTimeoutMs` のデフォルト値を 120秒 から 300秒（5分）へ引き上げ、`.env.example` も追従。
- **Geminiモデルの自動フォールバック順序設定**:
  - `gemini-3.5-flash` などのモデル群を定義し、APIエラー時に優先度順に自動フォールバックするよう改修。
- **リポジトリ表記・ファイル名の統一 (shizu ➔ sizu)**:
  - 古いプロジェクト表記やリンク参照を一括クリーンアップし、Obsidian内のリンク切れを解消。

### Version 1.2.3
- **Twitter「いいね」収集ロジックの改善 (履歴重複排除)**: 元ツイートの作成日時による日付フィルタを廃止し、過去ログのURLスキャン履歴を用いた重複排除方式に変更。これにより、過去の古いツイートに対する「いいね」も当日のアクティビティとして確実に収集されるように修正。
- **Twitterタイムラインのロード安定化**: Playwrightでのタイムライン読み込み時の待機条件を `networkidle` から `load` に最適化し、X.comのバックグラウンド通信によるハングアップを解消。
- **Threads収集プロセスの高速化**: ページ内で読み込んだ最古の投稿日時が実行対象日よりも古くなった時点でスクロールループを早期終了（break）する最適化を導入。スクロール待機時間を約24秒から最速1.5秒に短縮。

### Version 1.2.2
- **ストーリー取得判定の厳密化（時間重複）**: 対象日と現在時刻（過去24時間）の重複判定を厳密に計算し、過去日付での実行時に当日のストーリーを誤って取得・紐付ける不具合を解消。二重読み込み防止のための最適化も実施。
- **未ログイン時の安全スキップ機能**: セッション切れ等による未ログイン状態（「消える前にこのストーリーズをチェックしよう」画面やログインページへの遷移）を検出した場合、エラー終了させず、自動的に `skipped` モードで安全に処理をスキップ。
- **CLIコンソールログの色付け表示（視認性向上）**: 各種SNSのプレーステキストのカラー表示（例: `[Instagram]` はマゼンタ、`[Bluesky]` はシアンなど）、`Found N items` の色付け（1件以上は緑、0件は黄）、およびエラー行の赤色強調表示を導入。

### Version 1.2.1
- **コレクターのタイムアウトフリーズ対策**: SNSデータ収集中のフリーズを防ぐため、各コレクター処理に最大2分間の個別タイムアウトを設定。

### Version 1.2.0
- **Instagram ストーリーズの AI Vision 分析機能**:
  - Playwright を用いたストーリーズ画面のスクリーンショット自動キャプチャ。
  - Gemini 2.5 Flash / OpenAI gpt-4o-mini による画像内容の分析と言語化に対応。
  - キーボード of 右矢印キー入力をシミュレートし、複数枚のストーリーズの自動巡回ループ処理を実装。
  - Gemini 失敗時の OpenAI 側への自動フォールバック。
  - 思考トークン消費による出力途切れ防止として maxOutputTokens を 1000 に調整。

### Version 1.1.0
- **再生成モード (`--redo`)**: `--redo` オプション付きで起動することで、指定日付のログを自動でクリアし、収集・生成・投稿を再度やり直すことができます。
- **APIリトライの自動バックオフ**: 一時的なエラー（503や500、レート制限の429など）発生時に、最大4回の指数バックオフで自動再試行するロジックを実装。また、クォータ枯渇エラーの場合は無駄にリトライせず即時停止します。
- **GeminiからOpenAIへの自動フォールバック**: Gemini APIのリトライが上限に達した場合、OpenAI APIキーが設定されていれば自動でOpenAI APIを用いてエッセイ生成を継続します。
- **タグの自動同期**: `package.json` のバージョン番号から現在のリリースフェーズに対応する識別用タグ（例：`1.1.0` ➔ `Phase6`）を自動的に算出して、しずかなインターネットの記事に設定します。
- **待機用スピナー表示**: AI生成や投稿処理の待機中に、ターミナルでブレイルドットが回転するスピナー表示を追加（タスクスケジューラ等の非TTY環境下では自動で非表示ログになります）。

### Version 1.0.0 (初回公開版)
- **マルチチャネル収集**: Bluesky、X/Twitter、GitHub、RSS、Threads、Instagram、Facebook の計7系統からの日常アクティビティ収集に対応。
- **ハイブリッドAIエッセイ生成**: Gemini 2.5 Flash / OpenAI GPT-4o-mini 等を用いて、収集した具体的事実に基づく日本語エッセイを自動生成。
- **Obsidian Vault 連携**: Frontmatter付きのMarkdown形式で、ローカルの指定フォルダへ自動書き出し・保存。
- **しずかなインターネット (sizu.me) 下書き自動保存**: Playwrightを用いたブラウザ操作により、記事本文・タイトルの流し込み、および「AI文章生成」「実験中」「日々是好日」「Phase4」などのネイティブタグを設定した状態での下書き保存（プライベート設定）に対応。
- **過去日付実行のサポート**: 遡り実行コマンド（`--date=YYYY-MM-DD`）と、Playwrightを用いたしずかなインターネット上での投稿作成日・公開日変更の自動化。
- **Windows完全自動化サポート**: バックグラウンドでのサイレント自動実行バッチ（`batch/` ディレクトリ）およびタスクスケジューラ自動登録スクリプトの提供。

