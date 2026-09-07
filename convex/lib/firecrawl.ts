"use node";

import Firecrawl from "firecrawl";
import { internal } from "../_generated/api";

/**
 * The ONLY module that talks to Firecrawl. Never imported from src/ — the API
 * key lives on the Convex deployment and must never reach the browser bundle.
 *
 * Everything goes through one gateway that, in order:
 *   1. serves a stored result when we already have one;
 *   2. refuses to spend when the account is near its floor or over today's
 *      budget, falling back to the stored result even if stale;
 *   3. only then calls Firecrawl, and records what it cost.
 *
 * The floor is checked against Firecrawl's own credit-usage endpoint, which is
 * free to call, so running the pool dry is structurally prevented rather than
 * merely tuned. A judge who repeats what an earlier judge did costs nothing.
 */
export function firecrawl() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set on this deployment");
  return new Firecrawl({ apiKey });
}

/** Firecrawl-side cache window; a repeat fetch inside it is free to us. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Keep a stored result usable this long before we prefer a fresh one. */
const CACHE_TTL_MS = Number(process.env.FIRECRAWL_CACHE_TTL_HOURS ?? 168) * 60 * 60 * 1000;
/** Never spend the pool below this. Reserved for judging. */
const RESERVE = () => Number(process.env.FIRECRAWL_MIN_CREDITS ?? 1500);
/** Ceiling for one day, so a bad actor cannot drain a month in an afternoon. */
const DAILY_CAP = () => Number(process.env.FIRECRAWL_DAILY_CREDITS ?? 300);
/** How long an authoritative balance reading stays good. */
const BALANCE_TTL_MS = 5 * 60 * 1000;

type Ctx = {
  runQuery: (ref: any, args: any) => Promise<any>;
  runMutation: (ref: any, args: any) => Promise<any>;
};

export type CrawlResult<T> = {
  data: T | null;
  /** Served from our store rather than the network. */
  cached: boolean;
  /** Served from our store because we would not or could not fetch. */
  stale: boolean;
  reason?: "budget" | "error";
};

async function remainingCredits(ctx: Ctx): Promise<number> {
  const row = await ctx.runQuery(internal.crawlCache.readBudget, {});
  if (row && Date.now() - row.checkedAt < BALANCE_TTL_MS) return row.remainingCredits;
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", {
      headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` },
    });
    const j: any = await res.json();
    const remaining = Number(j?.data?.remainingCredits);
    if (Number.isFinite(remaining)) {
      await ctx.runMutation(internal.crawlCache.saveRemaining, { remainingCredits: remaining });
      return remaining;
    }
  } catch {
    // Fall through: an unreachable balance endpoint must not unblock spending.
  }
  return row?.remainingCredits ?? 0;
}

async function affordable(ctx: Ctx, cost: number): Promise<boolean> {
  const remaining = await remainingCredits(ctx);
  if (remaining - cost < RESERVE()) return false;
  const row = await ctx.runQuery(internal.crawlCache.readBudget, {});
  const day = new Date().toISOString().slice(0, 10);
  const spentToday = row && row.day === day ? row.spentToday : 0;
  return spentToday + cost <= DAILY_CAP();
}

async function gateway<T>(
  ctx: Ctx,
  key: string,
  cost: number,
  fetcher: () => Promise<T>,
): Promise<CrawlResult<T>> {
  const hit = await ctx.runQuery(internal.crawlCache.get, { key });
  const parse = (): T | null => {
    try {
      return JSON.parse(hit.payload) as T;
    } catch {
      return null;
    }
  };

  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return { data: parse(), cached: true, stale: false };
  }

  if (!(await affordable(ctx, cost))) {
    return hit
      ? { data: parse(), cached: true, stale: true, reason: "budget" }
      : { data: null, cached: false, stale: false, reason: "budget" };
  }

  try {
    const data = await fetcher();
    await ctx.runMutation(internal.crawlCache.put, {
      key,
      payload: JSON.stringify(data),
      credits: cost,
    });
    await ctx.runMutation(internal.crawlCache.addSpend, { credits: cost });
    return { data, cached: false, stale: false };
  } catch (e) {
    await ctx.runMutation(internal.crawlCache.addSpend, { credits: cost });
    if (hit) return { data: parse(), cached: true, stale: true, reason: "error" };
    throw e;
  }
}

export type SearchHit = { url: string; title?: string; description?: string; markdown?: string };

/** Web search with page content. Roughly 2 credits per 10 results plus content. */
export async function search(ctx: Ctx, query: string, limit = 5): Promise<CrawlResult<SearchHit[]>> {
  return gateway(ctx, `search:${limit}:${query.toLowerCase().trim()}`, 2 + limit, async () => {
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
  });
}

/** Scrape one page to markdown. About 1 credit. */
export async function scrape(
  ctx: Ctx,
  url: string,
): Promise<CrawlResult<{ markdown: string; title?: string }>> {
  return gateway(ctx, `scrape:${url}`, 1, async () => {
    const res: any = await firecrawl().scrape(url, {
      formats: ["markdown"],
      maxAge: MAX_AGE_MS,
    });
    return { markdown: res?.markdown ?? "", title: res?.metadata?.title };
  });
}

/**
 * Scrape one page and have Firecrawl extract structured JSON in the same call,
 * so a menu page comes back as dish rows rather than markdown we have to
 * re-parse. Firecrawl runs the extraction, so this still works when our own LLM
 * endpoint is down — and the extracted JSON is what we cache, so the app keeps
 * its dish rows long after the crawl budget is gone.
 */
export async function scrapeJson<T = unknown>(
  ctx: Ctx,
  url: string,
  schema: Record<string, unknown>,
  prompt: string,
): Promise<CrawlResult<{ markdown: string; title?: string; json: T | null }>> {
  return gateway(ctx, `scrapeJson:${url}`, 6, async () => {
    const res: any = await firecrawl().scrape(url, {
      formats: ["markdown", { type: "json", schema, prompt }],
      maxAge: MAX_AGE_MS,
      onlyMainContent: true,
    });
    return {
      markdown: res?.markdown ?? "",
      title: res?.metadata?.title,
      json: (res?.json ?? null) as T | null,
    };
  });
}

/** List the URLs on a site (e.g. to find a menu or contact page). */
export async function map(ctx: Ctx, url: string, limit = 30): Promise<CrawlResult<string[]>> {
  return gateway(ctx, `map:${limit}:${url}`, 1, async () => {
    const res: any = await firecrawl().map(url, { limit });
    const links = res?.links ?? res?.data ?? [];
    return (Array.isArray(links) ? links : []).map((l: any) =>
      typeof l === "string" ? l : l.url,
    );
  });
}

/** Keep stored page text small: enough for a source preview, not a whole page. */
export function excerpt(markdown: string, chars = 1500): string {
  return markdown.slice(0, chars);
}
