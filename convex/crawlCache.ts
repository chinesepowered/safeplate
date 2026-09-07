import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

/**
 * Persistence and budgeting for Firecrawl, in the default runtime so the
 * "use node" crawl helpers can reach it through ctx.
 *
 * Two jobs:
 *   - a permanent result cache, so the second judge to do the same thing as the
 *     first costs nothing, and so a crawl we can no longer afford still has an
 *     answer to show;
 *   - a spend guard denominated in CREDITS, because Firecrawl bills in credits
 *     while a rate limiter counts calls, and one JSON-extraction scrape is
 *     worth about ten plain ones.
 */

export const get = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    return await ctx.db
      .query("crawlCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
  },
});

export const put = internalMutation({
  args: { key: v.string(), payload: v.string(), credits: v.number() },
  handler: async (ctx, { key, payload, credits }) => {
    const existing = await ctx.db
      .query("crawlCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const row = { key, payload, credits, fetchedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("crawlCache", row);
  },
});

export const readBudget = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("crawlBudget")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
  },
});

/** Record what Firecrawl itself says is left, so the guard uses truth, not a guess. */
export const saveRemaining = internalMutation({
  args: { remainingCredits: v.number() },
  handler: async (ctx, { remainingCredits }) => {
    const row = await ctx.db
      .query("crawlBudget")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const day = new Date().toISOString().slice(0, 10);
    if (row) {
      await ctx.db.patch(row._id, {
        remainingCredits,
        checkedAt: Date.now(),
        ...(row.day === day ? {} : { day, spentToday: 0 }),
      });
    } else {
      await ctx.db.insert("crawlBudget", {
        key: "singleton",
        remainingCredits,
        checkedAt: Date.now(),
        day,
        spentToday: 0,
      });
    }
  },
});

export const addSpend = internalMutation({
  args: { credits: v.number() },
  handler: async (ctx, { credits }) => {
    const row = await ctx.db
      .query("crawlBudget")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const day = new Date().toISOString().slice(0, 10);
    if (!row) {
      await ctx.db.insert("crawlBudget", {
        key: "singleton",
        remainingCredits: 0,
        checkedAt: 0,
        day,
        spentToday: credits,
      });
      return;
    }
    const sameDay = row.day === day;
    await ctx.db.patch(row._id, {
      day,
      spentToday: (sameDay ? row.spentToday : 0) + credits,
      // Local estimate between authoritative checks, so a burst inside one
      // five-minute window still moves the guard.
      remainingCredits: Math.max(0, row.remainingCredits - credits),
    });
  },
});

/**
 * Whether live crawling is currently affordable. Public so the UI can say
 * "showing saved results" honestly instead of looking broken. Deliberately a
 * boolean and not the raw credit balance.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("crawlBudget")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (!row) return { live: true, checkedAt: 0 };
    const reserve = Number(process.env.FIRECRAWL_MIN_CREDITS ?? 1500);
    const daily = Number(process.env.FIRECRAWL_DAILY_CREDITS ?? 300);
    const day = new Date().toISOString().slice(0, 10);
    const spentToday = row.day === day ? row.spentToday : 0;
    return {
      live: row.remainingCredits > reserve && spentToday < daily,
      checkedAt: row.checkedAt,
    };
  },
});
