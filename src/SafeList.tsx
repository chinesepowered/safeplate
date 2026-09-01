import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Card, Spinner } from "./ui";

/**
 * The page you send to grandparents and babysitters. No sign-in, no controls,
 * nothing amber — only restaurants that wrote back and only the dishes they
 * confirmed. Printable, because it ends up on a fridge.
 */
export function SafeList({ slug }: { slug: string }) {
  const data = useQuery(api.profiles.publicSafeList, { slug });

  if (data === undefined) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center text-stone-600">
        This safe list link is not valid.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm font-medium tracking-wide text-emerald-700">SafePlate</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900">
        Where {data.personName} can eat
      </h1>
      <p className="mt-2 text-stone-600">
        Allergic to <strong>{data.allergens.join(", ")}</strong> ({data.severity}).
        {data.notes ? ` ${data.notes}` : ""}
      </p>
      <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-600/15">
        Everything on this page was confirmed by the restaurant itself, in writing. Always say
        the allergy out loud when you order anyway.
      </p>

      {data.entries.length === 0 ? (
        <Card className="mt-8 p-8 text-center text-stone-600">
          No restaurant has confirmed anything yet. This page fills in as they reply.
        </Card>
      ) : (
        <div className="mt-8 space-y-5">
          {data.entries.map((e) => (
            <Card key={e.name} className="sp-enter p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-stone-900">{e.name}</h2>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-600/25">
                  Confirmed by the kitchen
                </span>
              </div>
              {e.address && <p className="mt-0.5 text-sm text-stone-500">{e.address}</p>}
              {e.verdictReason && (
                <p className="mt-2 text-sm text-stone-700">{e.verdictReason}</p>
              )}
              <ul className="mt-3 space-y-2">
                {e.dishes.map((d) => (
                  <li key={d.name} className="rounded-xl bg-emerald-50/50 p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-stone-900">{d.name}</span>
                      {d.price && <span className="text-sm text-stone-500">{d.price}</span>}
                    </div>
                    <p className="mt-0.5 text-sm text-stone-600">{d.reason}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-10 text-xs leading-relaxed text-stone-500">
        SafePlate helps a family ask better questions. It is not medical advice and it cannot
        see inside a kitchen. Menus and suppliers change — if anything here looks different in
        person, ask the staff before ordering.
      </p>

      <button
        onClick={() => window.print()}
        className="sp-no-print mt-6 rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:border-stone-400"
      >
        Print this page
      </button>
    </div>
  );
}
