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

- **Gemini 2.5 Flash**（推奨・無料枠対応）
- **OpenAI GPT-4o / GPT-4o-mini**

どちらを使うかは `.env` の `SIZU_AI_PROVIDER` で切り替えられます。

### 出力先

- **Obsidian Vault**（Markdown + Frontmatter 形式）
- **しずかなインターネット (sizu.me)**（Playwright によるプライベート下書き自動保存）

### その他の特徴

- SNSのアクティビティが**ゼロの日は生成をスキップ**し、内容のない記事の生成を防止
- `--date=YYYY-MM-DD` 引数で**過去の日付**を指定した遡り実行に対応
- **Windows タスクスケジューラ**との連携による完全無人自動実行（`batch/` ディレクトリ）

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
