import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/** Daily counters per provider, so the burn on each free tier is visible. */
export const bump = internalMutation({
  args: { provider: v.string(), amount: v.optional(v.number()) },
  handler: async (ctx, { provider, amount }) => {
    const day = new Date().toISOString().slice(0, 10);
    const row = await ctx.db
      .query("usage")
      .withIndex("by_day_provider", (q) => q.eq("day", day).eq("provider", provider))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, { count: row.count + (amount ?? 1) });
    } else {
      await ctx.db.insert("usage", { day, provider, count: amount ?? 1 });
    }
  },
});

/** Owner-only usage view (see /admin in the UI). */
export const today = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const day = new Date().toISOString().slice(0, 10);
    const rows = await ctx.db
      .query("usage")
      .withIndex("by_day_provider", (q) => q.eq("day", day))
      .collect();
    return {
      day,
      paused: process.env.APP_PAUSED === "1",
      counts: Object.fromEntries(rows.map((r) => [r.provider, r.count])),
    };
  },
});
