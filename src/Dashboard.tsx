import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { Link, navigate } from "./router";
import { VerdictMap, type Pin } from "./Map";
import { Card, CountBar, SafetyNote, Spinner, VerdictChip, timeAgo } from "./ui";

const ALLERGENS = [
  "peanut",
  "tree nut",
  "milk",
  "egg",
  "wheat / gluten",
  "soy",
  "fish",
  "shellfish",
  "sesame",
];

/** First run: no profile yet. One screen, four fields, then straight into it. */
function Onboarding() {
  const create = useMutation(api.profiles.create);
  const copyDemo = useMutation(api.seed.copyDemo);
  const demoReady = useQuery(api.seed.available);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>(["peanut"]);
  const [other, setOther] = useState("");
  const [severity, setSeverity] = useState<
    "anaphylaxis" | "severe" | "moderate" | "intolerance"
  >("anaphylaxis");
  const [notes, setNotes] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (a: string) =>
    setPicked((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));

  async function submit() {
    setError(null);
    const allergens = [...picked, ...other.split(",").map((s) => s.trim())].filter(Boolean);
    if (!allergens.length) {
      setError("Pick at least one allergen.");
      return;
    }
    setBusy(true);
    try {
      await create({ personName: name, allergens, severity, notes, city });
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <p className="text-sm font-medium tracking-wide text-emerald-700">SafePlate</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900">
        Who are we keeping safe?
      </h1>
      <p className="mt-3 text-stone-600">
        SafePlate reads a restaurant's real menu, flags every dish against this profile,
        and emails the restaurant the questions a menu can never answer.
      </p>

      <Card className="mt-8 p-6">
        <label className="block text-sm font-medium text-stone-700">First name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Maya"
          className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
        />

        <label className="mt-6 block text-sm font-medium text-stone-700">Allergens</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALLERGENS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => toggle(a)}
              className={`rounded-full px-3 py-1.5 text-sm ring-1 transition ${
                picked.includes(a)
                  ? "bg-emerald-600 text-white ring-emerald-600"
                  : "bg-white text-stone-700 ring-stone-300 hover:ring-stone-400"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <input
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Anything else, comma separated"
          className="mt-3 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:border-emerald-600"
        />

        <label className="mt-6 block text-sm font-medium text-stone-700">How serious</label>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["anaphylaxis", "severe", "moderate", "intolerance"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverity(s)}
              className={`rounded-xl px-3 py-2 text-sm capitalize ring-1 transition ${
                severity === s
                  ? "bg-stone-900 text-white ring-stone-900"
                  : "bg-white text-stone-700 ring-stone-300 hover:ring-stone-400"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-stone-700">City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Waterloo, ON"
              className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2 outline-none focus:border-emerald-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700">
              Anything the kitchen should know
            </label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reacts to traces, carries an EpiPen"
              className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2 outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create profile"}
          </button>
          {demoReady && (
            <button
              onClick={() => void copyDemo()}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-stone-600 underline-offset-4 hover:underline"
            >
              or open the demo family
            </button>
          )}
        </div>
      </Card>

      <SafetyNote className="mt-6" />
    </div>
  );
}

type Row = Doc<"restaurants"> & {
  counts: { safe: number; risky: number; unsafe: number; unclear: number };
  dishCount: number;
  openQuestions: number;
  totalQuestions: number;
};

function statusLabel(r: Row) {
  switch (r.status) {
    case "scraping":
      return "Reading the menu";
    case "reviewed":
      return "Reviewed — questions ready";
    case "asked":
      return "Asked, waiting on a reply";
    case "confirmed":
      return "Confirmed by the restaurant";
    case "avoid":
      return "They cannot accommodate";
    case "failed":
      return "Could not read the menu";
    default:
      return "Unclear";
  }
}

function RestaurantRow({ r }: { r: Row }) {
  const pending = r.status === "scraping";
  return (
    <Link
      to={`/r/${r._id}`}
      className="sp-enter block rounded-2xl border border-stone-200/80 bg-white p-4 transition hover:border-stone-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-stone-900">{r.name}</h3>
            {r.menuChanged && (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-600/25">
                menu changed
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-stone-500">
            {r.address ?? r.website ?? statusLabel(r)}
          </p>
        </div>
        {pending ? (
          <Spinner />
        ) : (
          <VerdictChip verdict={(r.verdict ?? "unclear") as any} size="sm" />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <CountBar counts={r.counts} />
        <p className="text-xs text-stone-500">
          {pending
            ? r.statusDetail
            : r.status === "asked"
              ? `Asked ${timeAgo(r.askedAt)} · ${r.totalQuestions} questions`
              : r.openQuestions > 0
                ? `${r.openQuestions} question${r.openQuestions === 1 ? "" : "s"} to ask`
                : statusLabel(r)}
        </p>
      </div>
    </Link>
  );
}

export function Dashboard() {
  const profiles = useQuery(api.profiles.mine);
  const profile = profiles?.[0];
  const restaurants = useQuery(
    api.restaurants.listForProfile,
    profile ? { profileId: profile._id } : "skip",
  ) as Row[] | undefined;
  const demoReady = useQuery(api.seed.available);
  const copyDemo = useMutation(api.seed.copyDemo);

  const addRestaurant = useMutation(api.restaurants.add).withOptimisticUpdate(
    (store, args) => {
      const current = store.getQuery(api.restaurants.listForProfile, {
        profileId: args.profileId,
      });
      if (!current) return;
      const isUrl = /^https?:\/\//i.test(args.input);
      store.setQuery(api.restaurants.listForProfile, { profileId: args.profileId }, [
        {
          _id: crypto.randomUUID() as Id<"restaurants">,
          _creationTime: Date.now(),
          profileId: args.profileId,
          ownerId: (current[0]?.ownerId ?? "pending") as any,
          name: isUrl ? args.input.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : args.input,
          status: "scraping",
          statusDetail: "Starting…",
          caseCode: "",
          createdAt: Date.now(),
          counts: { safe: 0, risky: 0, unsafe: 0, unclear: 0 },
          dishCount: 0,
          openQuestions: 0,
          totalQuestions: 0,
        } as Row,
        ...current,
      ]);
    },
  );

  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (profiles === undefined) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (!profile) return <Onboarding />;

  const rows = restaurants ?? [];
  const pins: Pin[] = rows
    .filter((r) => typeof r.lat === "number" && typeof r.lng === "number")
    .map((r) => ({
      id: r._id,
      name: r.name,
      lat: r.lat!,
      lng: r.lng!,
      verdict: (r.verdict ?? "unclear") as any,
      pending: r.status === "scraping",
      detail: statusLabel(r),
    }));

  const confirmed = rows.filter((r) => r.status === "confirmed").length;
  const safeDishes = rows.reduce((n, r) => n + r.counts.safe, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = input.trim();
    if (!value || !profile) return;
    setInput("");
    try {
      await addRestaurant({ profileId: profile._id, input: value });
    } catch (err) {
      setError(String((err as Error).message ?? err));
      setInput(value);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-wide text-emerald-700">SafePlate</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900">
            Eating out with {profile.personName}
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            {profile.allergens.join(" · ")} — {profile.severity}
            {profile.city ? ` · ${profile.city}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link
            to={`/s/${profile.slug}`}
            className="rounded-xl border border-stone-300 px-3 py-2 font-medium text-stone-700 transition hover:border-stone-400"
          >
            Share the safe list
          </Link>
        </div>
      </header>

      {(confirmed > 0 || safeDishes > 0) && (
        <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-600/15">
          <strong>{confirmed}</strong> restaurant{confirmed === 1 ? " has" : "s have"} written
          back and confirmed <strong>{safeDishes}</strong> dish
          {safeDishes === 1 ? "" : "es"} {profile.personName} can order.
        </p>
      )}

      <form onSubmit={submit} className="mt-6 flex flex-wrap gap-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a restaurant's website, or type a name and city"
          className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
        />
        <button
          type="submit"
          className="rounded-xl bg-emerald-600 px-5 py-3 font-medium text-white transition hover:bg-emerald-700"
        >
          Check this restaurant
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="order-2 space-y-3 lg:order-1">
          {restaurants === undefined && <Spinner label="Loading restaurants" />}
          {restaurants && rows.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-stone-700">No restaurants yet.</p>
              <p className="mt-1 text-sm text-stone-500">
                Paste a menu URL above, or start from the demo family to see the whole flow.
              </p>
              {demoReady && (
                <button
                  onClick={() => void copyDemo()}
                  className="mt-4 rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:border-stone-400"
                >
                  Load the demo family
                </button>
              )}
            </Card>
          )}
          {rows.map((r) => (
            <RestaurantRow key={r._id} r={r} />
          ))}
        </div>

        <div className="order-1 lg:order-2">
          <Card className="overflow-hidden">
            <VerdictMap
              pins={pins}
              onSelect={(id) => navigate(`/r/${id}`)}
              className="h-[320px] w-full lg:h-[520px]"
            />
          </Card>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-emerald-600" /> confirmed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-stone-500" /> unclear
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-amber-500" /> risky
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-rose-600" /> avoid
            </span>
          </div>
          <SafetyNote className="mt-4" />
        </div>
      </div>
    </div>
  );
}
