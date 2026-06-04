import type { CollectionResult, CollectedActivityItem } from "../types.js";

export type GitHubCollectorOptions = {
  username: string | undefined;
  token: string | undefined;
  now: Date;
};

export async function collectGitHubEvents(
  options: GitHubCollectorOptions,
): Promise<CollectionResult> {
  const collectedAt = options.now.toISOString();
  const username = options.username?.trim();

  if (!username) {
    return {
      source: "github",
      collectedAt,
      items: [],
      raw: {
        mode: "skipped",
        username: null,
        note: "SIZU_GITHUB_USERNAME is not configured. GitHub collection skipped.",
      },
    };
  }

  // GitHub API endpoint (supports public events without auth, or authenticated events including private ones)
  const url = `https://api.github.com/users/${username}/events`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github.v3+json",
    "user-agent": "sizu-project/0.1.0",
  };

  if (options.token) {
    headers["authorization"] = `token ${options.token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      source: "github",
      collectedAt,
      items: [],
      raw: {
        mode: "error",
        url,
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      },
    };
  }

  const events = (await response.json()) as any[];
  const dateStamp = getDateStamp(options.now); // YYYY-MM-DD

  // Filter events created on the calendar date "today" (based on options.now)
  const todaysEvents = events.filter((event: any) => {
    return event.created_at && event.created_at.startsWith(dateStamp);
  });

  const items: CollectedActivityItem[] = [];

  for (const event of todaysEvents) {
    const text = toGitHubActivityText(event);
    if (!text) {
      continue;
    }

    const repoName = event.repo?.name ?? "unknown";
    const id = event.id ?? String(Math.random());
    const createdAt = event.created_at ?? collectedAt;
    const url = event.repo?.url
      ? `https://github.com/${repoName}`
      : undefined;

    items.push({
      id,
      source: "github",
      text,
      createdAt,
      url,
      metadata: {
        type: event.type,
        repoName,
      },
    });
  }

  return {
    source: "github",
    collectedAt,
    items,
    raw: {
      mode: "ok",
      url,
      response: events,
    },
  };
}

function getDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toGitHubActivityText(event: any): string | null {
  const type = event.type;
  const repoName = event.repo?.name ?? "unknown-repo";

  switch (type) {
    case "PushEvent": {
      const commits = event.payload?.commits ?? [];
      if (commits.length === 0) {
        return `リポジトリ ${repoName} へプッシュを行いました。`;
      }
      return commits
        .map((c: any) => `リポジトリ ${repoName} へコミット: "${c.message ?? ""}"`)
        .join("\n");
    }
    case "CreateEvent": {
      const refType = event.payload?.ref_type ?? "repository";
      const ref = event.payload?.ref;
      if (refType === "repository") {
        return `リポジトリ ${repoName} を新規作成しました。`;
      }
      return `リポジトリ ${repoName} にて新しい${refType}「${ref ?? ""}」を作成しました。`;
    }
    case "PullRequestEvent": {
      const action = event.payload?.action ?? "updated";
      const title = event.payload?.pull_request?.title ?? "";
      const actionJp = action === "opened" ? "オープン" : action === "closed" ? "クローズ" : action;
      return `リポジトリ ${repoName} にてプルクエスト「${title}」を${actionJp}しました。`;
    }
    case "IssuesEvent": {
      const action = event.payload?.action ?? "updated";
      const title = event.payload?.issue?.title ?? "";
      const actionJp = action === "opened" ? "オープン" : action === "closed" ? "クローズ" : action;
      return `リポジトリ ${repoName} にてイシュー「${title}」を${actionJp}しました。`;
    }
    case "IssueCommentEvent": {
      const title = event.payload?.issue?.title ?? "";
      return `リポジトリ ${repoName} のイシュー「${title}」にコメントを追加しました。`;
    }
    case "WatchEvent": {
      return `リポジトリ ${repoName} をスター登録（ウォッチ）しました。`;
    }
    default:
      return null;
  }
}
