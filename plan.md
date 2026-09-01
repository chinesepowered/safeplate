# SafePlate — Convex All Gas Hackathon build plan

> **One line:** For serious food allergies: scrapes real menus, flags dishes against your profile, emails the restaurant the right questions, and turns replies into confirmed-safe lists on a map.
>
> **Repo:** `hack-gas5` · **AgentMail account:** B · **Event:** Convex All Gas Hackathon · **Deadline:** September 22, 2026, 12:00 PM PT · **Stack:** Convex (backend + static hosting on `*.convex.site`), React + Vite + Tailwind, any OpenAI-compatible LLM endpoint (env-configured; described as "OpenAI" in judge-facing docs), Firecrawl, AgentMail.
>
> This file is self-contained. A coding agent should be able to execute it top to bottom with no other context. Sections 0–2 and 4–9 are shared scaffolding common to our hackathon entries; section 3 is this product. Deliverables at the end: the working app on a live URL, `hackathon.md`, a judge-facing `README.md`, and a 4-slide `slides.html` pitch deck (§9).

## 0. Ground rules for the coding agent

Read this whole file before doing anything. It is the only spec you have.

- **Package manager:** `pnpm` only. Never pin versions — `pnpm add <pkg>` installs the latest published version, which is what we want. Do not web-search for version numbers. Use `pnpm dlx` instead of `npx`.
- **Scope everything to this repo.** The Convex plugin is installed with `--scope project` (it lands in `./.claude/settings.json`); skills go in `./.claude/skills/`. Do not install anything at user scope; this machine is used for many non-Convex projects.
- **Every third-party call is server-side.** The browser talks only to Convex (queries/mutations/actions via the Convex client). LLM, Firecrawl and AgentMail are called exclusively from Convex actions / HTTP actions, using env vars set on the Convex deployment. **Never prefix a secret with `VITE_`, never import `firecrawl`, `agentmail`, `openai`/`ai` provider modules from `src/`, never ship a key in the bundle.** Before the production deploy, grep `dist/` for `sk-`, `fc-`, and the key names to prove nothing leaked.
- **Secrets never touch git.** Keys live only in Convex deployment env vars (`pnpm dlx convex env set ...`) and in gitignored `.env.local`. Never print a key, never write one into `hackathon.md`, `plan.md`, or any committed file. Commit a `.env.example` with names only.
- **Ask the human only for:** account logins (`convex login`, dashboards), API keys / base URLs, and anything that requires a GUI. Everything else you run and verify yourself.
- **Verify, don't assume.** A successful install/exit code is not proof. After each step, check the artifact (file exists, function appears in the dashboard, curl returns 200, row appears in the table, etc.).
- **For Convex API details (auth setup, Agent component, schema, http actions, crons, file storage) defer to the installed Convex plugin's skills and MCP server** rather than memory. They are current; your training data may not be. For Firecrawl and AgentMail read `https://docs.firecrawl.dev/llms.txt` and `https://www.agentmail.to/docs/llms.txt` (and the pages they link) when you need exact request/response shapes. Do not guess field names.
- **Do not submit, publish social posts, or push to GitHub** unless the human asks. Deploying to `convex.site` *is* in scope when the human asks you to execute this plan.
- **Commit as you go**, in meaningful chunks with descriptive messages — the hackathon build log is generated from git history and judges read it. Never add a co-author trailer.

## 1. What the judges score (design around this)

From the official hackathon page (no weights given; all of them matter):

1. **Everyday app, not a developer tool.** Something a real person would use this week.
2. **Creativity and usefulness.** Copycats score low.
3. **Convex depth.** "Real use of queries, mutations, live updates, auth, and components. A thin frontend on a hosted page does not count."
4. **Sponsor stack does real work.** The LLM generates, Firecrawl crawls, AgentMail sends/receives — inside the product, not in the README.
5. **Live URL** on `convex.site` (we use the official static-hosting component). No localhost.
6. **Social proof:** a post on X or LinkedIn. Engagement counts.
7. **Video under 3 minutes.** "Talk less, click through the real product."

Implication for every decision: prefer the option that makes data *visibly change live on screen*, and keep each sponsor tool on the critical path of the core loop.

## 2. Environment setup (do this first, in order)

### 2.1 Repo hygiene
```bash
git init   # skip if already a repo
```
`.gitignore` must cover: `node_modules`, `dist`, `.env`, `.env.*`, `!.env.example`, `.convex/`, `*.log`, `.DS_Store`.

### 2.2 Convex plugin for Claude Code — project scope
```bash
claude plugin install convex@claude-plugins-official --scope project
claude plugin list
```
Verify `./.claude/settings.json` now contains `enabledPlugins` with the convex plugin and that `claude plugin list` shows it. The plugin bundles Convex skills, the Convex MCP server, and hooks (pre-commit typecheck, end-of-turn verify). If the MCP server / skills are not active in the current session, run `/reload-plugins`; if that is unavailable, tell the human a restart is needed and continue using the docs directly for now — but do not report the plugin as active until it is.

