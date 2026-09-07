"use node";

import { v, type Infer } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createHash } from "node:crypto";
import { z } from "zod";
import { search, map, scrape, scrapeJson, excerpt } from "./lib/firecrawl";
import { extract, modelId } from "./lib/llm";
import { geocode } from "./lib/geo";
import { rateLimiter, isRateLimitError, QUOTA_MESSAGE, assertNotPaused } from "./lib/limits";
import { statusV } from "./schema";

/**
 * Firecrawl side of the pipeline: find the restaurant, find its menu page, and
 * turn that page into dish rows. Nothing here judges anything — the verdicts
 * are ai.reviewMenu's job. Everything is written through internal mutations, so
 * the UI watches rows appear rather than waiting on a request.
 *
 * Every Firecrawl call goes through the gateway in lib/firecrawl.ts, which
 * serves a saved copy when it has one and refuses to spend when the shared
 * credit pool is near its floor. A refusal is not a failure: the restaurant
 * lands in "paused", keeps whatever it already had, and never gains a verdict.
 */

type Status = Infer<typeof statusV>;

/** What Firecrawl is asked to pull out of a menu page. */
const menuJsonSchema = {
  type: "object",
  properties: {
    restaurantName: { type: "string" },
    address: { type: "string" },
    contactEmail: { type: "string" },
    dishes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          price: { type: "string" },
          section: { type: "string" },
          ingredients: { type: "array", items: { type: "string" } },
        },
        required: ["name"],
      },
    },
  },
  required: ["dishes"],
} as const;

const MENU_PROMPT =
  "Extract every dish on this restaurant menu exactly as written. For each dish " +
  "give the name, the description verbatim, the price if shown, the menu section, " +
  "and any ingredients named in the description. Do not invent ingredients that " +
  "are not written on the page. Also extract the restaurant name, its street " +
  "address, and any contact email address shown.";

/** Fallback when Firecrawl's JSON extraction comes back empty: parse markdown. */
const MenuFallback = z.object({
  restaurantName: z.string().optional(),
  address: z.string().optional(),
  contactEmail: z.string().optional(),
  dishes: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        price: z.string().optional(),
        section: z.string().optional(),
        ingredients: z.array(z.string()).optional(),
      }),
    )
    .max(80),
});

type Menu = {
  restaurantName?: string;
  address?: string;
  contactEmail?: string;
  dishes: {
    name: string;
    description?: string;
    price?: string;
    section?: string;
    ingredients?: string[];
  }[];
};

/**
 * Real menu pages are messy — an extractor will hand back a dish with a numeric
 * price, a missing name, or an ingredient list of nulls. Rather than throwing
 * the whole menu away over one bad row, coerce what is usable and drop the rest.
 */
function normalizeMenu(raw: any): Menu | null {
  if (!raw || typeof raw !== "object") return null;
  const str = (x: unknown, max: number) =>
    typeof x === "string" && x.trim() ? x.trim().slice(0, max) : undefined;
  const items = Array.isArray(raw.dishes) ? raw.dishes : [];
  const dishes: Menu["dishes"] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const name = str(it.name, 120);
    if (!name) continue;
    const ing = Array.isArray(it.ingredients)
      ? it.ingredients.filter((x: unknown) => typeof x === "string" && x.trim()).slice(0, 20)
      : undefined;
    dishes.push({
      name,
      description: str(it.description, 600),
      price:
        str(it.price, 32) ?? (typeof it.price === "number" ? String(it.price) : undefined),
      section: str(it.section, 80),
      ingredients: ing?.length ? ing : undefined,
    });
    if (dishes.length >= 80) break;
  }
  if (!dishes.length) return null;
  // Extractors say "Not provided" rather than leaving a field out, and that
  // string would end up on the card as the restaurant's address.
  const real = (x: string | undefined) =>
    x && !/^(n\/?a|none|null|unknown|not (provided|listed|specified|available))\.?$/i.test(x)
      ? x
      : undefined;
  const email = real(str(raw.contactEmail, 160)?.toLowerCase());
  return {
    restaurantName: real(str(raw.restaurantName, 160)),
    address: real(str(raw.address, 240)),
    contactEmail: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined,
    dishes,
  };
}

function looksLikeMenu(url: string): number {
  const u = url.toLowerCase();
  let score = 0;
  if (/\bmenus?\b/.test(u)) score += 3;
  if (u.includes("food") || u.includes("dinner") || u.includes("lunch")) score += 1;
  if (u.includes("allergen") || u.includes("nutrition") || u.includes("dietary")) score += 2;
  if (u.endsWith(".pdf")) score -= 1;
  if (u.includes("gift") || u.includes("careers") || u.includes("blog")) score -= 3;
  return score;
}

function hashDishes(names: string[]): string {
  return createHash("sha256").update(names.join("|").toLowerCase()).digest("hex").slice(0, 16);
}

