import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { EnsureSignedIn } from "./auth";
import { usePath, Link } from "./router";
import { Dashboard } from "./Dashboard";
import { Restaurant } from "./Restaurant";
import { SafeList } from "./SafeList";
import { Card, Spinner } from "./ui";

/** Free-tier burn and any email we could not route. */
function Admin() {
  const usage = useQuery(api.usage.today);
  const unrouted = useQuery(api.mail.unrouted);
  const settings = useQuery(api.mail.getSettings);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link to="/" className="text-sm text-stone-500 hover:text-stone-800">
        ← Back
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-stone-900">
        Deployment health
      </h1>

      <Card className="mt-6 p-5">
        <h2 className="font-medium text-stone-800">Spend today</h2>
        {usage === undefined ? (
          <Spinner />
        ) : usage === null ? (
          <p className="mt-2 text-sm text-stone-500">Sign in to see usage.</p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-3 gap-4 text-sm">
              {["firecrawl", "llm", "agentmail"].map((k) => (
                <div key={k}>
                  <dt className="text-stone-500 capitalize">{k}</dt>
                  <dd className="text-2xl font-semibold text-stone-900">
                    {usage.counts[k] ?? 0}
                  </dd>
                </div>
              ))}
            </dl>
            {usage.paused && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                APP_PAUSED is set — nothing that spends a credit will run.
              </p>
            )}
          </>
        )}
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="font-medium text-stone-800">Inbox</h2>
        <p className="mt-2 text-sm text-stone-600">
          {settings
            ? settings.inboxAddress
            : "No AgentMail inbox on this deployment yet — outbound enquiries are drafted and stored, not delivered."}
        </p>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="font-medium text-stone-800">Unrouted email</h2>
        {unrouted === undefined ? (
          <Spinner />
        ) : unrouted.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nothing unmatched.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {unrouted.map((m) => (
              <li key={m._id} className="rounded-lg bg-stone-100 px-3 py-2">
                <span className="text-stone-800">{m.subject}</span>
                <span className="ml-2 text-stone-500">{m.from}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function App() {
  const path = usePath();

  // The caregiver page is deliberately outside the auth wrapper: a grandparent
  // opening a shared link should never be asked to sign in to anything.
  const share = path.match(/^\/s\/([^/]+)$/);
  if (share) return <SafeList slug={decodeURIComponent(share[1])} />;

  const restaurant = path.match(/^\/r\/([^/]+)$/);

  return (
    <EnsureSignedIn>
      {path === "/admin" ? (
        <Admin />
      ) : restaurant ? (
        <Restaurant id={restaurant[1]} />
      ) : (
        <Dashboard />
      )}
    </EnsureSignedIn>
  );
}