### 2.3 Hackathon build-log skill (two files, project-local)
```bash
mkdir -p .claude/skills/convex-hackathon-skill/references
curl -fsSL https://raw.githubusercontent.com/get-convex/convex-hackathon-skill/main/SKILL.md \
  -o .claude/skills/convex-hackathon-skill/SKILL.md
curl -fsSL https://raw.githubusercontent.com/get-convex/convex-hackathon-skill/main/references/log-format.md \
  -o .claude/skills/convex-hackathon-skill/references/log-format.md
```
Verify both files exist and are non-empty. If either download fails, `git clone https://github.com/get-convex/convex-hackathon-skill.git` into that folder instead.

### 2.4 Scaffold the app
```bash
pnpm create vite . --template react-ts        # keep repo root as project root
pnpm add convex @convex-dev/static-hosting @convex-dev/agent @convex-dev/auth @convex-dev/rate-limiter openai ai @ai-sdk/openai-compatible zod zod-to-json-schema firecrawl agentmail svix
pnpm add -D tailwindcss @tailwindcss/vite
```
If `pnpm create vite .` refuses a non-empty directory, scaffold into a temp folder and move the files in (keep `plan.md`, `.claude/`, `.gitignore`).

Wire Tailwind via the Vite plugin. Then start Convex:
```bash
pnpm dlx convex dev
```
This prompts for `convex login` (human) and creates a new Convex project + dev deployment, writes `convex/` and `.env.local` (`CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL` — the deployment URL is the only `VITE_` variable that will ever exist). Keep it running in the background while developing — it pushes functions on save and generates `convex/_generated`.

Then install the managed AI guideline files the Convex plugin expects (once a `convex/` dir exists):
```bash
pnpm dlx convex ai-files install
```
If that subcommand does not exist in the installed CLI, skip it and note that in your report.

### 2.5 Static hosting component (this is what gives us the `*.convex.site` URL)
```bash
pnpm dlx @convex-dev/static-hosting setup
```
Follow whatever it prints. The resulting shape should be:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import agent from "@convex-dev/agent/convex.config";

const app = defineApp({ httpPrefix: "/api" });   // our own HTTP routes live under /api
app.use(staticHosting, { httpPrefix: "/" });     // the SPA owns the root
app.use(agent);
export default app;
```
plus a `package.json` script `"deploy": "pnpm dlx @convex-dev/static-hosting deploy"`. Our AgentMail webhook and any other HTTP actions are therefore reachable at `https://<deployment>.convex.site/api/...`.

### 2.6 Auth
Use Convex Auth (`@convex-dev/auth`) — follow the Convex plugin's auth skill for the current setup steps (`convex/auth.ts`, `convex/auth.config.ts`, initializer command if one exists). Enable the **Anonymous** provider as the primary path so a judge can open the URL and use the app instantly, plus Password sign-in so a user can come back. **Judges must never hit a login wall.** Every table row that belongs to a user stores the auth user id and every query/mutation checks it.

### 2.7 Sponsor + LLM credentials (set on the deployment, never in code)
All shared credentials are in **`C:\Users\student\.hack-gas\secrets.env`** (outside every repo; comments inside explain the layout). Read values from there with a shell command and pipe them straight into `convex env set` — **never echo a value to the terminal, never paste one into a file in this repo.** If a value you need is blank in that file, ask the human for it.

- `FIRECRAWL_API_KEY` — one key shared by all nine apps.
- `AGENTMAIL_API_KEY` — take the account assigned to this repo: A → hack-gas1–3, B → hack-gas4–6, C → hack-gas7–9 (`AGENTMAIL_API_KEY_A/B/C` in the file). Each account allows only **3 inboxes**, so this app creates **exactly one inbox** (§4.3).
- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, optional `LLM_VISION_MODEL`, optional `LLM_EXTRA_BODY` (JSON merged into every chat request, for provider-specific fields such as `{"chat_template_kwargs":{"thinking":false}}`) — any OpenAI-compatible endpoint; the human chooses the provider and **will likely swap it mid-hackathon** (currently NVIDIA-hosted DeepSeek, probably Qwen later), so the code must not care and must not hardcode a model or a provider quirk.
- `DEMO_RECIPIENT_OVERRIDE` — the human's own email; **mandatory during dev** (§4.3).
- `AGENTMAIL_WEBHOOK_SECRET` — later, once the webhook exists (§4.3).
- `CONVEX_ACCESS_TOKEN` in the file is a bare dashboard token (not a deploy key). Prefer `pnpm dlx convex login` once on this machine; only reach for the token if a non-interactive Management API call is needed.