async function fail(ctx: ActionCtx, restaurantId: Id<"restaurants">, detail: string) {
  await ctx.runMutation(internal.restaurants.patchRestaurant, {
    restaurantId,
    status: "failed",
    statusDetail: detail,
  });
}

const PAUSED_DETAIL =
  "Live menu checks are paused right now to protect the shared crawl budget. " +
  "Nothing about this restaurant has been checked yet — try again later.";

/**
 * The gateway declined to spend credits and had no saved copy to fall back on.
 * That is not a failure and it is certainly not an "all clear": leave the row
 * in a plainly unfinished state with no verdict, and put back whatever status
 * it held before a re-scan started, so a restaurant the kitchen already
 * confirmed does not silently drop off the caregiver's safe list.
 */
async function pauseForBudget(
  ctx: ActionCtx,
  restaurantId: Id<"restaurants">,
  resumeStatus?: Status,
) {
  await ctx.runMutation(internal.restaurants.patchRestaurant, {
    restaurantId,
    status: resumeStatus && resumeStatus !== "scraping" ? resumeStatus : "paused",
    statusDetail: PAUSED_DETAIL,
  });
}

/** Only a call that actually hit the network counts against the free tier. */
async function bumpIfSpent(ctx: ActionCtx, cached: boolean) {
  if (!cached) await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
}

/**
 * search → map → scrape. Given a URL we skip straight to map+scrape; given a
 * name we let Firecrawl's search find the site first.
 */
