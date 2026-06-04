import type { GeneratedArticle } from "../../types/article.js";

export function renderDailyArticleMarkdown(article: GeneratedArticle): string {
  const tags = article.tags.map((tag) => `"${tag}"`).join(", ");

  return [
    "---",
    `date: ${article.date}`,
    `tags: [${tags}]`,
    "project: SIZU_PROJECT",
    "related: [[00_Project_Index]], [[phase-1-mvp]]",
    "---",
    "",
    `# ${article.title}`,
    "",
    article.body,
    "",
  ].join("\n");
}
