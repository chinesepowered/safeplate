/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as inbound from "../inbound.js";
import type * as lib_agentmail from "../lib/agentmail.js";
import type * as lib_app from "../lib/app.js";
import type * as lib_firecrawl from "../lib/firecrawl.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_llm from "../lib/llm.js";
import type * as lib_mailUtil from "../lib/mailUtil.js";
import type * as lib_svix from "../lib/svix.js";
import type * as mail from "../mail.js";
import type * as mailActions from "../mailActions.js";
import type * as staticHosting from "../staticHosting.js";
import type * as usage from "../usage.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  http: typeof http;
  inbound: typeof inbound;
  "lib/agentmail": typeof lib_agentmail;
  "lib/app": typeof lib_app;
  "lib/firecrawl": typeof lib_firecrawl;
  "lib/limits": typeof lib_limits;
  "lib/llm": typeof lib_llm;
  "lib/mailUtil": typeof lib_mailUtil;
  "lib/svix": typeof lib_svix;
  mail: typeof mail;
  mailActions: typeof mailActions;
  staticHosting: typeof staticHosting;
  usage: typeof usage;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