export const discover = internalAction({
  args: {
    restaurantId: v.id("restaurants"),
    query: v.optional(v.string()),
    url: v.optional(v.string()),
    /** Status to put back if we decline to crawl (a re-scan of a saved row). */
    resumeStatus: v.optional(statusV),
  },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.restaurants.internalGet, {
      restaurantId: args.restaurantId,
    });
    if (!row?.restaurant) return;
    const { restaurant } = row;

    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "globalBurst", { throws: true });
      await rateLimiter.limit(ctx, "userCrawl", {
        key: restaurant.ownerId,
        throws: true,
      });
      await rateLimiter.limit(ctx, "globalCrawl", { throws: true });
    } catch (e) {
      await fail(
        ctx,
        args.restaurantId,
        isRateLimitError(e) ? QUOTA_MESSAGE : String((e as Error).message ?? e),
      );
      return;
    }

    let website = args.url ?? restaurant.website;
    let name = restaurant.name;

    try {
      // 1. Find the restaurant's site if we only have a name.
      if (!website && args.query) {
        await ctx.runMutation(internal.restaurants.patchRestaurant, {
          restaurantId: args.restaurantId,
          statusDetail: `Searching the web for “${args.query}”…`,
        });
        // limit 3: search costs credits per batch of results.
        const found = await search(ctx, `${args.query} restaurant menu`, 3);
        if (!found.data) {
          if (found.reason === "budget") {
            await pauseForBudget(ctx, args.restaurantId, args.resumeStatus);
            return;
          }
          await fail(ctx, args.restaurantId, "Could not find a website for that restaurant.");
          return;
        }
        await bumpIfSpent(ctx, found.cached);
        const hits = found.data;
        const hit = hits.find((h) => h.url && !h.url.includes("google.")) ?? hits[0];
        if (!hit?.url) {
          await fail(ctx, args.restaurantId, "Could not find a website for that restaurant.");
          return;
        }
        website = hit.url;
        if (hit.title) name = hit.title.split(/[|–—-]/)[0].trim() || name;
      }

      if (!website) {
        await fail(ctx, args.restaurantId, "No website to read.");
        return;
      }

      // 2. Enumerate the site and pick the most menu-looking page. Skipping
      //    this when the budget is out is harmless: we still have the page we
      //    were given.
      let menuUrl = website;
      if (!/menu/i.test(website)) {
        await ctx.runMutation(internal.restaurants.patchRestaurant, {
          restaurantId: args.restaurantId,
          statusDetail: "Looking for the menu page…",
        });
        try {
          const mapped = await map(ctx, new URL(website).origin, 30);
          await bumpIfSpent(ctx, mapped.cached);
          const ranked = (mapped.data ?? [])
            .filter(Boolean)
            .map((u) => ({ u, s: looksLikeMenu(u) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s);
          if (ranked.length) menuUrl = ranked[0].u;
        } catch {
          // A site that refuses mapping is fine — scrape the page we were given.
        }
      }

      // 3. Scrape it, asking Firecrawl for structured dishes in the same call.
      await ctx.runMutation(internal.restaurants.patchRestaurant, {
        restaurantId: args.restaurantId,
        statusDetail: "Reading the menu…",
        menuUrl,
        sourceUrl: menuUrl,
        website,
      });

      let markdown = "";
      let parsed: Menu | null = null;
      /** True when the dishes came out of our store rather than a live read. */
      let fromSavedCopy = false;

      try {
        const res = await scrapeJson<any>(ctx, menuUrl, menuJsonSchema as any, MENU_PROMPT);
        if (!res.data) {
          if (res.reason === "budget") {
            await pauseForBudget(ctx, args.restaurantId, args.resumeStatus);
            return;
          }
        } else {
          await bumpIfSpent(ctx, res.cached);
          if (res.stale) fromSavedCopy = true;
          markdown = res.data.markdown ?? "";
          parsed = normalizeMenu(res.data.json);
        }
      } catch {
        // Fall through to markdown + LLM.
      }

      if (!parsed) {
        if (!markdown) {
          const res = await scrape(ctx, menuUrl);
          if (!res.data) {
            if (res.reason === "budget") {
              await pauseForBudget(ctx, args.restaurantId, args.resumeStatus);
              return;
            }
          } else {
            await bumpIfSpent(ctx, res.cached);
            if (res.stale) fromSavedCopy = true;
            markdown = res.data.markdown ?? "";
          }
        }
        if (!markdown.trim()) {
          await fail(
            ctx,
            args.restaurantId,
            "That page had no readable menu text (it may be an image or a PDF). Add the menu URL directly, or email the restaurant.",
          );
          return;
        }
        await rateLimiter.limit(ctx, "globalLlm", { throws: false });
        const llmMenu = await extract(
          MenuFallback,
          `Menu page text:\n\n${markdown.slice(0, 12000)}`,
          {
            system:
              "You read restaurant menus. Copy dish names and descriptions exactly as " +
              "written; never invent ingredients. Keep each description under 200 " +
              "characters. If the page is not a menu, return an empty dishes array.",
            maxTokens: 8000,
          },
        );
        await ctx.runMutation(internal.usage.bump, { provider: "llm" });
        parsed = normalizeMenu(llmMenu);
      }

      if (!parsed || !parsed.dishes.length) {
        await fail(
          ctx,
          args.restaurantId,
          "No dishes found on that page. Try linking straight to the menu page.",
        );
        return;
      }

      const dishes = parsed.dishes;

      const hash = hashDishes(dishes.map((d) => d.name));
      const changed = Boolean(restaurant.menuHash && restaurant.menuHash !== hash);

      await ctx.runMutation(internal.restaurants.replaceDishes, {
        restaurantId: args.restaurantId,
        dishes,
      });

      // A pin is a nicety; a missing one never blocks the pipeline.
      let coords: { lat: number; lng: number } | null = null;
      if (parsed.address) coords = await geocode(parsed.address);

      await ctx.runMutation(internal.restaurants.patchRestaurant, {
        restaurantId: args.restaurantId,
        name: parsed.restaurantName || name,
        address: parsed.address,
        contactEmail: restaurant.contactEmail ?? parsed.contactEmail,
        lat: coords?.lat,
        lng: coords?.lng,
        menuExcerpt: markdown ? excerpt(markdown, 1500) : undefined,
        menuHash: hash,
        menuChanged: changed || undefined,
        lastScrapedAt: Date.now(),
        statusDetail: `Found ${dishes.length} dishes${
          fromSavedCopy ? " in a saved copy of this menu" : ""
        }. Checking them against the profile…`,
        model: modelId(),
      });

      await ctx.scheduler.runAfter(0, internal.ai.reviewMenu, {
        restaurantId: args.restaurantId,
      });
    } catch (e) {
      await fail(
        ctx,
        args.restaurantId,
        isRateLimitError(e) ? QUOTA_MESSAGE : `Could not read that menu: ${String((e as Error).message ?? e)}`,
      );
    }
  },
});

/**
 * Weekly sweep (convex/crons.ts). Menus change; a dish that was confirmed safe
 * in March may not be in June, so a changed menu re-runs the review and raises
 * the "menu changed" badge instead of leaving a stale green pin.
 */
export const rescanAll = internalAction({
  args: {},
  handler: async (ctx) => {
    if (process.env.APP_PAUSED === "1") return;
    const week = 7 * 24 * 60 * 60 * 1000;
    const due = await ctx.runQuery(internal.restaurants.dueForRescan, {
      olderThan: Date.now() - week,
      limit: 5, // keep the weekly Firecrawl spend bounded
    });
    for (const r of due) {
      await ctx.scheduler.runAfter(0, internal.menu.discover, {
        restaurantId: r._id,
        url: r.menuUrl,
        resumeStatus: r.status,
      });
    }
  },
});

/**
 * Ops probe: exercise the crawl gateway directly, bypassing the per-call token,
 * so the credit guard and the stored-result fallback can be checked on a live
 * deployment without touching product state.
 */
export const budgetProbe = internalAction({
  args: { url: v.string() },
  handler: async (
    ctx,
    { url },
  ): Promise<{ hasData: boolean; cached: boolean; stale: boolean; reason?: string }> => {
    const r = await scrape(ctx, url);
    return { hasData: Boolean(r.data), cached: r.cached, stale: r.stale, reason: r.reason };
  },
});
