import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { newCaseCode } from "./lib/mailUtil";
import { CASE_PREFIX } from "./lib/app";
import { verdictV, statusV } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/**
 * Restaurants are capped per profile so an anonymous visitor cannot burn the
 * Firecrawl budget by pasting fifty URLs.
 */
const MAX_RESTAURANTS_PER_PROFILE = 12;

async function ownedRestaurant(
  ctx: MutationCtx,
  restaurantId: Id<"restaurants">,
): Promise<Doc<"restaurants">> {
  const userId = await getAuthUserId(ctx);
  const r = await ctx.db.get(restaurantId);
  if (!r || r.ownerId !== userId) throw new Error("Not found");
  return r;
}

function hostLabel(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const base = h.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return url;
  }
}

// ------------------------------------------------------------------ queries

/** Live list for the dashboard, with the safe/risky/unsafe counts per pin. */
export const listForProfile = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    const userId = await getAuthUserId(ctx);
    const profile = await ctx.db.get(profileId);
    if (!profile || profile.ownerId !== userId) return [];

    const rows = await ctx.db
      .query("restaurants")
      .withIndex("by_profile", (q) => q.eq("profileId", profileId))
      .order("desc")
      .collect();

    return await Promise.all(
      rows.map(async (r) => {
        const dishes = await ctx.db
          .query("dishes")
          .withIndex("by_restaurant", (q) => q.eq("restaurantId", r._id))
          .collect();
        const counts = { safe: 0, risky: 0, unsafe: 0, unclear: 0 };
        for (const d of dishes) counts[d.verdict]++;
        const questions = await ctx.db
          .query("questions")
          .withIndex("by_restaurant", (q) => q.eq("restaurantId", r._id))
          .collect();
        return {
          ...r,
          counts,
          dishCount: dishes.length,
          openQuestions: questions.filter((q) => !q.answer).length,
          totalQuestions: questions.length,
        };
      }),
    );
  },
});

/** Everything the restaurant page renders, in one live subscription. */
export const detail = query({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) => {
    const userId = await getAuthUserId(ctx);
    const r = await ctx.db.get(restaurantId);
    if (!r || r.ownerId !== userId) return null;

    const dishes = await ctx.db
      .query("dishes")
      .withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
      .collect();
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
      .collect();
    const messages = await ctx.db
      .query("mailMessages")
      .withIndex("by_target", (q) => q.eq("targetId", restaurantId as string))
      .collect();
    const profile = await ctx.db.get(r.profileId);

    return {
      restaurant: r,
      profile,
      dishes: dishes.sort((a, b) => a.name.localeCompare(b.name)),
      questions: questions.sort((a, b) => a.order - b.order),
      messages: messages.sort((a, b) => a.at - b.at),
    };
  },
});

// ---------------------------------------------------------------- mutations

export const add = mutation({
  args: {
    profileId: v.id("profiles"),
    /** Either a website URL or a "name, city" search string. */
    input: v.string(),
  },
  handler: async (ctx, { profileId, input }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const profile = await ctx.db.get(profileId);
    if (!profile || profile.ownerId !== userId) throw new Error("Not found");

    const existing = await ctx.db
      .query("restaurants")
      .withIndex("by_profile", (q) => q.eq("profileId", profileId))
      .collect();
    if (existing.length >= MAX_RESTAURANTS_PER_PROFILE) {
      throw new Error(
        `This demo caps a profile at ${MAX_RESTAURANTS_PER_PROFILE} restaurants.`,
      );
    }

    const trimmed = input.trim();
    if (!trimmed) throw new Error("Enter a restaurant URL, or a name and city.");
    const isUrl = /^https?:\/\//i.test(trimmed);

    const id = await ctx.db.insert("restaurants", {
      profileId,
      ownerId: userId,
      name: isUrl ? hostLabel(trimmed) : trimmed,
      website: isUrl ? trimmed : undefined,
      status: "scraping",
      statusDetail: isUrl ? "Reading the site…" : "Searching for the restaurant…",
      caseCode: newCaseCode(CASE_PREFIX),
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.menu.discover, {
      restaurantId: id,
      query: isUrl ? undefined : trimmed,
      url: isUrl ? trimmed : undefined,
    });
    return id;
  },
});

export const addManualEmail = mutation({
  args: { restaurantId: v.id("restaurants"), email: v.string() },
  handler: async (ctx, { restaurantId, email }) => {
    await ownedRestaurant(ctx, restaurantId);
    const clean = email.trim().toLowerCase();
    if (clean && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      throw new Error("That does not look like an email address.");
    }
    await ctx.db.patch(restaurantId, { contactEmail: clean || undefined });
  },
});

/** "Ask the restaurant" — drafts and sends the inquiry off the request path. */
export const ask = mutation({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) => {
    const r = await ownedRestaurant(ctx, restaurantId);
    if (!r.contactEmail) throw new Error("Add an email address for the restaurant first.");
    await ctx.db.patch(restaurantId, { statusDetail: "Writing the questions…" });
    await ctx.scheduler.runAfter(0, internal.inquiry.send, { restaurantId });
  },
});