```bash
# pattern (values never printed):
pnpm dlx convex env set FIRECRAWL_API_KEY "$(grep '^FIRECRAWL_API_KEY=' ~/.hack-gas/secrets.env | cut -d= -f2-)"
pnpm dlx convex env set AGENTMAIL_API_KEY  "$(grep '^AGENTMAIL_API_KEY_A=' ~/.hack-gas/secrets.env | cut -d= -f2-)"
# …same for LLM_* and DEMO_RECIPIENT_OVERRIDE; add --prod for the production deployment later
pnpm dlx convex env list   # names only — verify they're set
```
Commit `.env.example` listing the *names* only.

### 2.8 Start the build log
Run `/hackathon start`. If the skill isn't picked up yet this session, open `.claude/skills/convex-hackathon-skill/SKILL.md`, read it fully, and follow its start instructions by hand. The result is `hackathon.md` at the repo root that follows `references/log-format.md` exactly, with:

```
- **Event:** Convex All Gas Hackathon
- **Frontend:** Convex static hosting
```
Verify the header labels and order match the reference, and that no secrets or personal info are in the file. Re-run `/hackathon` after each meaningful milestone (it appends evidence-based entries from git).

## 3. Product spec — SafePlate (eating out with a serious food allergy)

### 3.1 The pitch
If your kid has a peanut allergy, every restaurant is a risk assessment: read the menu, guess at cross-contamination, call and hope the person answering knows. **SafePlate** does the homework: pick a restaurant (or a whole neighbourhood), it scrapes the real menu, flags every dish against your allergen profile, emails the restaurant the exact questions a careful parent would ask, and turns their reply into a clear verdict — *confirmed safe options*, *avoid*, *unclear* — on a live map that turns green as restaurants confirm. Emotional payoff: a parent seeing "Confirmed: kitchen has a nut-free fryer — 6 safe dishes" and exhaling.

