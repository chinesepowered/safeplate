"use node";

import { AgentMailClient } from "agentmail";

/**
 * The ONLY module that talks to AgentMail. Uses the Node SDK, so it may only be
 * imported from Convex action files carrying the "use node" directive.
 *
 * Inbox model: the free tier allows 3 inboxes per account and three of our apps
 * share an account, so this app creates EXACTLY ONE inbox. Per-case addressing
 * uses a short caseCode carried in the subject (plus thread ids and sender
 * addresses) to route replies back to the right row.
 */
export function agentmail() {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) throw new Error("AGENTMAIL_API_KEY not set on this deployment");
  return new AgentMailClient({ apiKey });
}

export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  caseCode?: string;
};

/**
 * Every outbound email in this app goes through here.
 *
 * DEMO SAFETY: while DEMO_RECIPIENT_OVERRIDE is set, mail is redirected to that
 * address and the real recipient is shown in the subject. This is how we
 * develop and film the demo — we never email real businesses from a dev box.
 * The override is removed only on production, deliberately.
 */
export async function sendMail(inboxId: string, mail: OutboundMail) {
  const override = process.env.DEMO_RECIPIENT_OVERRIDE;

  // Fail closed. Without an override address, mail would go to whatever real
  // shelter/company/contractor the product looked up, so real sending must be
  // turned on deliberately and only on production.
  if (!override && process.env.ALLOW_REAL_SENDS !== "1") {
    throw new Error(
      "Refusing to send: set DEMO_RECIPIENT_OVERRIDE to redirect mail during " +
        "development, or ALLOW_REAL_SENDS=1 to email real recipients.",
    );
  }

  const withCode = mail.caseCode ? `[${mail.caseCode}] ${mail.subject}` : mail.subject;
  const to = override || mail.to;
  const subject = override ? `[to: ${mail.to}] ${withCode}` : withCode;

  const res: any = await agentmail().inboxes.messages.send(inboxId, {
    to,
    subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
  });
  return {
    messageId: String(res.messageId ?? res.message_id ?? ""),
    threadId: String(res.threadId ?? res.thread_id ?? ""),
    redirected: Boolean(override),
    actualTo: to,
    subject,
  };
}

/** Reply inside an existing thread, keeping the conversation intact. */
export async function replyMail(
  inboxId: string,
  messageId: string,
  text: string,
  html?: string,
) {
  const res: any = await agentmail().inboxes.messages.reply(inboxId, messageId, {
    text,
    ...(html ? { html } : {}),
  });
  return {
    messageId: String(res.messageId ?? res.message_id ?? ""),
    threadId: String(res.threadId ?? res.thread_id ?? ""),
  };
}
