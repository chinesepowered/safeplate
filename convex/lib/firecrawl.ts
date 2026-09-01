"use node";

import Firecrawl from "firecrawl";

/**
 * The ONLY module that talks to Firecrawl. Never imported from src/ — the API
 * key lives on the Convex deployment and must never reach the browser bundle.
 * Every call is metered (see convex/usage.ts) so the free-tier credit budget
 * can be watched and capped.
 */
export function firecrawl() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set on this deployment");
  return new Firecrawl({ apiKey });
}

/** Default cache window: repeat scrapes inside this window cost no credits. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type SearchHit = { url: string; title?: string; description?: string; markdown?: string };

/** Web search with page content in one call. Costs ~2 credits per 10 results. */
export async function search(query: string, limit = 5): Promise<SearchHit[]> {
  const res: any = await firecrawl().search(query, {
    limit,
    scrapeOptions: { formats: ["markdown"], maxAge: MAX_AGE_MS },
  });
  const web = res?.web ?? res?.data ?? res ?? [];
  return (Array.isArray(web) ? web : []).map((r: any) => ({
    url: r.url,
    title: r.title,
    description: r.description,
    markdown: r.markdown ?? r.content,
  }));
}

/** Scrape one page to markdown. 1 credit (0 on a cache hit). */
export async function scrape(url: string): Promise<{ markdown: string; title?: string }> {
  const res: any = await firecrawl().scrape(url, {
    formats: ["markdown"],
    maxAge: MAX_AGE_MS,
  });
  return { markdown: res?.markdown ?? "", title: res?.metadata?.title };
}

/** List the URLs on a site (e.g. to find a menu or contact page). */
export async function map(url: string, limit = 30): Promise<string[]> {
  const res: any = await firecrawl().map(url, { limit });
  const links = res?.links ?? res?.data ?? [];
  return (Array.isArray(links) ? links : []).map((l: any) => (typeof l === "string" ? l : l.url));
}

/** Keep stored page text small: enough for a source preview, not a whole page. */
export function excerpt(markdown: string, chars = 1500): string {
  return markdown.slice(0, chars);
}