### 3.2 Core loop
Create an allergy profile (allergens, severity, who it's for) → add a restaurant by URL or name/city (**Firecrawl** `search` → website → `map` to find the menu page → `scrape` with JSON extraction of dishes and ingredients) → **LLM** classifies each dish for the profile (`safe|risky|unsafe|unclear` + why) and writes the questions that remain unanswerable from the menu → **AgentMail** sends the inquiry to the restaurant from the profile's inbox → reply via webhook → LLM updates dish verdicts and produces a restaurant-level verdict → map pin and card update live → share the profile's "safe list" with grandparents/babysitters via public slug → **cron** re-scrapes saved menus weekly and flags changes.

### 3.3 Data model
- `profiles`: ownerId, slug, personName (first name), allergens[] (enum + free text), severity, notes, caseCode (short unique code for email routing, see §4.3), createdAt. Index by ownerId, slug, caseCode.
- `restaurants`: profileId, name, website, menuUrl?, contactEmail?, lat?, lng?, address?, sourceUrl, status (`scraping|reviewed|asked|confirmed|avoid|unclear`), verdict?, verdictReason?, lastScrapedAt, menuHash?, inquiryMessageId?, askedAt?. Index by profileId, by profileId+status.
- `dishes`: restaurantId, name, description?, price?, ingredients[]?, verdict (`safe|risky|unsafe|unclear`), reason, updatedFromReply (bool), model. Index by restaurantId.
- `inquiries` / `messages`: restaurantId, profileId, direction, messageId, threadId, subject, extractedText, fullText, classification (`answered|partial|declined|auto_reply|other`)?, extracted (json: answers per question), receivedAt. Index by messageId, by restaurantId.
- `questions`: restaurantId, text, answer?, answeredBy (`menu|reply`)?. Index by restaurantId.

### 3.4 Convex functions
- `profiles.create` (assigns a caseCode), `profiles.get`, `profiles.publicSafeList` (slug; safe dishes per confirmed restaurant only).
- `restaurants.add` (mutation → schedules `menu.discover`), `restaurants.addManualEmail`.
- `menu.discover` (internalAction): if URL given use it; else Firecrawl `search("<name> <city> restaurant menu")`; `map(website)` and pick links containing `menu`; `scrape(menuUrl, json schema {dishes:[{name, description, price, ingredients}]})`; store; then `ai.reviewMenu`.
- `ai.reviewMenu` (internalAction): batch dishes (chunks of ~25) → verdicts + reasons; generate ≤5 questions ("Is the fryer shared with breaded items?"); restaurant status `reviewed`.
- `inquiry.send` (internalAction): LLM-drafted courteous email listing the allergen and the questions; `sendMail()`; status `asked`.
- `http.ts` webhook → `mail.ingest` → `ai.applyReply`: map answers to questions, re-verdict affected dishes, set restaurant verdict `confirmed|avoid|unclear`.
- `crons.ts`: weekly `menu.rescan` — Firecrawl re-scrape; if `menuHash` changed, re-review and mark "menu changed" badge.
- Agent component: "Ask SafePlate" — "can she have the pad thai?" grounded in the dishes table + replies.

### 3.5 Integration specifics
- **Firecrawl:** `search` → `map` → `scrape` JSON; use `maxAge` for rescans; handle PDF menus if Firecrawl supports PDF parsing (check docs) else mark `unclear` and ask by email.
- **LLM:** conservative by design — when in doubt `unclear`, never `safe` without ingredient evidence or a confirming reply; the reason text must cite the ingredient or the reply sentence.
- **AgentMail:** single app inbox (§4.3), `[SP-xxxx]` code in subjects; one thread per restaurant; replies update verdicts; attachments (restaurants often send allergen PDFs) stored and parsed via Firecrawl/LLM.

### 3.6 UI
- **/p/:id** dashboard: map (Leaflet/MapLibre) with pins coloured by verdict (grey scraping, amber unclear, green confirmed, red avoid); list of restaurants with a mini-bar of safe/risky/unsafe counts; "Add restaurant" input (URL or name).
- Restaurant page: menu grouped by verdict, each dish with a one-line reason; *Questions* panel (unanswered → answered from reply, with the reply sentence quoted); email thread; *Ask the restaurant* button; *menu changed* badge.
- **/s/:slug** public "safe list" for caregivers: clean cards, printable.
- Look: calm, clinical-but-friendly; big verdict chips; pins animate colour change.

### 3.7 Demo storyboard (≤ 3:00)
1. (0:00) "Our daughter has a severe peanut allergy. Here's how we pick a restaurant now." Profile exists; paste a real local restaurant URL. (0:20)
2. Menu appears live from Firecrawl (show source link), dishes get verdicts with reasons, 4 questions generated. (0:55)
3. Click *Ask the restaurant* → email sent (show it). Pin turns amber. (1:15)
4. Phone: reply as the restaurant "We have a dedicated nut-free fryer; the satay and the pad thai contain peanuts; everything else is prepared separately." Dish verdicts flip live; restaurant turns green; questions show answers with the quoted sentence. (2:05)
5. Ask the Agent "can she have the spring rolls?" → grounded answer. Open the public safe-list link "for grandma". Show a second restaurant with *menu changed* badge from the weekly rescan. URL on screen. (2:55)

### 3.8 Fixtures & test plan
Seed a profile with 3 restaurants (real menus scraped by the seed action) in mixed states; stage the reply text on the phone.

### 3.9 Stretch
Neighbourhood sweep (Firecrawl `search` for 10 restaurants near a postcode, all reviewed in parallel via `workflow`); photo-of-menu upload → vision extraction when `LLM_VISION_MODEL` is set.

### 3.10 Risks
Safety framing: the UI must say verdicts are assistance, not medical advice, and only reply-confirmed items are shown as *confirmed*. Menus without ingredients → mostly *unclear*; the email loop is what resolves it (that's the story).

## 4. Integration patterns (shared across the whole app)

### 4.1 LLM — one provider module, env-driven, server-side only
All LLM calls run inside Convex actions. Create `convex/lib/llm.ts`; nothing else imports `openai` or an AI-SDK provider. Two clients from one config (`pnpm add openai zod zod-to-json-schema`):

```ts
import OpenAI from "openai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const cfg = () => {
  const baseURL = process.env.LLM_BASE_URL, apiKey = process.env.LLM_API_KEY, model = process.env.LLM_MODEL;
  if (!baseURL || !apiKey || !model) throw new Error("LLM_BASE_URL / LLM_API_KEY / LLM_MODEL not set on this deployment");
  const extra = process.env.LLM_EXTRA_BODY ? JSON.parse(process.env.LLM_EXTRA_BODY) : {};
  return { baseURL, apiKey, model, vision: process.env.LLM_VISION_MODEL, extra };
};
const client = () => new OpenAI({ baseURL: cfg().baseURL, apiKey: cfg().apiKey });

// (1) Plain OpenAI SDK for extraction/drafting — unknown body fields (e.g. chat_template_kwargs) pass straight through.
export async function draft(prompt: string, system?: string): Promise<string> {
  const { model, extra } = cfg();
  const r = await client().chat.completions.create({ model, temperature: 0.7,
    messages: [...(system ? [{ role: "system" as const, content: system }] : []), { role: "user", content: prompt }], ...extra });
  return r.choices[0]?.message?.content ?? "";
}
export async function extract<T>(schema: z.ZodType<T>, prompt: string, system?: string): Promise<T> {
  const { model, extra } = cfg();
  const jsonSchema = zodToJsonSchema(schema);
  const ask = async (strict: boolean) => client().chat.completions.create({ model, temperature: 0,
    messages: [{ role: "system", content: `${system ?? ""}\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema)}` },
               { role: "user", content: prompt }],
    ...(strict ? { response_format: { type: "json_object" } } : {}), ...extra });
  for (const strict of [true, false]) {           // try response_format first, then plain (some providers reject it)
    try { const r = await ask(strict); return schema.parse(JSON.parse(stripFences(r.choices[0]?.message?.content ?? ""))); } catch (e) { /* retry */ }
  }
  throw new Error("LLM returned no valid JSON");
}

// (2) AI-SDK model for the Convex Agent component (it needs a LanguageModel). Inject LLM_EXTRA_BODY via a fetch wrapper.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
export const agentModel = () => {
  const { baseURL, apiKey, model, extra } = cfg();
  const fetchWithExtra: typeof fetch = async (url, init) => {
    if (init?.body && typeof init.body === "string" && Object.keys(extra).length) {
      init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), ...extra }) };
    }
    return fetch(url, init);
  };
  return createOpenAICompatible({ name: "llm", baseURL, apiKey, fetch: fetchWithExtra }).chatModel(model);
};
```
- Verify the exact `openai` / `@ai-sdk/openai-compatible` signatures against their docs; the shape above is the intent. `stripFences` removes ```` ```json ```` fences that some models add. Every result that becomes a DB row goes through `extract()` + zod; log `model` on the stored artifact.
- Vision: only attempt image inputs when `LLM_VISION_MODEL` is set (use `image_url` content parts with a storage URL); otherwise degrade gracefully to the text-only path (the spec says where vision is optional).
- Multi-turn assistants use the **Agent component**: `new Agent(components.agent, { languageModel: agentModel(), instructions, ... })`. It stores threads/messages in Convex and counts as a registered component that is actually used.
- Providers get swapped mid-hackathon: the only things that change are the four env vars. Never special-case a model name in code; keep `max_tokens` modest (≤ 2k for extraction, ≤ 4k for drafting) and set a per-call timeout (~60 s) with one retry — hosted endpoints sometimes queue.
- Log the model id used on each stored AI artifact (`model: string` column) so `hackathon.md` can truthfully list it.
- **Note for the human:** "OpenAI" is a scored sponsor. The code is provider-agnostic, so if you want to be safe for judging, point the *production* deployment at an OpenAI model (OpenAI API, or Convex AI Gateway at `https://ai-gateway.convex.dev/v1` with `openai/<model>` ids) — no code change needed. Judge-facing docs (§9) always say "OpenAI".

