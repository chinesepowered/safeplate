"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { agentmail, sendMail } from "./lib/agentmail";
import { APP_SLUG } from "./lib/app";
import { assertNotPaused } from "./lib/limits";

/**
 * Node-runtime actions that talk to AgentMail. Kept apart from mail.ts because
 * the SDK needs Node APIs, and a "use node" file may only contain actions.
 */

/**
 * Create this app's single AgentMail inbox, once. Idempotent: an existing inbox
 * with our clientId is reused, so re-running never burns one of the three
 * inboxes the free tier allows.
 */
export const ensureInbox = internalAction({
  args: {},
  handler: async (ctx): Promise<{ inboxId: string; inboxAddress: string }> => {
    const existing = await ctx.runMutation(internal.mail.readSettings, {});
    if (existing) return existing;

    const clientId = `${APP_SLUG}-main`;
    const client = agentmail();

    const list: any = await client.inboxes.list();
    const inboxes = list?.inboxes ?? list?.data ?? [];
    let inbox: any = (Array.isArray(inboxes) ? inboxes : []).find(
      (i: any) => (i.clientId ?? i.client_id) === clientId,
    );
    if (!inbox) {
      inbox = await client.inboxes.create({ clientId, displayName: APP_SLUG });
    }

    const inboxId = String(inbox.inboxId ?? inbox.inbox_id ?? inbox.id);
    const inboxAddress = String(inbox.email ?? inbox.address ?? inboxId);
    await ctx.runMutation(internal.mail.saveSettings, { inboxId, inboxAddress });
    return { inboxId, inboxAddress };
  },
});

/**
 * Send one email and record it, so a reply can be routed back by thread id.
 * All product code sends through this action.
 */
export const send = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    html: v.optional(v.string()),
    caseCode: v.optional(v.string()),
    targetId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ messageId: string; redirected: boolean }> => {
    assertNotPaused();
    const settings = await ctx.runAction(internal.mailActions.ensureInbox, {});
    const res = await sendMail(settings.inboxId, {
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      caseCode: args.caseCode,
    });
    await ctx.runMutation(internal.mail.recordOutbound, {
      messageId: res.messageId,
      threadId: res.threadId || undefined,
      to: [args.to],
      subject: res.subject,
      text: args.text,
      caseCode: args.caseCode,
      targetId: args.targetId,
    });
    await ctx.runMutation(internal.usage.bump, { provider: "agentmail" });
    return { messageId: res.messageId, redirected: res.redirected };
  },
});
