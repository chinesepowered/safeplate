"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { createHash } from "node:crypto";
import { z } from "zod";
import { search, map, scrape, scrapeJson, excerpt } from "./lib/firecrawl";
import { extract, modelId } from "./lib/llm";
import { geocode } from "./lib/geo";
import { rateLimiter, isRateLimitError, QUOTA_MESSAGE, assertNotPaused } from "./lib/limits";

/**
 * Firecrawl side of the pipeline: find the restaurant, find its menu page, and
 * turn that page into dish rows. Nothing here judges anything — the verdicts
 * are ai.reviewMenu's job. Everything is written through internal mutations, so
 * the UI watches rows appear rather than waiting on a request.
 */

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

async function fail(ctx: any, restaurantId: any, detail: string) {
  await ctx.runMutation(internal.restaurants.patchRestaurant, {
    restaurantId,
    status: "failed",
    statusDetail: detail,
  });
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
        const hits = await search(`${args.query} restaurant menu`, 3);
        await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
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

      // 2. Enumerate the site and pick the most menu-looking page.
      let menuUrl = website;
      if (!/menu/i.test(website)) {
        await ctx.runMutation(internal.restaurants.patchRestaurant, {
          restaurantId: args.restaurantId,
          statusDetail: "Looking for the menu page…",
        });
        try {
          const links = await map(new URL(website).origin, 30);
          await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
          const ranked = links
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
      let parsed: z.infer<typeof MenuFallback> | null = null;

      try {
        const res = await scrapeJson(menuUrl, menuJsonSchema as any, MENU_PROMPT);
        await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
        markdown = res.markdown ?? "";
        const check = MenuFallback.safeParse(res.json ?? {});
        if (check.success && check.data.dishes.length) parsed = check.data;
      } catch {
        // Fall through to markdown + LLM.
      }

      if (!parsed) {
        if (!markdown) {
          const res = await scrape(menuUrl);
          await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
          markdown = res.markdown ?? "";
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
        parsed = await extract(
          MenuFallback,
          `Menu page text:\n\n${markdown.slice(0, 18000)}`,
          {
            system:
              "You read restaurant menus. Copy dish names and descriptions exactly as " +
              "written; never invent ingredients. If the page is not a menu, return an " +
              "empty dishes array.",
            maxTokens: 4000,
          },
        );
        await ctx.runMutation(internal.usage.bump, { provider: "llm" });
      }

      if (!parsed.dishes.length) {
        await fail(
          ctx,
          args.restaurantId,
          "No dishes found on that page. Try linking straight to the menu page.",
        );
        return;
      }

      const dishes = parsed.dishes
        .filter((d) => d.name?.trim())
        .slice(0, 80)
        .map((d) => ({
          name: d.name.trim().slice(0, 120),
          description: d.description?.trim().slice(0, 600) || undefined,
          price: d.price?.trim().slice(0, 32) || undefined,
          section: d.section?.trim().slice(0, 80) || undefined,
          ingredients: d.ingredients?.length ? d.ingredients.slice(0, 20) : undefined,
        }));

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
        name: parsed.restaurantName?.trim() || name,
        address: parsed.address?.trim() || undefined,
        contactEmail: restaurant.contactEmail ?? parsed.contactEmail?.trim().toLowerCase(),
        lat: coords?.lat,
        lng: coords?.lng,
        menuExcerpt: markdown ? excerpt(markdown, 1500) : undefined,
        menuHash: hash,
        menuChanged: changed || undefined,
        lastScrapedAt: Date.now(),
        statusDetail: `Found ${dishes.length} dishes. Checking them against the profile…`,
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
      });
    }
  },
});