### 4.2 Firecrawl (server-side, in `internalAction`s)
```ts
import { Firecrawl } from "firecrawl";
const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
await fc.search(query, { limit, scrapeOptions: { formats: ["markdown"] } });   // discover
await fc.scrape(url, { formats: ["markdown", "json"], ...jsonSchemaOptions }); // extract
await fc.map(url, { limit });                                                   // enumerate
```
Read the Firecrawl llms.txt for the exact v2 option names for JSON extraction, `maxAge` caching, and change tracking before writing these calls. Every Firecrawl call lives in an `internalAction` and writes results via `internalMutation`; the UI never waits synchronously — it subscribes to the table and watches rows appear. Store `sourceUrl`, `fetchedAt`, truncated raw markdown and the extracted JSON, so the UI can show "where this came from" (judges like proof the crawl is real). All Firecrawl calls go through one helper `crawl()` in `convex/lib/firecrawl.ts` that applies the budget rules in §4.5.

### 4.3 AgentMail — one inbox per app, routing by code, and the demo-safety override
**Inbox model (free-tier constraint: 3 inboxes per account, 3 apps per account):** this app creates **exactly one** AgentMail inbox, once, via an idempotent internal action (`mail.ensureInbox`: list inboxes, reuse the one whose `clientId` is `<app>-main`, else create it) and stores `inboxId` + address in a singleton `settings` row. Wherever §3 says a case/estate/job/profile/paper/circle/shield "has an inbox", it means a **`caseCode`** — a short unguessable code like `BCN-7F3K` — on that row; everything routes through the single app inbox:

- **Outbound:** every send includes `[<caseCode>]` in the subject; store the returned `messageId` and `threadId` on the case/contact row.
- **Inbound routing, in this order:** (1) `thread_id` matches a stored thread → that case; (2) subject contains a known `[<caseCode>]` → that case; (3) sender address matches a registered routing address (`senderRoutes` table: email → owner row; used by the forward-your-email apps and by member/guardian addresses) → that owner; (4) otherwise store as `unrouted` and show it in an admin "unmatched" list — never drop mail silently.
- **Plus-addressing:** test once whether `<inbox>+<code>@agentmail.to` is delivered to the inbox; if it is, also display `inbox+<caseCode>@…` as the per-case address and add it as routing rule (0). If not, show the plain inbox address plus the code ("put `[BCN-7F3K]` in the subject") and rely on rules 1–3.

```ts
import { AgentMailClient } from "agentmail";
const am = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY! });
await am.inboxes.messages.send(inboxId, { to, subject: `[${caseCode}] ${subject}`, text, html /*, attachments */ });
await am.inboxes.messages.reply(inboxId, messageId, { text, html });
```
Read the AgentMail docs for exact reply/attachment/label/thread call shapes.

