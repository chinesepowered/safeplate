"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { draft } from "./lib/llm";
import { APP_NAME } from "./lib/app";
import { rateLimiter, isRateLimitError, QUOTA_MESSAGE, assertNotPaused } from "./lib/limits";

/**
 * The email a careful parent would write, except it is written once and sent
 * consistently. The subject carries the restaurant's [SP-XXXX] code so the
 * reply routes straight back to this row (convex/mail.ts ingest).
 */

const SYSTEM =
  "You write a short, warm, easy-to-answer email from a parent to a restaurant " +
  "about a child's food allergy. Plain text, no markdown, no subject line, no " +
  "placeholders in square brackets. Four short paragraphs at most: who you are and " +
  "the allergy, the numbered questions exactly as given, a line saying a quick reply " +
  "in a sentence or two is plenty, and a thank you. Never sound legalistic or " +
  "demanding — restaurant staff are busy and a friendly note gets answered.";

export const send = internalAction({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) => {
    const row = await ctx.runQuery(internal.restaurants.internalGet, { restaurantId });
    if (!row?.restaurant || !row.profile) return;
    const { restaurant, profile } = row;
    if (!restaurant.contactEmail) return;

    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "userSend", { key: restaurant.ownerId, throws: true });
      await rateLimiter.limit(ctx, "globalSend", { throws: true });
    } catch (e) {
      await ctx.runMutation(internal.restaurants.patchRestaurant, {
        restaurantId,
        statusDetail: isRateLimitError(e) ? QUOTA_MESSAGE : String((e as Error).message ?? e),
      });
      return;
    }

    const questions = await ctx.runQuery(internal.restaurants.internalQuestions, {
      restaurantId,
    });
    const open = questions.filter((q) => !q.answer);
    const list = (open.length ? open : questions)
      .slice(0, 5)
      .map((q, i) => `${i + 1}. ${q.text}`)
      .join("\n");

    const subject = `Allergy question from a customer (${profile.allergens.join(", ")})`;

    let text: string;
    try {
      text = await draft(
        `Restaurant: ${restaurant.name}\n` +
          `Allergens: ${profile.allergens.join(", ")} (${profile.severity})\n` +
          `Who it is for: ${profile.personName}\n` +
          (profile.notes ? `Notes: ${profile.notes}\n` : "") +
          `\nQuestions to include, verbatim and numbered:\n${list}\n\n` +
          `Sign off as "A ${APP_NAME} user" with no phone number or address.`,
        { system: SYSTEM, maxTokens: 900 },
      );
      await ctx.runMutation(internal.usage.bump, { provider: "llm" });
    } catch {
      // The LLM is optional here — the questions are the point.
      text =
        `Hello,\n\nI'd like to bring my family to ${restaurant.name}, but ` +
        `${profile.personName} has a ${profile.severity} allergy to ` +
        `${profile.allergens.join(", ")}. The menu doesn't tell me everything I need ` +
        `to know, so I hope you don't mind a few quick questions:\n\n${list}\n\n` +
        `A sentence or two is plenty — thank you so much.\n\nA ${APP_NAME} user`;
    }

    // Every send is idempotent enough to retry: the thread is keyed by caseCode.
    try {
      const res = await ctx.runAction(internal.mailActions.send, {
        to: restaurant.contactEmail,
        subject,
        text,
        caseCode: restaurant.caseCode,
        targetId: restaurantId,
      });
      await ctx.runMutation(internal.restaurants.patchRestaurant, {
        restaurantId,
        status: "asked",
        askedAt: Date.now(),
        statusDetail: res.redirected
          ? "Sent (redirected to the demo inbox). Waiting for a reply."
          : "Sent. Waiting for the restaurant to reply.",
      });
    } catch (e) {
      const why = String((e as Error).message ?? e);
      const notConnected = /AGENTMAIL_API_KEY|Refusing to send/i.test(why);
      await ctx.runMutation(internal.mail.recordUnsent, {
        to: restaurant.contactEmail,
        subject: `[${restaurant.caseCode}] ${subject}`,
        text,
        caseCode: restaurant.caseCode,
        targetId: restaurantId,
        reason: notConnected ? "Email is not connected on this deployment yet." : why,
      });
      await ctx.runMutation(internal.restaurants.patchRestaurant, {
        restaurantId,
        statusDetail: notConnected
          ? "Email is not connected on this deployment yet — the drafted enquiry is in the thread below."
          : `Could not send: ${why}`,
      });
    }
  },
});
