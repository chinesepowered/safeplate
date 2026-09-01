import { RateLimiter, MINUTE, HOUR, DAY, isRateLimitError } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/**
 * The live URL is public and sign-in is anonymous, so anyone can trigger crawls
 * and emails. Every action that spends a sponsor credit is limited twice: once
 * per user, and once globally for the whole deployment, so a burst of traffic
 * during judging cannot exhaust the free tiers.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Per user
  createCase: { kind: "fixed window", rate: 3, period: DAY },
  userCrawl: { kind: "token bucket", rate: 10, period: HOUR, capacity: 5 },
  userSend: { kind: "token bucket", rate: 5, period: HOUR, capacity: 3 },
  userLlm: { kind: "token bucket", rate: 30, period: HOUR, capacity: 10 },

  // Global (key omitted)
  globalCrawl: { kind: "fixed window", rate: 150, period: DAY },
  globalSend: { kind: "fixed window", rate: 25, period: DAY },
  globalLlm: { kind: "fixed window", rate: 500, period: DAY },
  globalBurst: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 30 },
});

export { isRateLimitError };

/** Friendly message shown in the UI instead of a crash when a limit trips. */
export const QUOTA_MESSAGE =
  "Demo quota reached — this app runs on free tiers. Please try again later.";

/** Global kill switch: `convex env set APP_PAUSED 1` stops all spending. */
export function assertNotPaused() {
  if (process.env.APP_PAUSED === "1") {
    throw new Error("PAUSED: this demo is temporarily paused to protect free-tier quotas.");
  }
}