**Mandatory safety rule:** all outbound sends go through one helper, `sendMail()`, in `convex/lib/mail.ts`. If `DEMO_RECIPIENT_OVERRIDE` is set, the helper rewrites `to` to that address and prefixes the subject with `[to: original@example.com]`. This is how we test and how we film the demo — we never email real shelters/companies/contractors/landlords from a dev box. Also configure the inbox allowlist in AgentMail during development if the API supports it. The override is removed only on the production deployment, and only when the human says so. `sendMail()` also enforces the send caps in §4.5.

**Inbound:** create one AgentMail webhook for the app inbox (via `scripts/register-webhook.ts` run with `pnpm dlx tsx`, reading the key from `.env.local`, or via the dashboard) for `message.received` (plus `message.bounced` / `message.delivered` for status badges) pointing at
`https://<dev-deployment>.convex.site/api/agentmail/webhook` (later also the prod deployment's URL — dev and prod each need their own webhook; if the free tier allows only one webhook per inbox, point it at prod when you deploy and use the dashboard's "resend" or a manual test email for dev). Handle it in `convex/http.ts` with an `httpAction`:

1. Read the raw body + `svix-id` / `svix-timestamp` / `svix-signature` headers, verify with `new Webhook(process.env.AGENTMAIL_WEBHOOK_SECRET).verify(rawBody, headers)` from `svix`. Return 401 on failure.
2. Idempotency: ignore if a row with that `message_id` (or `svix-id`) already exists.
3. `ctx.runMutation(internal.mail.ingest, {...})` — applies the routing rules above and stores the message; then `ctx.scheduler.runAfter(0, internal.ai.classifyInbound, { messageId })`.
4. Return 200 fast. Never do LLM work inside the webhook handler.

Store the reply-only text (`extracted_text`) for the UI and the full text for the AI. Attachments: download via the AgentMail API inside an action and put them in Convex file storage. Redact addresses in any log lines.

### 4.4 Convex depth checklist (must all be true before you call it done)
- `defineSchema` with indexes for every lookup pattern; validators on every function; `internal*` for anything the client shouldn't call.
- `useQuery` everywhere the UI shows state; nothing polls. Mutations with optimistic updates on the primary user action.
- At least one `crons.ts` job (re-crawl / follow-up sweep) and `ctx.scheduler` for pipelines.
- File storage for user uploads (photos/attachments) via upload URLs.
- HTTP actions (`/api/agentmail/webhook`).
- Registered components that are actually used: `static-hosting`, `agent`, `rate-limiter` (§4.5). Optional: `workflow` for the multi-step pipeline.
- Convex Auth with per-user data isolation.
- A public, unauthenticated read path where the product needs it (shareable page) implemented as a query keyed by an unguessable slug.

### 4.5 Quotas and abuse protection (free tiers, public URL, anonymous sign-in)
The live URL is public and sign-in is anonymous, so anyone — judges, other entrants, bots — can create cases and trigger crawls and emails. Free-tier budgets: **Firecrawl ≈ 2,000 credits for this app** (1 credit/page, 2 per 10 search results, JSON extraction costs more; 2 concurrent requests), **AgentMail 100 emails/day and 3,000/month shared with two sibling apps** (so treat this app's budget as ~30/day), Convex free plan (1M function calls/month, 0.5 GB DB, 1 GB files — generous, don't worry beyond not looping). Build these in from milestone 2, not at the end:

- Register `@convex-dev/rate-limiter` and put limits on every action that spends credits: e.g. per user `createCase` 3/day, `crawl` 10/hour, `send` 5/hour, `llm` 30/hour; plus **global** limits: `firecrawl` 150/day, `agentmail.send` 25/day, `llm` 500/day. When a limit is hit, the UI shows a friendly "demo quota reached, try again tomorrow" — never a crash. Read the component's docs for the exact API (token bucket / fixed window).
- A `usage` table with daily counters per provider (`firecrawl_pages`, `emails_sent`, `llm_calls`) that `crawl()`, `sendMail()` and `extract()/draft()` increment; show it on an `/admin` page gated to the owner (Password sign-in) so the human can watch the burn during judging.
- `APP_PAUSED` env var: when `"1"`, all credit-spending actions no-op with a banner; instant kill switch without a redeploy (`pnpm dlx convex env set APP_PAUSED 1 --prod`).
- Firecrawl: always pass `maxAge` (hours–days) so repeat scrapes are cache hits; cap `search` `limit` ≤ 5; cache extracted results by URL/company/org in a shared table (§3 lists which); crons skip sources scraped recently; seed data covers the demo so the on-camera crawl is one or two calls.
- AgentMail: cap recipients per case (e.g. ≤ 8 contacts) and follow-ups to one per contact; only the owner of a case can trigger sends; keep `DEMO_RECIPIENT_OVERRIDE` set until the human removes it on prod.
- Anonymous users get a per-user cap of cases/profiles (3) and cannot see each other's data; public slug pages are read-only queries.
- **Timing:** deploy early so the URL exists (day one), but keep the site in "preview" (override on, quotas tight) and post the social link / submit only in the final days before **September 22, 12:00 PM PT**, so the quota isn't burned by strangers weeks before judging. Reset/verify quotas the day before submitting; top up the seed data so the app looks alive even if quotas trip.

