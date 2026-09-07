import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Link } from "./router";
import {
  Card,
  CrawlPausedNote,
  SafetyNote,
  Spinner,
  VerdictChip,
  VERDICT,
  VERDICT_ORDER,
  type Verdict,
  timeAgo,
} from "./ui";

const PAUSED_FALLBACK =
  "Live menu checks are paused right now to protect the shared crawl budget. " +
  "Nothing about this restaurant has been checked yet — try again later.";

export function Restaurant({ id }: { id: string }) {
  const data = useQuery(api.restaurants.detail, { restaurantId: id as Id<"restaurants"> });
  const mailSettings = useQuery(api.mail.getSettings);
  const setEmail = useMutation(api.restaurants.addManualEmail);
  const ask = useMutation(api.restaurants.ask);
  const rescan = useMutation(api.restaurants.rescan);
  const dismiss = useMutation(api.restaurants.dismissMenuChanged);

  const [email, setEmail_] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (data === undefined) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <p className="text-stone-700">That restaurant is not on your list.</p>
        <Link to="/" className="mt-4 inline-block text-emerald-700 underline">
          Back to the map
        </Link>
      </div>
    );
  }

  const { restaurant: r, profile, dishes, questions, messages } = data;
  const grouped = VERDICT_ORDER.map((v) => ({
    verdict: v,
    items: dishes.filter((d) => d.verdict === v),
  })).filter((g) => g.items.length);
  const openQs = questions.filter((q) => !q.answer);
  const answeredQs = questions.filter((q) => q.answer);
  const emailConnected = Boolean(mailSettings);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <Link to="/" className="text-sm text-stone-500 hover:text-stone-800">
        ← All restaurants
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{r.name}</h1>
          <p className="mt-1 text-sm text-stone-600">
            {r.address ?? "Address not found"}
            {profile && (
              <>
                {" · checked for "}
                <span className="font-medium text-stone-800">
                  {profile.allergens.join(", ")}
                </span>
              </>
            )}
          </p>
          {r.sourceUrl && (
            <p className="mt-1 text-xs text-stone-500">
              Menu read from{" "}
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-stone-700"
              >
                {r.sourceUrl.replace(/^https?:\/\//, "").slice(0, 60)}
              </a>
              {r.lastScrapedAt ? ` · ${timeAgo(r.lastScrapedAt)}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {r.status === "scraping" ? (
            <Spinner label={r.statusDetail ?? "Working"} />
          ) : (
            <VerdictChip verdict={(r.verdict ?? "unclear") as Verdict} size="lg" />
          )}
          <button
            onClick={() => void run(() => rescan({ restaurantId: r._id }))}
            className="text-xs text-stone-500 underline-offset-2 hover:underline"
          >
            Re-read the menu
          </button>
        </div>
      </header>

      {r.verdictReason && (
        <p className="mt-4 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
          {r.verdictReason}
        </p>
      )}

      {r.menuChanged && (
        <div className="mt-3 flex items-center justify-between gap-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-sky-600/20">
          <span>
            The menu changed since we last checked — anything the kitchen confirmed before may
            no longer apply.
          </span>
          <button
            onClick={() => void dismiss({ restaurantId: r._id })}
            className="shrink-0 text-xs underline"
          >
            dismiss
          </button>
        </div>
      )}

      {r.status === "failed" && (
        <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
          {r.statusDetail}
        </p>
      )}

      {r.status === "paused" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700 ring-1 ring-stone-300/60">
          <span>{r.statusDetail ?? PAUSED_FALLBACK}</span>
          <button
            onClick={() => void run(() => rescan({ restaurantId: r._id }))}
            className="shrink-0 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:border-stone-400"
          >
            Try again
          </button>
        </div>
      )}

      <CrawlPausedNote className="mt-3" />

      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}

      {/* ---------------------------------------------------------- questions */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-stone-900">
            Questions the menu cannot answer
          </h2>
          <span className="text-sm text-stone-500">
            {answeredQs.length}/{questions.length} answered
          </span>
        </div>

        {questions.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">
            {r.status === "scraping" ? "Working on it…" : "No questions yet."}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {[...answeredQs, ...openQs].map((q) => (
              <li
                key={q._id}
                className={`sp-enter rounded-xl border p-4 ${
                  q.answer
                    ? "border-emerald-600/20 bg-emerald-50/50"
                    : "border-stone-200 bg-white"
                }`}
              >
                <p className="text-sm font-medium text-stone-900">{q.text}</p>
                {q.answer ? (
                  <>
                    <p className="mt-1.5 text-sm text-emerald-900">{q.answer}</p>
                    {q.quote && (
                      <blockquote className="mt-2 border-l-2 border-emerald-600/40 pl-3 text-sm italic text-stone-600">
                        “{q.quote}”
                      </blockquote>
                    )}
                    <p className="mt-1.5 text-xs text-stone-500">
                      From the restaurant's reply {timeAgo(q.answeredAt)}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-stone-500">Waiting on the restaurant</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* ------------------------------------------------------- ask by email */}
        <Card className="mt-4 p-4">
          {!emailConnected && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-600/20">
              Email is not connected on this deployment yet. SafePlate will still write the
              enquiry and show it below, but it cannot be delivered until an inbox is
              configured.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={email || r.contactEmail || ""}
              onChange={(e) => setEmail_(e.target.value)}
              placeholder="The restaurant's email address"
              className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:border-emerald-600"
            />
            <button
              onClick={() =>
                void run(async () => {
                  const value = (email || r.contactEmail || "").trim();
                  if (value !== r.contactEmail) {
                    await setEmail({ restaurantId: r._id, email: value });
                  }
                  await ask({ restaurantId: r._id });
                })
              }
              disabled={questions.length === 0}
              className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-40"
            >
              {r.askedAt ? "Ask again" : "Ask the restaurant"}
            </button>
          </div>
          {r.statusDetail && r.status !== "failed" && r.status !== "paused" && (
            <p className="mt-2 text-xs text-stone-500">{r.statusDetail}</p>
          )}
        </Card>
      </section>

      {/* ------------------------------------------------------------- dishes */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-stone-900">
          The menu, dish by dish{" "}
          <span className="font-normal text-stone-500">({dishes.length})</span>
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          Every line says why, and where the reason came from.
        </p>

        <div className="mt-4 space-y-6">
          {grouped.map((g) => {
            const showAll = open[g.verdict] || g.items.length <= 8;
            const items = showAll ? g.items : g.items.slice(0, 8);
            return (
              <div key={g.verdict}>
                <div className="flex items-center gap-3">
                  <VerdictChip verdict={g.verdict} size="sm" />
                  <span className="text-sm text-stone-500">
                    {g.items.length} · {VERDICT[g.verdict].blurb}
                  </span>
                </div>
                <ul className="mt-2 divide-y divide-stone-200/70 overflow-hidden rounded-2xl border border-stone-200/80 bg-white">
                  {items.map((d) => (
                    <li key={d._id} className="sp-enter p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-stone-900">{d.name}</span>
                        {d.price && (
                          <span className="shrink-0 text-sm text-stone-500">{d.price}</span>
                        )}
                      </div>
                      {d.description && (
                        <p className="mt-0.5 text-sm text-stone-600">{d.description}</p>
                      )}
                      <p className="mt-1.5 flex items-start gap-2 text-sm">
                        <span
                          className={`mt-1.5 size-1.5 shrink-0 rounded-full ${VERDICT[d.verdict].dot}`}
                        />
                        <span className="text-stone-700">{d.reason}</span>
                      </p>
                      <p className="mt-1 text-xs text-stone-400">
                        {d.evidence === "reply"
                          ? "Source: the restaurant's emailed reply"
                          : "Source: the menu text"}
                      </p>
                    </li>
                  ))}
                </ul>
                {!showAll && (
                  <button
                    onClick={() => setOpen((o) => ({ ...o, [g.verdict]: true }))}
                    className="mt-2 text-sm text-stone-600 underline-offset-2 hover:underline"
                  >
                    Show all {g.items.length}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------- thread */}
      {messages.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-stone-900">Email thread</h2>
          <div className="mt-3 space-y-3">
            {messages.map((m) => (
              <Card
                key={m._id}
                className={`sp-enter p-4 ${m.direction === "in" ? "bg-emerald-50/40" : ""}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-stone-800">
                    {m.direction === "out"
                      ? `To ${m.to?.[0] ?? "the restaurant"}`
                      : `From ${m.from ?? "the restaurant"}`}
                  </span>
                  <span className="text-xs text-stone-500">
                    {timeAgo(m.at)}
                    {m.deliveryStatus === "not_sent" && " · not sent"}
                    {m.classification && ` · ${m.classification.replace("_", " ")}`}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-stone-500">{m.subject}</p>
                {m.summary && (
                  <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm text-stone-700 ring-1 ring-stone-200">
                    {m.summary}
                  </p>
                )}
                <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-stone-700">
                  {m.extractedText ?? m.fullText}
                </pre>
              </Card>
            ))}
          </div>
        </section>
      )}

      {r.menuExcerpt && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-stone-500">
            What we actually read from their page
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-stone-100 p-4 text-xs text-stone-600">
            {r.menuExcerpt}
          </pre>
        </details>
      )}

      <SafetyNote className="mt-8" />
    </div>
  );
}