export const remove = mutation({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) => {
    await ownedRestaurant(ctx, restaurantId);
    for (const d of await ctx.db
      .query("dishes")
      .withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
      .collect()) {
      await ctx.db.delete(d._id);
    }
    for (const q of await ctx.db
      .query("questions")
      .withIndex("by_restaurant", (q2) => q2.eq("restaurantId", restaurantId))
      .collect()) {
      await ctx.db.delete(q._id);
    }
    await ctx.db.delete(restaurantId);
  },
});

/** Re-run the scrape and review by hand (the cron does this weekly). */
export const rescan = mutation({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) => {
    const r = await ownedRestaurant(ctx, restaurantId);
    await ctx.db.patch(restaurantId, {
      status: "scraping",
      statusDetail: "Re-reading the menu…",
      menuChanged: false,
    });
    await ctx.scheduler.runAfter(0, internal.menu.discover, {
      restaurantId,
      url: r.menuUrl ?? r.website,
    });
  },
});

export const dismissMenuChanged = mutation({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) => {
    await ownedRestaurant(ctx, restaurantId);
    await ctx.db.patch(restaurantId, { menuChanged: false });
  },
});

// --------------------------------------------- internal (node actions call these)

export const internalGet = internalQuery({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) => {
    const r = await ctx.db.get(restaurantId);
    if (!r) return null;
    const profile = await ctx.db.get(r.profileId);
    return { restaurant: r, profile };
  },
});

export const internalDishes = internalQuery({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) =>
    await ctx.db
      .query("dishes")
      .withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
      .collect(),
});

export const internalQuestions = internalQuery({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) =>
    await ctx.db
      .query("questions")
      .withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
      .collect(),
});

export const patchRestaurant = internalMutation({
  args: {
    restaurantId: v.id("restaurants"),
    name: v.optional(v.string()),
    website: v.optional(v.string()),
    menuUrl: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    address: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    menuExcerpt: v.optional(v.string()),
    menuHash: v.optional(v.string()),
    menuChanged: v.optional(v.boolean()),
    lastScrapedAt: v.optional(v.number()),
    status: v.optional(statusV),
    statusDetail: v.optional(v.string()),
    verdict: v.optional(verdictV),
    verdictReason: v.optional(v.string()),
    model: v.optional(v.string()),
    threadId: v.optional(v.string()),
    askedAt: v.optional(v.number()),
    repliedAt: v.optional(v.number()),
  },
  handler: async (ctx, { restaurantId, ...patch }) => {
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, x]) => x !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(restaurantId, clean);
  },
});

/**
 * Replace the dish list after a scrape. Every dish starts `unclear` — a line on
 * a menu is never on its own enough to call something safe.
 */