## 5. Build order

Work in this order; commit and run `/hackathon` at each numbered milestone.

1. **Setup** (§2) — scaffold, plugin, skill, Convex dev, static hosting, auth, env, `hackathon.md`. Deploy a "hello" build to `convex.site` immediately so the URL exists on day one.
2. **Schema + core CRUD + realtime UI shell** — create the primary object, list it live, seed fixture data (`convex/seed.ts` internal mutation). Add the rate-limiter, `usage` table and `APP_PAUSED` switch now (§4.5).
3. **Firecrawl pipeline** — discovery/extraction actions writing to tables, visible live in the UI with source links.
4. **LLM pipeline** — structured extraction / matching / drafting; results rendered with confidence + "why".
5. **AgentMail outbound** — `mail.ensureInbox`, `caseCode`s, `sendMail()` with override, thread view.
6. **AgentMail inbound** — webhook + routing + classification, the "reply on phone → screen updates" loop. **This is the demo money shot; test it end to end.**
7. **Polish** — empty states, loading skeletons, mobile layout, the printable/shareable page, motion on live updates (rows animate in; ranks reorder with a transition), quota-reached states.
8. **Production deploy** — `pnpm run deploy` (`@convex-dev/static-hosting deploy` = convex deploy + build + upload). Set prod env vars (`--prod`), register the prod webhook, grep `dist/` for leaked secrets, then open the URL in a fresh incognito window and run the full demo path as a judge would.
9. **Judge-facing deliverables** (§9) — `README.md`, `slides.html`, `demo/script.md` (the §3 storyboard with exact clicks and timings), `social.md` (draft X + LinkedIn posts with the live URL; the human posts them). Take the screenshots for README/slides from the production URL with seeded data.

## 6. Demo video rules (under 3 minutes)

- 0:00–0:15 one sentence of the human problem, then straight into the live `convex.site` URL. No slides.
- Every sponsor tool must be *seen working*: a Firecrawl crawl visibly filling rows with source links, an AI-generated artifact appearing, an email being sent, and a **real reply typed on a phone arriving on screen live**. Phone in frame or picture-in-picture.
- Prepare fixture data so nothing takes more than ~10 seconds on camera; run the slow crawls before recording and have a second "fresh" case ready to trigger one live.
- End on the emotional payoff state (see §3 storyboard) with the URL on screen.

## 7. Submission checklist (human does the final click)

- Public GitHub repo with `hackathon.md` at the root, updated by `/hackathon`, no secrets.
- `README.md` and `slides.html` per §9 at the repo root.
- Live URL `https://<deployment>.convex.site` opens without login and works in incognito; quotas verified (§4.5); `DEMO_RECIPIENT_OVERRIDE` removed on prod only if the human decides so.
- Video ≤ 3:00 uploaded (YouTube unlisted is fine).
- X or LinkedIn post published with the URL (draft in `social.md`).
- Submit at https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit before **September 22, 2026, 12:00 PM PT**.

## 8. Definition of done

The plan is complete when: every item in §4.4 and §4.5 is true; the §3 storyboard can be performed end-to-end on the production URL (including a live inbound email); `hackathon.md` header fields are all filled (Live app, Convex deployment, Components, Convex features, Auth, AI models) and generated from evidence; `pnpm build` and the Convex typecheck pass; no secret appears in `dist/` or git; and `README.md`, `slides.html`, `demo/script.md`, `social.md` exist per §9. Report what was verified and what remains for the human (keys, posting, submitting).

## 9. Judge-facing deliverables: `README.md` and `slides.html`

Judges read the README and may open the deck; both are marketing for a non-developer reader first and documentation second. Write them after the product works (build step 9), using real screenshots from the production URL.

### 9.1 `README.md` — written for the judges
Structure, in this order. Emojis are welcome — one per section heading and in the sponsor table, tasteful, never in body prose.

1. **Header:** `# <emoji> <Name>` then one italic tagline, then a single line of links: 🌐 **Live demo** (the `*.convex.site` URL, first and most prominent) · 🎬 Demo video · 📓 `hackathon.md`. Add a badge-style line "Built for the Convex All Gas Hackathon". Directly under the links, a one-line blockquote caveat, e.g.:
   > ⚠️ The live demo runs on free tiers of Convex, OpenAI, Firecrawl and AgentMail. If traffic is high some features may be rate-limited or temporarily unavailable — the demo video shows the full flow.
