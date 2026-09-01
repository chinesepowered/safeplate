"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { z } from "zod";
import { extract, modelId } from "./lib/llm";
import { rateLimiter, isRateLimitError, QUOTA_MESSAGE, assertNotPaused } from "./lib/limits";

/**
 * The judgement layer. Two jobs, and both are deliberately pessimistic:
 *
 *  - reviewMenu: read the scraped dishes against the allergy profile. A menu
 *    line can prove a dish is dangerous ("satay, peanut sauce") but it can
 *    never prove one is safe, because it says nothing about the fryer, the
 *    prep surface or the supplier. So the menu pass only ever produces
 *    unsafe / risky / unclear, plus the questions that would settle it.
 *  - applyReply: read what the kitchen actually wrote back. This is the only
 *    thing in the app allowed to mark a dish "safe", and only when the reply
 *    says so in words we can quote.
 */

const CHUNK = 20;

const VerdictEnum = z.enum(["safe", "risky", "unsafe", "unclear"]);

const ReviewChunk = z.object({
  verdicts: z.array(
    z.object({
      name: z.string(),
      verdict: VerdictEnum,
      reason: z.string(),
    }),
  ),
});

const QuestionSet = z.object({
  questions: z.array(z.string()).max(5),
  summary: z.string(),
});

function profileLine(profile: {
  personName: string;
  allergens: string[];
  severity: string;
  notes?: string;
}) {
  return (
    `Person: ${profile.personName}. Allergens to avoid: ${profile.allergens.join(", ")}. ` +
    `Severity: ${profile.severity}.` +
    (profile.notes ? ` Extra notes from the family: ${profile.notes}` : "")
  );
}

const REVIEW_SYSTEM =
  "You help a parent whose child has a life-threatening food allergy decide what is " +
  "safe to order. You are cautious to a fault.\n" +
  "Rules you must not break:\n" +
  "- 'unsafe': the dish names, or plainly contains, one of the allergens.\n" +
  "- 'risky': the dish very likely involves the allergen (typical recipe, sauce, " +
  "garnish, shared fryer) even though the menu does not spell it out.\n" +
  "- 'unclear': the menu text simply does not say enough. This is the correct answer " +
  "most of the time and you should use it freely.\n" +
  "- Never answer 'safe'. A menu line cannot prove how a kitchen prepares food. " +
  "Only a written reply from the restaurant can do that.\n" +
  "- The reason is ONE short sentence and must quote the exact word or phrase from the " +
  "dish text that drove the verdict, or say plainly that the menu does not mention " +
  "preparation. Never invent an ingredient that is not written down.";

export const reviewMenu = internalAction({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) => {
    const row = await ctx.runQuery(internal.restaurants.internalGet, { restaurantId });
    if (!row?.restaurant || !row.profile) return;
    const { restaurant, profile } = row;

    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "globalBurst", { throws: true });
      await rateLimiter.limit(ctx, "userLlm", { key: restaurant.ownerId, throws: true });
      await rateLimiter.limit(ctx, "globalLlm", { throws: true });
    } catch (e) {
      await ctx.runMutation(internal.restaurants.patchRestaurant, {
        restaurantId,
        status: "failed",
        statusDetail: isRateLimitError(e) ? QUOTA_MESSAGE : String((e as Error).message ?? e),
      });
      return;
    }

    const dishes = await ctx.runQuery(internal.restaurants.internalDishes, { restaurantId });
    if (!dishes.length) return;

    const who = profileLine(profile);
    const all: { name: string; verdict: z.infer<typeof VerdictEnum>; reason: string }[] = [];

    try {
      for (let i = 0; i < dishes.length; i += CHUNK) {
        const chunk = dishes.slice(i, i + CHUNK);
        const list = chunk
          .map(
            (d) =>
              `- ${d.name}${d.description ? `: ${d.description}` : ""}` +
              (d.ingredients?.length ? ` [listed ingredients: ${d.ingredients.join(", ")}]` : ""),
          )
          .join("\n");
        const out = await extract(
          ReviewChunk,
          `${who}\n\nRestaurant: ${restaurant.name}\n\nDishes from the menu:\n${list}\n\n` +
            `Return one verdict per dish, using the dish name exactly as given above.`,
          { system: REVIEW_SYSTEM, maxTokens: 3000 },
        );
        await ctx.runMutation(internal.usage.bump, { provider: "llm" });
        all.push(...out.verdicts);
      }

      // The questions a careful parent would ask on the phone.
      const risky = all
        .filter((v2) => v2.verdict !== "unsafe")
        .slice(0, 25)
        .map((v2) => v2.name)
        .join(", ");
      const qs = await extract(
        QuestionSet,
        `${who}\n\nRestaurant: ${restaurant.name}\n\nDishes that might be workable: ${risky}\n\n` +
          `Write at most 5 short questions to email this restaurant — the questions a menu ` +
          `can never answer. Cover shared fryers and equipment, whether specific dishes ` +
          `contain the allergen, supplier or "may contain" labelling, and whether the kitchen ` +
          `can prepare a meal safely. Name specific dishes where it helps. Also write one ` +
          `sentence summarising where this restaurant stands right now.`,
        { system: REVIEW_SYSTEM, maxTokens: 1200 },
      );
      await ctx.runMutation(internal.usage.bump, { provider: "llm" });

      await ctx.runMutation(internal.restaurants.saveReview, {
        restaurantId,
        model: modelId(),
        verdicts: all,
        questions: qs.questions.filter((q) => q.trim()),
        summary: qs.summary,
      });
    } catch (e) {
      await ctx.runMutation(internal.restaurants.patchRestaurant, {
        restaurantId,
        status: "failed",
        statusDetail: isRateLimitError(e)
          ? QUOTA_MESSAGE
          : `Could not review that menu: ${String((e as Error).message ?? e)}`,
      });
    }
  },
});