export const replaceDishes = internalMutation({
  args: {
    restaurantId: v.id("restaurants"),
    dishes: v.array(
      v.object({
        name: v.string(),
        description: v.optional(v.string()),
        price: v.optional(v.string()),
        section: v.optional(v.string()),
        ingredients: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (ctx, { restaurantId, dishes }) => {
    const r = await ctx.db.get(restaurantId);
    if (!r) return;
    for (const d of await ctx.db
      .query("dishes")
      .withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
      .collect()) {
      await ctx.db.delete(d._id);
    }
    for (const d of dishes) {
      await ctx.db.insert("dishes", {
        restaurantId,
        profileId: r.profileId,
        name: d.name,
        description: d.description,
        price: d.price,
        section: d.section,
        ingredients: d.ingredients,
        verdict: "unclear",
        reason: "Not reviewed yet.",
        evidence: "menu",
        updatedFromReply: false,
        updatedAt: Date.now(),
      });
    }
  },
});

/** Write the LLM per-dish verdicts and the questions a menu cannot answer. */
export const saveReview = internalMutation({
  args: {
    restaurantId: v.id("restaurants"),
    model: v.string(),
    verdicts: v.array(v.object({ name: v.string(), verdict: verdictV, reason: v.string() })),
    questions: v.optional(v.array(v.string())),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, { restaurantId, model, verdicts, questions, summary }) => {
    const dishes = await ctx.db
      .query("dishes")
      .withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
      .collect();
    const byName = new Map(dishes.map((d) => [d.name.toLowerCase().trim(), d]));

    for (const vd of verdicts) {
      const dish = byName.get(vd.name.toLowerCase().trim());
      if (!dish) continue;
      // A reply from the kitchen outranks anything read off a menu.
      if (dish.updatedFromReply) continue;
      // Conservative by design: the menu alone can never make a dish "safe".
      const downgraded = vd.verdict === "safe";
      await ctx.db.patch(dish._id, {
        verdict: downgraded ? "unclear" : vd.verdict,
        reason: downgraded
          ? `${vd.reason} Still needs the kitchen to confirm how it is prepared.`
          : vd.reason,
        evidence: "menu",
        model,
        updatedAt: Date.now(),
      });
    }

    if (questions) {
      const existing = await ctx.db
        .query("questions")
        .withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
        .collect();
      // Keep questions the restaurant already answered; refresh the rest.
      for (const q of existing) if (!q.answer) await ctx.db.delete(q._id);
      const answered = existing.filter((q) => q.answer);
      const keptTexts = new Set(answered.map((q) => q.text.toLowerCase()));
      const r = await ctx.db.get(restaurantId);
      if (r) {
        let order = answered.length;
        for (const text of questions.slice(0, 5)) {
          if (keptTexts.has(text.toLowerCase())) continue;
          await ctx.db.insert("questions", {
            restaurantId,
            profileId: r.profileId,
            text,
            order: order++,
          });
        }
      }
    }

    await ctx.db.patch(restaurantId, {
      status: "reviewed",
      model,
      statusDetail: "Reviewed against the menu. Questions ready to send.",
      verdict: "unclear",
      verdictReason:
        summary ??
        "Menu text alone cannot confirm how food is prepared — ask the kitchen.",
    });
  },
});

/** Restaurants the weekly cron should look at again. */
export const dueForRescan = internalQuery({
  args: { olderThan: v.number(), limit: v.number() },
  handler: async (ctx, { olderThan, limit }) => {
    const rows = await ctx.db.query("restaurants").order("desc").take(200);
    return rows
      .filter((r) => r.menuUrl && (r.lastScrapedAt ?? 0) < olderThan)
      .slice(0, limit)
      .map((r) => ({ _id: r._id, menuUrl: r.menuUrl as string }));
  },
});

// --------------------------------------------------- applying a restaurant reply

/** Cheap fuzzy match, so a paraphrased question still lands on the right row. */
function overlap(a: string, b: string): number {
  const norm = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const A = norm(a);
  const B = norm(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

/**
 * Turn one parsed reply into state: answered questions with the sentence the
 * kitchen actually wrote, re-verdicted dishes, and a restaurant-level verdict.
 * This is the only path that can mark anything "safe".
 */
export const applyReplyResult = internalMutation({
  args: {
    restaurantId: v.id("restaurants"),
    mailMessageId: v.id("mailMessages"),
    model: v.string(),
    classification: v.string(),
    summary: v.string(),
    answers: v.array(
      v.object({ question: v.string(), answer: v.string(), quote: v.string() }),
    ),
    dishUpdates: v.array(
      v.object({ name: v.string(), verdict: verdictV, reason: v.string() }),
    ),
    restaurantVerdict: v.union(
      v.literal("confirmed"),
      v.literal("avoid"),
      v.literal("unclear"),
    ),
    restaurantReason: v.string(),
  },
  handler: async (ctx, args) => {
    const restaurant = await ctx.db.get(args.restaurantId);
    if (!restaurant) return;

    await ctx.db.patch(args.mailMessageId, {
      classification: args.classification,
      summary: args.summary,
    });

    // An out-of-office tells us nothing; never let it move a verdict.
    if (args.classification === "auto_reply") {
      await ctx.db.patch(args.restaurantId, {
        statusDetail: "Automatic reply received — still waiting on a real answer.",
        repliedAt: Date.now(),
      });
      return;
    }

    // 1. Answers, matched onto the questions we asked.
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();
    const used = new Set<string>();
    let order = questions.length;

    for (const a of args.answers) {
      if (!a.answer?.trim()) continue;
      let best: (typeof questions)[number] | null = null;
      let bestScore = 0.34;
      for (const q of questions) {
        if (used.has(q._id)) continue;
        const s = overlap(a.question, q.text);
        if (s > bestScore) {
          bestScore = s;
          best = q;
        }
      }
      if (best) {
        used.add(best._id);
        await ctx.db.patch(best._id, {
          answer: a.answer.trim(),
          quote: a.quote?.trim() || undefined,
          answeredBy: "reply",
          answeredAt: Date.now(),
        });
      } else {
        // Never drop something the restaurant told us.
        await ctx.db.insert("questions", {
          restaurantId: args.restaurantId,
          profileId: restaurant.profileId,
          text: a.question.trim(),
          answer: a.answer.trim(),
          quote: a.quote?.trim() || undefined,
          answeredBy: "reply",
          order: order++,
          answeredAt: Date.now(),
        });
      }
    }

    // 2. Dish verdicts, now backed by the reply.
    const dishes = await ctx.db
      .query("dishes")
      .withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();
    const byName = new Map(dishes.map((d) => [d.name.toLowerCase().trim(), d]));
    let confirmedSafe = 0;

    for (const u of args.dishUpdates) {
      const key = u.name.toLowerCase().trim();
      let dish = byName.get(key);
      if (!dish) {
        const near = dishes.find((d) => overlap(d.name, u.name) >= 0.6);
        dish = near;
      }
      if (!dish) continue;
      await ctx.db.patch(dish._id, {
        verdict: u.verdict,
        reason: u.reason,
        evidence: "reply",
        updatedFromReply: true,
        model: args.model,
        updatedAt: Date.now(),
      });
      if (u.verdict === "safe") confirmedSafe++;
    }

    // 3. Restaurant verdict. "Confirmed" requires at least one dish the kitchen
    //    actually vouched for — a warm but vague reply stays amber.
    let status: "confirmed" | "avoid" | "unclear" = args.restaurantVerdict;
    if (status === "confirmed" && confirmedSafe === 0) status = "unclear";

    await ctx.db.patch(args.restaurantId, {
      status,
      verdict: status === "confirmed" ? "safe" : status === "avoid" ? "unsafe" : "unclear",
      verdictReason: args.restaurantReason,
      statusDetail:
        status === "confirmed"
          ? `Confirmed by the restaurant — ${confirmedSafe} dish${confirmedSafe === 1 ? "" : "es"} they say are safe.`
          : status === "avoid"
            ? "The restaurant says they cannot handle this allergy safely."
            : "They replied, but some questions are still open.",
      repliedAt: Date.now(),
      model: args.model,
    });
  },
});
