import type { CollectionResult, CollectedActivityItem } from "../types.js";

export type RssCollectorOptions = {
  feeds: string[];
  now: Date;
};

export async function collectRssFeeds(
  options: RssCollectorOptions,
): Promise<CollectionResult> {
  const collectedAt = options.now.toISOString();
  const feeds = options.feeds.filter((feed) => feed.trim().length > 0);

  if (feeds.length === 0) {
    return {
      source: "rss",
      collectedAt,
      items: [],
      raw: {
        mode: "skipped",
        note: "No RSS feeds configured. RSS collection skipped.",
      },
    };
  }

  const items: CollectedActivityItem[] = [];
  const rawResponses: Record<string, unknown> = {};

  for (const feedUrl of feeds) {
    try {
      const response = await fetch(feedUrl, {
        headers: {
          "user-agent": "sizu-project/0.1.0",
        },
      });

      if (!response.ok) {
        rawResponses[feedUrl] = {
          status: response.status,
          statusText: response.statusText,
        };
        continue;
      }

      const xmlText = await response.text();
      rawResponses[feedUrl] = { status: 200, bodyLength: xmlText.length };

      const parsedItems = parseRssXml(xmlText);

      for (const item of parsedItems) {
        const articleDate = new Date(item.date);
        if (Number.isNaN(articleDate.getTime())) {
          continue;
        }

        // Filter articles published on the calendar date "today"
        const isToday =
          articleDate.getFullYear() === options.now.getFullYear() &&
          articleDate.getMonth() === options.now.getMonth() &&
          articleDate.getDate() === options.now.getDate();

        if (!isToday) {
          continue;
        }

        const id = item.link;
        const text = `記事を読みました: 「${item.title}」`;
        const createdAt = articleDate.toISOString();

        items.push({
          id,
          source: "rss",
          text,
          createdAt,
          url: item.link,
          metadata: {
            title: item.title,
            originalDate: item.date,
          },
        });
      }
    } catch (error) {
      rawResponses[feedUrl] = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    source: "rss",
    collectedAt,
    items,
    raw: {
      mode: "ok",
      responses: rawResponses,
    },
  };
}

function parseRssXml(xmlText: string): Array<{ title: string; link: string; date: string }> {
  const items: Array<{ title: string; link: string; date: string }> = [];

  // Regex to match RSS <item> or Atom <entry> elements
  const itemRegex = /<(item|entry)>([\s\S]*?)<\/\1>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[2] ?? "";

    const titleMatch = /<title>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/.exec(itemContent);
    const linkMatch = /<link>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/link>/.exec(itemContent);
    const dateMatch = /<(pubDate|published|updated)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/\1>/.exec(itemContent);

    let link = "";
    if (linkMatch) {
      link = (linkMatch[1] || linkMatch[2] || "").trim();
    } else {
      // Some Atom feeds put the link inside an href attribute
      const linkAttrMatch = /<link[^>]*?href=["']([\s\S]*?)["']/.exec(itemContent);
      if (linkAttrMatch) {
        link = (linkAttrMatch[1] ?? "").trim();
      }
    }

    const title = (titleMatch ? (titleMatch[1] || titleMatch[2] || "") : "").trim();
    const date = (dateMatch ? (dateMatch[2] || dateMatch[3] || "") : "").trim();

    if (title && link) {
      items.push({ title, link, date });
    }
  }

  return items;
}
