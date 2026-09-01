import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

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
});