// ---------------------------------------------------------------- the reply

const ReplyRead = z.object({
  classification: z.enum(["answered", "partial", "declined", "auto_reply", "other"]),
  /** One-line summary shown above the thread. */
  summary: z.string(),
  answers: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      /** Verbatim sentence from the reply. Shown to the parent as evidence. */
      quote: z.string(),
    }),
  ),
  dishUpdates: z.array(
    z.object({
      name: z.string(),
      verdict: VerdictEnum,
      reason: z.string(),
    }),
  ),
  restaurantVerdict: z.enum(["confirmed", "avoid", "unclear"]),
  restaurantReason: z.string(),
});

const REPLY_SYSTEM =
  "You are reading a restaurant's emailed reply to an allergy enquiry on behalf of a " +
  "parent whose child could go into anaphylaxis.\n" +
  "Rules you must not break:\n" +
  "- Only mark a dish 'safe' if this reply says, in words you can quote, that the dish " +
  "is free of the allergen AND that it is prepared without cross-contact. Otherwise use " +
  "'risky' or 'unclear'.\n" +
  "- Mark a dish 'unsafe' if the reply says it contains the allergen.\n" +
  "- Every reason must quote or closely paraphrase the sentence from the reply that " +
  "supports it. Never use knowledge from outside this email.\n" +
  "- 'quote' must be copied verbatim from the reply. If there is no sentence that " +
  "answers a question, leave that question out entirely.\n" +
  "- restaurantVerdict is 'confirmed' only when the reply gives at least one dish that " +
  "is genuinely safe to order; 'avoid' when the kitchen says it cannot accommodate the " +
  "allergy; otherwise 'unclear'.\n" +
  "- An out-of-office or automated acknowledgement is 'auto_reply' and changes nothing.";

export const applyReply = internalAction({
  args: { mailMessageId: v.id("mailMessages") },
  handler: async (ctx, { mailMessageId }) => {
    const message = await ctx.runQuery(internal.mail.getMessage, { mailMessageId });
    if (!message || message.direction !== "in" || !message.targetId) return;

    const restaurantId = message.targetId as any;
    const row = await ctx.runQuery(internal.restaurants.internalGet, { restaurantId });
    if (!row?.restaurant || !row.profile) return;
    const { restaurant, profile } = row;

    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "globalLlm", { throws: true });
    } catch (e) {
      await ctx.runMutation(internal.mail.setClassification, {
        mailMessageId,
        classification: "other",
        summary: isRateLimitError(e) ? QUOTA_MESSAGE : "Could not read this reply.",
      });
      return;
    }

    const questions = await ctx.runQuery(internal.restaurants.internalQuestions, {
      restaurantId,
    });
    const dishes = await ctx.runQuery(internal.restaurants.internalDishes, { restaurantId });

    const body = (message.fullText || message.extractedText || "").slice(0, 12000);
    if (!body.trim()) return;

    try {
      const out = await extract(
        ReplyRead,
        `${profileLine(profile)}\n\nRestaurant: ${restaurant.name}\n\n` +
          `Questions we asked:\n${questions.map((q) => `- ${q.text}`).join("\n") || "- (none recorded)"}\n\n` +
          `Dishes on their menu:\n${dishes
            .slice(0, 60)
            .map((d) => `- ${d.name}${d.description ? `: ${d.description}` : ""}`)
            .join("\n")}\n\n` +
          `Their reply:\n"""\n${body}\n"""\n\n` +
          `Match their reply to our questions, update the dishes it speaks to, and give ` +
          `an overall verdict. Use dish names exactly as listed above.`,
        { system: REPLY_SYSTEM, maxTokens: 3000 },
      );
      await ctx.runMutation(internal.usage.bump, { provider: "llm" });

      await ctx.runMutation(internal.restaurants.applyReplyResult, {
        restaurantId,
        mailMessageId,
        model: modelId(),
        classification: out.classification,
        summary: out.summary,
        answers: out.answers,
        dishUpdates: out.dishUpdates,
        restaurantVerdict: out.restaurantVerdict,
        restaurantReason: out.restaurantReason,
      });
    } catch (e) {
      await ctx.runMutation(internal.mail.setClassification, {
        mailMessageId,
        classification: "other",
        summary: `Could not read this reply automatically: ${String((e as Error).message ?? e)}`,
      });
    }
  },
});
