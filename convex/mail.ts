import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { bareAddress, caseCodeFromSubject } from "./lib/mailUtil";

/**
 * Queries and mutations for email state. Runs in Convex's default runtime, so
 * this file must not import the AgentMail SDK — sending lives in mailActions.ts.
 */

/** Public: the address users are told to write to. */
export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    return row ? { inboxId: row.inboxId, inboxAddress: row.inboxAddress } : null;
  },
});

export const readSettings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    return row ? { inboxId: row.inboxId, inboxAddress: row.inboxAddress } : null;
  },
});

export const saveSettings = internalMutation({
  args: { inboxId: v.string(), inboxAddress: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (row) await ctx.db.patch(row._id, args);
    else await ctx.db.insert("settings", { key: "singleton", ...args });
  },
});

/** Record an email we sent, so replies can be routed back by thread. */
export const recordOutbound = internalMutation({
  args: {
    messageId: v.string(),
    threadId: v.optional(v.string()),
    to: v.array(v.string()),
    subject: v.string(),
    text: v.string(),
    caseCode: v.optional(v.string()),
    targetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("mailMessages", {
      direction: "out",
      messageId: args.messageId,
      threadId: args.threadId,
      to: args.to,
      subject: args.subject,
      fullText: args.text,
      caseCode: args.caseCode,
      targetId: args.targetId,
      routed: true,
      deliveryStatus: "sent",
      at: Date.now(),
    });
  },
});

/**
 * Store an inbound email and route it to a product row.
 * Called from the verified webhook in http.ts. Never does AI work: the product
 * classifier is scheduled from inbound.onInbound.
 */
export const ingest = internalMutation({
  args: {
    messageId: v.string(),
    threadId: v.string(),
    from: v.string(),
    to: v.array(v.string()),
    subject: v.string(),
    extractedText: v.string(),
    fullText: v.string(),
    receivedAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Idempotency: AgentMail retries webhooks.
    const dupe = await ctx.db
      .query("mailMessages")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .unique();
    if (dupe) return;

    // Route: thread, then subject code, then registered sender address.
    let targetId: string | undefined;
    let caseCode: string | undefined;

    const byThread = args.threadId
      ? await ctx.db
          .query("mailMessages")
          .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
          .first()
      : null;
    if (byThread?.targetId) {
      targetId = byThread.targetId;
      caseCode = byThread.caseCode;
    }

    if (!targetId) {
      const code = caseCodeFromSubject(args.subject);
      if (code) {
        caseCode = code;
        const byCode = await ctx.db
          .query("mailMessages")
          .withIndex("by_caseCode", (q) => q.eq("caseCode", code))
          .first();
        targetId = byCode?.targetId;
      }
    }

    if (!targetId) {
      const route = await ctx.db
        .query("senderRoutes")
        .withIndex("by_email", (q) => q.eq("email", bareAddress(args.from)))
        .unique();
      targetId = route?.targetId;
    }

    const id = await ctx.db.insert("mailMessages", {
      direction: "in",
      messageId: args.messageId,
      threadId: args.threadId || undefined,
      from: args.from,
      to: args.to,
      subject: args.subject,
      extractedText: args.extractedText,
      fullText: args.fullText,
      caseCode,
      targetId,
      routed: Boolean(targetId),
      at: args.receivedAt,
    });

    await ctx.scheduler.runAfter(0, internal.inbound.onInbound, { mailMessageId: id });
  },
});

export const deliveryStatus = internalMutation({
  args: { messageId: v.string(), status: v.string() },
  handler: async (ctx, { messageId, status }) => {
    const row = await ctx.db
      .query("mailMessages")
      .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
      .unique();
    if (row) await ctx.db.patch(row._id, { deliveryStatus: status });
  },
});

/** Messages that could not be routed. Surfaced on /admin, never dropped. */
export const unrouted = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("mailMessages")
      .withIndex("by_routed", (q) => q.eq("routed", false))
      .order("desc")
      .take(50),
});
