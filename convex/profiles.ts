import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { newCaseCode } from "./lib/mailUtil";
import { CASE_PREFIX } from "./lib/app";
import { rateLimiter, isRateLimitError, QUOTA_MESSAGE } from "./lib/limits";

/** Long unguessable slug for the public caregiver page. */
function newSlug(name: string): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "list";
  return `${base}-${s}`;
}

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
  },
});

export const get = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    const userId = await getAuthUserId(ctx);
    const p = await ctx.db.get(profileId);
    if (!p || p.ownerId !== userId) return null;
    return p;
  },
});

export const create = mutation({
  args: {
    personName: v.string(),
    allergens: v.array(v.string()),
    severity: v.union(
      v.literal("anaphylaxis"),
      v.literal("severe"),
      v.literal("moderate"),
      v.literal("intolerance"),
    ),
    notes: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");

    // Anonymous sign-in is public, so cap how many profiles one user can make.
    try {
      await rateLimiter.limit(ctx, "createCase", { key: userId, throws: true });
    } catch (e) {
      if (isRateLimitError(e)) throw new Error(QUOTA_MESSAGE);
      throw e;
    }

    const name = args.personName.trim() || "My family";
    return await ctx.db.insert("profiles", {
      ownerId: userId,
      slug: newSlug(name),
      personName: name,
      allergens: args.allergens.map((a) => a.trim()).filter(Boolean),
      severity: args.severity,
      notes: args.notes?.trim() || undefined,
      city: args.city?.trim() || undefined,
      caseCode: newCaseCode(CASE_PREFIX),
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    profileId: v.id("profiles"),
    allergens: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: async (ctx, { profileId, ...patch }) => {
    const userId = await getAuthUserId(ctx);
    const p = await ctx.db.get(profileId);
    if (!p || p.ownerId !== userId) throw new Error("Not found");
    await ctx.db.patch(profileId, {
      ...(patch.allergens ? { allergens: patch.allergens.filter(Boolean) } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes || undefined } : {}),
      ...(patch.city !== undefined ? { city: patch.city || undefined } : {}),
    });
  },
});

/**
 * Public, unauthenticated read path for grandparents and babysitters.
 * Keyed by an unguessable slug, and deliberately narrow: only restaurants the
 * kitchen has confirmed by email, and only the dishes confirmed safe.
 */
export const publicSafeList = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!profile) return null;

    const restaurants = await ctx.db
      .query("restaurants")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .collect();

    const confirmed = restaurants.filter((r) => r.status === "confirmed");
    const entries = [];
    for (const r of confirmed) {
      const dishes = await ctx.db
        .query("dishes")
        .withIndex("by_restaurant_verdict", (q) =>
          q.eq("restaurantId", r._id).eq("verdict", "safe"),
        )
        .collect();
      // Belt and braces: a dish is only shown here if the kitchen confirmed it.
      const reply = dishes.filter((d) => d.evidence === "reply");
      if (reply.length === 0) continue;
      entries.push({
        name: r.name,
        address: r.address,
        website: r.website,
        menuUrl: r.menuUrl,
        verdictReason: r.verdictReason,
        confirmedAt: r.repliedAt,
        dishes: reply.map((d) => ({ name: d.name, reason: d.reason, price: d.price })),
      });
    }

    return {
      personName: profile.personName,
      allergens: profile.allergens,
      severity: profile.severity,
      notes: profile.notes,
      entries,
    };
  },
});

/** Used by the seed and by internal actions that already know the owner. */
export const insertSeedProfile = internalMutation({
  args: {
    ownerId: v.id("users"),
    personName: v.string(),
    allergens: v.array(v.string()),
    severity: v.union(
      v.literal("anaphylaxis"),
      v.literal("severe"),
      v.literal("moderate"),
      v.literal("intolerance"),
    ),
    notes: v.optional(v.string()),
    city: v.optional(v.string()),
    slug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("profiles", {
      ownerId: args.ownerId,
      slug: args.slug ?? newSlug(args.personName),
      personName: args.personName,
      allergens: args.allergens,
      severity: args.severity,
      notes: args.notes,
      city: args.city,
      caseCode: newCaseCode(CASE_PREFIX),
      createdAt: Date.now(),
    });
  },
});
