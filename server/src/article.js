import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

// Pulls the main article text out of a blog post URL, stripping nav/ads/
// comments boilerplate via the same engine Firefox's reader mode uses.
export async function fetchArticleText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Storyprism/1.0)" },
  });
  if (!res.ok) throw new Error(`Could not fetch that page: ${res.status}`);
  const html = await res.text();

  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  if (!article || !article.textContent?.trim()) {
    throw new Error("Couldn't find readable article content on that page");
  }
  return { title: article.title || "", text: article.textContent.trim() };
}
