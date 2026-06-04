import { get } from "node:https";
import type { CollectionResult } from "../types.js";

const AUTHOR_FEED_ENDPOINT =
  "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";

type BlueskyFeedFilter =
  | "posts_with_replies"
  | "posts_no_replies"
  | "posts_with_media"
  | "posts_and_author_threads"
  | "posts_with_video";

export type BlueskyCollectorOptions = {
  actor: string | undefined;
  limit: number;
  filter: BlueskyFeedFilter;
  now: Date;
};

export async function collectBlueskyPosts(
  options: BlueskyCollectorOptions,
): Promise<CollectionResult> {
  const collectedAt = options.now.toISOString();
  const actor = options.actor?.trim();

  if (!actor) {
    return {
      source: "bluesky",
      collectedAt,
      items: [],
      raw: {
        mode: "skipped",
        actor: null,
        note: "SIZU_BLUESKY_ACTOR is not configured. No external Bluesky request was made.",
      },
    };
  }

  const requestUrl = buildAuthorFeedUrl({
    actor,
    limit: options.limit,
    filter: options.filter,
  });

  const response = await requestJson(requestUrl);

  if (response.status < 200 || response.status >= 300) {
    return {
      source: "bluesky",
      collectedAt,
      items: [],
      raw: {
        mode: "error",
        requestUrl,
        status: response.status,
        statusText: response.statusText,
        body: response.body,
      },
    };
  }

  const feed = parseAuthorFeedResponse(response.body);

  return {
    source: "bluesky",
    collectedAt,
    items: feed
      .map((entry) => toActivityItem(entry))
      .filter((item) => item !== null),
    raw: {
      mode: "ok",
      requestUrl,
      response: response.body,
    },
  };
}

function buildAuthorFeedUrl(options: {
  actor: string;
  limit: number;
  filter: BlueskyFeedFilter;
}): string {
  const url = new URL(AUTHOR_FEED_ENDPOINT);
  url.searchParams.set("actor", options.actor);
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("filter", options.filter);
  url.searchParams.set("includePins", "false");

  return url.toString();
}

function parseAuthorFeedResponse(responseBody: unknown): unknown[] {
  if (
    typeof responseBody === "object" &&
    responseBody !== null &&
    "feed" in responseBody &&
    Array.isArray(responseBody.feed)
  ) {
    return responseBody.feed;
  }

  return [];
}

function toActivityItem(entry: unknown): CollectionResult["items"][number] | null {
  if (!isRecord(entry) || !("post" in entry)) {
    return null;
  }

  const post = entry.post;

  if (!isRecord(post)) {
    return null;
  }

  const uri = readString(post, "uri");
  const cid = readString(post, "cid");
  const indexedAt = readString(post, "indexedAt");
  const record = readObject(post, "record");
  const author = readObject(post, "author");
  const text = record ? readString(record, "text") : undefined;
  const createdAt = record ? readString(record, "createdAt") : undefined;
  const handle = author ? readString(author, "handle") : undefined;

  if (!uri || !text || !createdAt) {
    return null;
  }

  return {
    id: uri,
    source: "bluesky",
    text,
    createdAt,
    url: handle ? toBskyPostUrl(handle, uri) : undefined,
    metadata: {
      cid,
      indexedAt,
      authorHandle: handle,
    },
  };
}

function readObject(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const nested = value[key];
  return typeof nested === "object" && nested !== null
    ? (nested as Record<string, unknown>)
    : undefined;
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const nested = value[key];
  return typeof nested === "string" ? nested : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toBskyPostUrl(handle: string, uri: string): string | undefined {
  const parts = uri.split("/");
  const rkey = parts[parts.length - 1];

  if (!rkey) {
    return undefined;
  }

  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

export function parseBlueskyFeedFilter(
  value: string | undefined,
): BlueskyFeedFilter {
  switch (value) {
    case "posts_with_replies":
    case "posts_no_replies":
    case "posts_with_media":
    case "posts_and_author_threads":
    case "posts_with_video":
      return value;
    default:
      return "posts_no_replies";
  }
}

type JsonResponse = {
  status: number;
  statusText: string;
  body: unknown;
};

function requestJson(requestUrl: string): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const request = get(
      requestUrl,
      {
        headers: {
          accept: "application/json",
          "user-agent": "sizu-project/0.1",
        },
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            body: parseJson(body),
          });
        });
      },
    );

    request.setTimeout(15_000, () => {
      request.destroy(new Error(`Request timed out: ${requestUrl}`));
    });
    request.on("error", reject);
  });
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
