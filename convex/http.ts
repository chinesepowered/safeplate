import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { auth } from "./auth";
import { components, internal } from "./_generated/api";
import { verifySvix } from "./lib/svix";

const http = httpRouter();

// Sign-in endpoints (/api/auth/*).
auth.addHttpRoutes(http);

/**
 * Inbound email from AgentMail. Verify, store, return 200 fast — all AI work is
 * scheduled from mail.ingest, never done inline, so AgentMail never waits on a
 * model and a slow LLM can never cause a webhook retry storm.
 */
http.route({
  path: "/api/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
    if (!secret) return new Response("webhook secret not configured", { status: 500 });

    const ok = await verifySvix(secret, body, {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    });
    if (!ok) return new Response("invalid signature", { status: 401 });

    let event: any;
    try {
      event = JSON.parse(body);
    } catch {
      return new Response("bad json", { status: 400 });
    }

    const type = event.event_type ?? event.type;
    const msg = event.message ?? event.data ?? {};

    if (type === "message.received") {
      await ctx.runMutation(internal.mail.ingest, {
        messageId: String(msg.message_id ?? msg.id ?? ""),
        threadId: String(msg.thread_id ?? ""),
        from: String(msg.from ?? ""),
        to: Array.isArray(msg.to) ? msg.to.map(String) : msg.to ? [String(msg.to)] : [],
        subject: String(msg.subject ?? ""),
        extractedText: String(msg.extracted_text ?? msg.text ?? ""),
        fullText: String(msg.text ?? msg.extracted_text ?? ""),
        receivedAt: Date.now(),
      });
    } else if (type === "message.delivered" || type === "message.bounced") {
      await ctx.runMutation(internal.mail.deliveryStatus, {
        messageId: String(msg.message_id ?? msg.id ?? ""),
        status: type === "message.bounced" ? "bounced" : "delivered",
      });
    }

    return new Response("ok", { status: 200 });
  }),
});

// The single-page app. Registered last: the exact routes above win, everything
// else falls through to the static site (with SPA fallback to index.html).
registerStaticRoutes(http, components.staticHosting);

export default http;
