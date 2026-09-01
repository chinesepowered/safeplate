import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { EnsureSignedIn } from "./auth";

function Status() {
  const settings = useQuery(api.mail.getSettings);
  const usage = useQuery(api.usage.today);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">SafePlate</h1>
        <p className="mt-2 text-stone-600">
          Chassis is up: signed in, live queries connected.
        </p>

        <dl className="mt-8 space-y-3 text-sm">
          <div className="flex gap-3">
            <dt className="w-40 shrink-0 text-stone-500">Inbox</dt>
            <dd>{settings ? settings.inboxAddress : "not created yet"}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-40 shrink-0 text-stone-500">Usage today</dt>
            <dd>
              {usage
                ? Object.keys(usage.counts).length
                  ? Object.entries(usage.counts)
                      .map(([k, n]) => `${k}: ${n}`)
                      .join(" · ")
                  : "nothing spent yet"
                : "…"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <EnsureSignedIn>
      <Status />
    </EnsureSignedIn>
  );
}