2. **✨ In three lines** — exactly three short lines: what it is, who it's for, the moment that makes it worth it.
3. **😩 The problem** — 3–5 sentences, concrete and human, one real-world number or example if it's verifiable.
4. **💡 Our solution** — what the product does, in the user's order of experience (not the architecture's). 4–6 bullets, each starting with a verb. Include one hero screenshot (`public/demo/hero.png`).
5. **🧩 How we use the sponsors** — **summary table first**, then one subsection per sponsor.

   | Sponsor | What it does in <Name> | Where |
   |---|---|---|
   | ⚡ Convex | backend, realtime, auth, crons, file storage, components (name them), static hosting | `convex/` |
   | 🧠 OpenAI | LLM for … (the specific jobs: extraction / matching / drafting / classification / the Agent) | `convex/lib/llm.ts`, `convex/ai.ts` |
   | 🔥 Firecrawl | what it crawls/scrapes/searches and what that data becomes | `convex/crawl.ts` |
   | 📬 AgentMail | the inbox it runs, what it sends, what it receives (webhook), how replies change the app | `convex/mail.ts`, `convex/http.ts` |

   Then `### ⚡ Convex`, `### 🧠 OpenAI`, `### 🔥 Firecrawl`, `### 📬 AgentMail`, each 4–8 sentences or bullets that name real functions/tables and the exact user-visible effect. The Convex subsection must list every feature from §4.4 that's actually used (queries, mutations, actions, HTTP actions, scheduler, crons, file storage, auth, the named components) with file paths — this is the "Convex depth" evidence.
   **The LLM is always described as "OpenAI" in the README** — "OpenAI powers …", "an OpenAI model …". Do not mention any other provider, model family, or `LLM_MODEL` value anywhere in the README, regardless of what the deployment is configured with. (The `hackathon.md` build log is evidence-based and separate; leave it to the skill.)
6. **🔍 How it works** — a **Mermaid architecture diagram** (GitHub renders ```` ```mermaid ````) showing: browser ⇄ Convex (queries/mutations/subscriptions) ⇄ actions → OpenAI / Firecrawl / AgentMail, the AgentMail webhook → HTTP action → mutation → live UI, and the cron. Then a numbered walkthrough of the core loop (from §3.2) in 6–10 steps, each naming the function that runs. End with a two-line "What's realtime" note (every list/board/map is a live `useQuery` subscription; nothing polls).
7. **🗂️ Project map** — a short tree of the important files (`convex/schema.ts`, `convex/http.ts`, `convex/crons.ts`, `convex/lib/llm.ts`, `convex/lib/mail.ts`, `src/…`).
8. **🚀 Run it yourself** — 6–8 lines: `pnpm install`, `pnpm dlx convex dev`, env var *names* (never values), `pnpm dev`, `pnpm run deploy`. Point at `.env.example`.
9. **🙏 Credits** — team, hackathon, sponsors. No emails.

Keep it under ~250 lines; every claim must be true of the shipped code (the same evidence rule as `hackathon.md`).

### 9.2 `slides.html` — a 4-slide pitch deck
One self-contained file at the repo root, also copied to `public/slides.html` so it's served at `https://<deployment>.convex.site/slides.html`. No build step, no framework, no external assets except optionally a Google Font with a system fallback; screenshots inlined as base64 or referenced from `/demo/*.png` (which exists on the live site). Must look good projected (16:9) and printed (each slide is one page via `@media print` with `page-break-after`). Navigation: ←/→ and space, click zones on the edges, slide counter bottom-right, `?slide=N` deep link. Palette and typography match the app. ≤ 40 words of prose per slide besides the diagram/table; big type; one idea per slide.

1. **Title** — name + emoji, tagline, hero screenshot (or the app's key visual), live URL in large type, "Convex All Gas Hackathon · 2026" footer.
2. **Problem → Solution** — two columns. Left: the human problem in three lines with one number/example. Right: what <Name> does in three lines. A single arrow between them.
3. **How it works** — the architecture diagram as inline SVG (same topology as the README Mermaid, hand-drawn so it's crisp), and four sponsor tiles beneath it: ⚡ Convex · 🧠 OpenAI · 🔥 Firecrawl · 📬 AgentMail, one line each. Say **OpenAI** for the LLM, same rule as the README.
4. **Demo & depth** — three screenshots of the storyboard's key moments (crawl filling in → AI artifact → the live email reply landing) with one-line captions, a row of "Convex depth" chips (realtime · auth · crons · file storage · HTTP actions · components used), and the live URL + repo URL large at the bottom.

Verify by opening it in a browser: arrows work, nothing overflows at 1280×720 and 1920×1080, print preview shows 4 pages, no request goes to a non-allowlisted host, and no secret or email address appears.
