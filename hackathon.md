# Hackathon log

- **Project:** SafePlate
- **Event:** Convex All Gas Hackathon
- **What it does:** Reads a restaurant's real menu against a child's allergy profile, emails the kitchen the questions a menu cannot answer, and turns the reply into per-dish verdicts and a shareable safe list.
- **Live app:** https://valiant-fox-223.convex.site
- **Repo:** none
- **Frontend:** Convex static hosting
- **Convex deployment:** https://valiant-fox-223.convex.cloud
- **Components:** @convex-dev/static-hosting, @convex-dev/rate-limiter, @convex-dev/agent
- **Convex features:** schema, tables, indexes, queries, mutations, actions, HTTP actions, scheduled functions, crons, realtime queries, optimistic updates
- **Auth:** Convex Auth
- **AI models:** not recorded in the repo; the model id is set per deployment via `LLM_MODEL` and calls go to an OpenAI-compatible endpoint through `convex/lib/llm.ts`
- **Started:** 2026-09-01T19:17:21Z
- **Last updated:** 2026-09-08T18:34:09Z

## Log

### 2026-09-01 - c315df0
Set up the SafePlate chassis on Convex: schema with auth tables plus `usage`,
`settings`, `mailMessages` and `senderRoutes`; Convex Auth with anonymous and
password providers; an HTTP router carrying the auth routes, a signed AgentMail
webhook and static hosting as the catch-all. Registered `@convex-dev/static-hosting`,
`@convex-dev/rate-limiter` and `@convex-dev/agent`. Svix signature verification
reimplemented on Web Crypto so it runs in the default runtime. Convex features:
schema, indexes, queries, mutations, actions, HTTP actions, registered components,
Convex Auth (`convex/schema.ts`, `convex/http.ts`, `convex/auth.ts`,
`convex/convex.config.ts`, `convex/lib/svix.ts`).

### 2026-09-01 - e750a8c
Shipped the product model and the whole pipeline. Added `profiles`,
`restaurants`, `dishes` and `questions` with indexes by profile, restaurant,
verdict, slug and case code. `menu.discover` runs the Firecrawl search → map →
scrape chain and writes dish rows; `ai.reviewMenu` judges them against the
profile and generates the questions a menu cannot answer; `ai.applyReply` reads
an emailed reply back into answers and dish updates. The safety rule landed here:
dishes are inserted `unclear`, and `restaurants.saveReview` downgrades any model
verdict of `safe`. Added the weekly re-scan cron and seed data. Convex features:
schema, indexes, queries, mutations, actions, scheduled functions, crons
(`convex/menu.ts`, `convex/ai.ts`, `convex/restaurants.ts`, `convex/profiles.ts`,
`convex/crons.ts`, `convex/seed.ts`).

### 2026-09-01 - 812252c
Real menu pages are messy, so extraction now coerces what is usable and drops
bad rows instead of throwing a whole menu away, with an LLM markdown fallback
when structured extraction comes back empty. Added a seed helper that runs the
live pipeline against a real restaurant (`convex/menu.ts`, `convex/seed.ts`).

### 2026-09-01 - 5d62401
Fixed reply routing: one case code can cover several enquiries, so an inbound
message is now matched against the normalised subject of the enquiry actually
sent, and the thread id is stored on the restaurant so later replies route with
no subject matching at all. Also landed the first frontend — dashboard, verdict
map on Leaflet, shared verdict vocabulary and a small router
(`convex/mail.ts`, `convex/lib/mailUtil.ts`, `convex/inquiry.ts`,
`src/Dashboard.tsx`, `src/Map.tsx`, `src/ui.tsx`, `src/router.tsx`).

### 2026-09-01 - 3b6bbfc
Built out the rest of the UI: the restaurant page with dish-by-dish verdicts,
each showing its reason and whether the source was the menu or the reply; the
questions panel with the restaurant's verbatim sentence quoted under each
answer; and the public caregiver safe list at `/s/:slug`, deliberately routed
outside the auth wrapper so a grandparent is never asked to sign in. Convex
features: realtime queries, public unauthenticated query (`src/Restaurant.tsx`,
`src/SafeList.tsx`, `src/App.tsx`).

### 2026-09-01 - 9c5e13f
Extractors write "Not provided" rather than omitting a field, and that string
was reaching restaurant cards as an address. Placeholder addresses and malformed
emails are now discarded, and copying the demo family skips rows still mid-pipeline
so a copy never sits on a spinner forever (`convex/menu.ts`, `convex/seed.ts`).

### 2026-09-01 - e20056b
Security fix. The live demo signs every visitor in anonymously, so being signed
in proved nothing, yet the unrouted-mail view was readable by anyone. It now
requires an account with an email address, truncates bodies and redacts sender
addresses even then (`convex/mail.ts`).

### 2026-09-07 - 888f9f5
Firecrawl bills in credits while a rate limiter counts calls, so added a
credit-denominated cache and spend guard: a `crawlCache` table storing every
result we have ever fetched, a `crawlBudget` singleton holding the authoritative
remaining balance, and one gateway every Firecrawl call goes through. It serves
a stored copy first, then checks the balance against Firecrawl's own free
credit-usage endpoint and a daily ceiling before spending. A repeat costs
nothing and the pool cannot be drained. Convex features: indexes, internal
queries and mutations (`convex/crawlCache.ts`, `convex/lib/firecrawl.ts`,
`convex/schema.ts`).

### 2026-09-07 - 4c15bc6
A refusal to spend must never look like an all-clear. A budget refusal now lands
the restaurant in a retryable `paused` status carrying no verdict, and a re-scan
that is declined puts the row back exactly as it was rather than dropping a
confirmed restaurant off the caregiver's safe list. The UI says so out loud:
a public boolean query drives a "showing saved menu data" note, and a paused
restaurant gets a Try again button (`convex/menu.ts`, `convex/restaurants.ts`,
`convex/crawlCache.ts`, `src/ui.tsx`, `src/Dashboard.tsx`, `src/Restaurant.tsx`).

### 2026-09-07 - 70a4249
Corrected the per-call credit cost estimates the guard budgets with, and read
the cache TTL per call instead of freezing it at module load, so changing the
env var takes effect without a redeploy (`convex/lib/firecrawl.ts`).

### 2026-09-08 - working tree
Captured seven demo screenshots of the shipped flow into `public/demo/` and
wrote the judge-facing `README.md` alongside this log. Verified while writing:
`pnpm run build` passes, every cited function and file path exists, and
`@convex-dev/agent` is registered in `convex/convex.config.ts` but not used by
any product path — the README says so rather than claiming it. Also corrected a
stale code comment in `convex/crawlCache.ts` that described a JSON-extraction
scrape as costing ten times a plain scrape when the constants in
`convex/lib/firecrawl.ts` budget it at five.
