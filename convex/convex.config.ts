import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import agent from "@convex-dev/agent/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

// The app owns HTTP routing (convex/http.ts): auth routes and the AgentMail
// webhook are exact routes; static hosting is registered as the catch-all.
const app = defineApp();
app.use(staticHosting);
app.use(agent);
app.use(rateLimiter);

export default app;
