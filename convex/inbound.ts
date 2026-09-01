"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { caseCodeFromSubject } from "./lib/mailUtil";

/**
 * Runs (scheduled, off the webhook path) for every inbound email once it has
 * been stored and routed. In SafePlate an inbound email is a restaurant
 * answering the questions we sent, so this is where a reply becomes state:
 * questions get answers with the sentence they came from, dishes get
 * re-verdicted, and the restaurant's pin changes colour.
 *
 * Node runtime, because the reply reader uses the LLM SDK.
 */
export const onInbound = internalAction({
  args: { mailMessageId: v.id("mailMessages") },
  handler: async (ctx, { mailMessageId }) => {
    const message = await ctx.runQuery(internal.mail.getMessage, { mailMessageId });
    if (!message || message.direction !== "in") return;

    // mail.ingest routes by thread and by an earlier message carrying the code.
    // A first reply that only has the code in its subject lands here unrouted,
    // so resolve it against the restaurant that owns that code.
    if (!message.targetId) {
      const code = message.caseCode ?? caseCodeFromSubject(message.subject);
      if (!code) return; // stays in the unrouted list; never silently dropped
      const restaurantId = await ctx.runQuery(internal.mail.restaurantByCaseCode, {
        caseCode: code,
      });
      if (!restaurantId) return;
      await ctx.runMutation(internal.mail.routeToTarget, {
        mailMessageId,
        targetId: restaurantId,
      });
    }

    await ctx.runAction(internal.ai.applyReply, { mailMessageId });
  },
});
