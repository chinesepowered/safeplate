import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/** A dish or a whole restaurant, judged against one allergy profile. */
export const verdictV = v.union(
  v.literal("safe"),
  v.literal("risky"),
  v.literal("unsafe"),
  v.literal("unclear"),
);

/**
 * Where a restaurant is in the pipeline. "paused" is not a failure: it means we
 * declined to spend shared crawl credits on it, so there is nothing to show yet
 * and the parent can retry later. It never carries a verdict.
 */
export const statusV = v.union(
  v.literal("scraping"),
  v.literal("reviewed"),
  v.literal("asked"),
  v.literal("confirmed"),
  v.literal("avoid"),
  v.literal("unclear"),
  v.literal("failed"),
  v.literal("paused"),
);

/**
 * Shared chassis tables. Product tables are defined alongside these.
 */
export default defineSchema({
  ...authTables,

  /** Daily per-provider counters so free-tier burn is visible on /admin. */
  usage: defineTable({
    day: v.string(), // YYYY-MM-DD
    provider: v.string(), // firecrawl | agentmail | llm
    count: v.number(),
  }).index("by_day_provider", ["day", "provider"]),

  /** Singleton row: the app's one AgentMail inbox. */
  settings: defineTable({
    key: v.string(), // always "singleton"
    inboxId: v.string(),
    inboxAddress: v.string(),
  }).index("by_key", ["key"]),

  /**
   * Every email in or out. Inbound is routed to a case by, in order:
   * thread id, [CASE-CODE] in the subject, then a registered sender address.
   */
  mailMessages: defineTable({
    direction: v.union(v.literal("in"), v.literal("out")),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.array(v.string())),
    subject: v.string(),
    extractedText: v.optional(v.string()),
    fullText: v.optional(v.string()),
    caseCode: v.optional(v.string()),
    /** Product row this message belongs to, once routed. */
    targetId: v.optional(v.string()),
    routed: v.boolean(),
    classification: v.optional(v.string()),
    summary: v.optional(v.string()),
    deliveryStatus: v.optional(v.string()), // sent | delivered | bounced
    at: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_threadId", ["threadId"])
    .index("by_caseCode", ["caseCode"])
    .index("by_target", ["targetId"])
    .index("by_routed", ["routed"]),

  /** Sender address to product row, for "forward your email here" flows. */
  senderRoutes: defineTable({
    email: v.string(),
    targetId: v.string(),
    ownerId: v.optional(v.id("users")),
  }).index("by_email", ["email"]),

  // ---------------------------------------------------------------- product

  /**
   * One allergy profile — "Maya, peanut + tree nut, anaphylaxis". Everything
   * else hangs off a profile, so the same family can keep separate lists for
   * two children with different allergens.
   */
  profiles: defineTable({
    ownerId: v.id("users"),
    /** Unguessable slug for the read-only caregiver page at /s/:slug. */
    slug: v.string(),
    personName: v.string(),
    allergens: v.array(v.string()),
    severity: v.union(
      v.literal("anaphylaxis"),
      v.literal("severe"),
      v.literal("moderate"),
      v.literal("intolerance"),
    ),
    notes: v.optional(v.string()),
    /** Short code carried in email subjects so replies route back here. */
    caseCode: v.string(),
    city: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_slug", ["slug"])
    .index("by_caseCode", ["caseCode"]),

  /** A restaurant being assessed for one profile. */
  restaurants: defineTable({
    profileId: v.id("profiles"),
    ownerId: v.id("users"),
    name: v.string(),
    website: v.optional(v.string()),
    menuUrl: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    address: v.optional(v.string()),
    /** The page the menu text actually came from — shown in the UI as proof. */
    sourceUrl: v.optional(v.string()),
    menuExcerpt: v.optional(v.string()),
    status: statusV,
    verdict: v.optional(verdictV),
    verdictReason: v.optional(v.string()),
    /** Free-text progress line while the pipeline runs, or the failure reason. */
    statusDetail: v.optional(v.string()),
    lastScrapedAt: v.optional(v.number()),
    menuHash: v.optional(v.string()),
    menuChanged: v.optional(v.boolean()),
    /** Per-restaurant email code: one thread per restaurant. */
    caseCode: v.string(),
    threadId: v.optional(v.string()),
    askedAt: v.optional(v.number()),
    repliedAt: v.optional(v.number()),
    model: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_profile", ["profileId"])
    .index("by_profile_status", ["profileId", "status"])
    .index("by_owner", ["ownerId"])
    .index("by_caseCode", ["caseCode"]),

  /** One menu item, with the verdict and the evidence behind it. */
  dishes: defineTable({
    restaurantId: v.id("restaurants"),
    profileId: v.id("profiles"),
    name: v.string(),
    description: v.optional(v.string()),
    price: v.optional(v.string()),
    section: v.optional(v.string()),
    ingredients: v.optional(v.array(v.string())),
    verdict: verdictV,
    /** One line, always citing the ingredient or the reply sentence. */
    reason: v.string(),
    /** menu = read off the menu text; reply = confirmed by the restaurant. */
    evidence: v.union(v.literal("menu"), v.literal("reply")),
    updatedFromReply: v.boolean(),
    model: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_restaurant", ["restaurantId"])
    .index("by_restaurant_verdict", ["restaurantId", "verdict"]),

  /** What the menu could not answer, and what the restaurant said back. */
  questions: defineTable({
    restaurantId: v.id("restaurants"),
    profileId: v.id("profiles"),
    text: v.string(),
    answer: v.optional(v.string()),
    /** The sentence from the reply the answer came from, quoted in the UI. */
    quote: v.optional(v.string()),
    answeredBy: v.optional(v.union(v.literal("menu"), v.literal("reply"))),
    order: v.number(),
    answeredAt: v.optional(v.number()),
  }).index("by_restaurant", ["restaurantId"]),

  // ------------------------------------------------------- crawl budget guard

  /** Every Firecrawl result we have ever fetched, kept so a repeat costs nothing
   * and so the app still has a menu to show once the credit pool is reserved. */
  crawlCache: defineTable({
    key: v.string(),
    payload: v.string(),
    credits: v.number(),
    fetchedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Authoritative Firecrawl balance plus today's spend, in credits. */
  crawlBudget: defineTable({
    key: v.string(),
    remainingCredits: v.number(),
    checkedAt: v.number(),
    day: v.string(),
    spentToday: v.number(),
  }).index("by_key", ["key"]),
});
