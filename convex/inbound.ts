"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Product extension point: runs (scheduled, off the webhook path) for every
 * inbound email once it has been stored and routed. This is where the product
 * classifies the reply with the LLM and moves its own rows forward.
 *
 * Node runtime, because the LLM and Firecrawl helpers use Node SDKs.
 */
export const onInbound = internalAction({
  args: { mailMessageId: v.id("mailMessages") },
  handler: async (_ctx, _args) => {
    // Product-specific handling is added here.
  },
});
