import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { bareAddress, caseCodeFromSubject, normalizeSubject, redactEmail } from "./lib/mailUtil";

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
        // A code can cover several enquiries — one profile writes to many
        // restaurants — so picking any message under it could attach a reply to
        // the wrong restaurant and re-verdict the wrong menu. Match the subject
        // of the enquiry we actually sent, and only fall back to the most recent.
        const candidates = await ctx.db
          .query("mailMessages")
          .withIndex("by_caseCode", (q) => q.eq("caseCode", code))
          .order("desc")
          .take(100);
        const outbound = candidates.filter((m) => m.direction === "out" && m.targetId);
        const subject = normalizeSubject(args.subject);
        const exact = outbound.find((m) => normalizeSubject(m.subject) === subject);
        targetId = (exact ?? outbound[0])?.targetId;
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
  handler: async (ctx) => {
    // Unrouted mail is whatever arrived at the app inbox that we could not
    // attach to a row — it can contain anything anyone chose to send us. The
    // live demo signs every visitor in anonymously, so being signed in proves
    // nothing; only an account with an email (real password sign-in, not the
    // anonymous provider) may read this, and bodies are truncated and sender
    // addresses redacted even then.
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    if (!user?.email) return [];

    const rows = await ctx.db
      .query("mailMessages")
      .withIndex("by_routed", (q) => q.eq("routed", false))
      .order("desc")
      .take(50);

    return rows.map((m) => ({
      _id: m._id,
      at: m.at,
      subject: m.subject,
      caseCode: m.caseCode,
      from: redactEmail(m.from),
      extractedText: (m.extractedText ?? "").slice(0, 200),
    }));
  },
});

/** One stored email, for the action that reads the reply. */
export const getMessage = internalQuery({
  args: { mailMessageId: v.id("mailMessages") },
  handler: async (ctx, { mailMessageId }) => await ctx.db.get(mailMessageId),
});

/** What the reply turned out to be, shown above the thread in the UI. */
export const setClassification = internalMutation({
  args: {
    mailMessageId: v.id("mailMessages"),
    classification: v.string(),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, { mailMessageId, classification, summary }) => {
    await ctx.db.patch(mailMessageId, { classification, summary });
  },
});

/** Attach an inbound message to a restaurant when routing found it by code. */
export const routeToTarget = internalMutation({
  args: { mailMessageId: v.id("mailMessages"), targetId: v.string() },
  handler: async (ctx, { mailMessageId, targetId }) => {
    await ctx.db.patch(mailMessageId, { targetId, routed: true });
  },
});

/** Restaurant lookup by the [SP-XXXX] code carried in a subject line. */
export const restaurantByCaseCode = internalQuery({
  args: { caseCode: v.string() },
  handler: async (ctx, { caseCode }) => {
    const r = await ctx.db
      .query("restaurants")
      .withIndex("by_caseCode", (q) => q.eq("caseCode", caseCode))
      .first();
    return r ? r._id : null;
  },
});

/**
 * Store an email we drafted but could not send (no AgentMail credentials yet,
 * or a send that failed). It shows in the thread as "not sent", so the work the
 * app did is still visible and nothing is silently lost.
 */
export const recordUnsent = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    caseCode: v.optional(v.string()),
    targetId: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("mailMessages", {
      direction: "out",
      messageId: `draft-${crypto.randomUUID()}`,
      to: [args.to],
      subject: args.subject,
      fullText: args.text,
      caseCode: args.caseCode,
      targetId: args.targetId,
      routed: true,
      deliveryStatus: "not_sent",
      summary: args.reason,
      at: Date.now(),
    });
  },
});
